require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

// Stripe (only load if secret key exists)
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
	try {
		stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
		console.log('Stripe initialized');
	} catch (e) {
		console.warn('Stripe not available:', e.message);
	}
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

app.get('/manifest.json', (req, res) => {
	res.setHeader('Content-Type', 'application/manifest+json');
	res.sendFile(__dirname + '/manifest.json');
});

// ===== USER DATABASE =====
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
try {
	if (fs.existsSync(USERS_FILE)) {
		users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
	}
} catch (e) { users = {}; }

function saveUsers() {
	try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) {}
}

// ===== DONORS DATABASE =====
const DONORS_FILE = path.join(__dirname, 'donors.json');
let donors = {};
try {
	if (fs.existsSync(DONORS_FILE)) {
		donors = JSON.parse(fs.readFileSync(DONORS_FILE, 'utf8'));
	}
} catch (e) { donors = {}; }

function saveDonors() {
	try { fs.writeFileSync(DONORS_FILE, JSON.stringify(donors, null, 2)); } catch (e) {}
}

// ===== AUTH ROUTES =====
app.post('/api/signup', (req, res) => {
	const { username, password } = req.body;
	if (!username || !password) return res.json({ ok: false, error: 'Missing username or password' });
	if (username.length < 3) return res.json({ ok: false, error: 'Username too short (min 3 chars)' });
	if (password.length < 4) return res.json({ ok: false, error: 'Password too short (min 4 chars)' });
	if (users[username]) return res.json({ ok: false, error: 'Username already taken' });

	users[username] = { password: password, wins: 0, losses: 0, created: Date.now() };
	saveUsers();
	res.json({ ok: true, username: username, wins: 0, losses: 0 });
});

app.post('/api/login', (req, res) => {
	const { username, password } = req.body;
	if (!users[username]) return res.json({ ok: false, error: 'User not found' });
	if (users[username].password !== password) return res.json({ ok: false, error: 'Wrong password' });
	res.json({ ok: true, username: username, wins: users[username].wins || 0, losses: users[username].losses || 0 });
});

app.post('/api/updateStats', (req, res) => {
	const { username, won } = req.body;
	if (!users[username]) return res.json({ ok: false });
	if (won) users[username].wins = (users[username].wins || 0) + 1;
	else users[username].losses = (users[username].losses || 0) + 1;
	saveUsers();
	res.json({ ok: true, wins: users[username].wins, losses: users[username].losses });
});

// ===== WINS LEADERBOARD =====
app.get('/api/leaderboard', (req, res) => {
	const list = Object.keys(users).map(username => ({
		username: username,
		wins: users[username].wins || 0,
		losses: users[username].losses || 0,
		winRate: (users[username].wins || 0) + (users[username].losses || 0) > 0
			? Math.round(((users[username].wins || 0) / ((users[username].wins || 0) + (users[username].losses || 0))) * 100)
			: 0
	}));

	list.sort((a, b) => {
		if (b.wins !== a.wins) return b.wins - a.wins;
		return b.winRate - a.winRate;
	});

	res.json({ ok: true, leaderboard: list.slice(0, 10), total: list.length });
});

// ===== DONOR LEADERBOARD =====
app.get('/api/donors', (req, res) => {
	const list = Object.keys(donors).map(username => ({
		username: username,
		totalCents: donors[username].totalCents || 0,
		donationCount: donors[username].donationCount || 0,
		lastDonation: donors[username].lastDonation || 0
	}));

	// Sort by highest total donation
	list.sort((a, b) => b.totalCents - a.totalCents);

	// Calculate total raised
	const totalRaisedCents = list.reduce((sum, d) => sum + d.totalCents, 0);

	res.json({
		ok: true,
		donors: list.slice(0, 10),
		total: list.length,
		totalRaised: totalRaisedCents
	});
});

// Record a donation (called after successful payment)
app.post('/api/recordDonation', (req, res) => {
	const { username, amountCents } = req.body;
	if (!username || typeof amountCents !== 'number') {
		return res.json({ ok: false, error: 'Invalid data' });
	}
	if (amountCents < 50) return res.json({ ok: false, error: 'Amount too small' });

	// Guest donations still count but under a generic name
	const donorName = username.startsWith('Guest') ? 'Anonymous' : username;

	if (!donors[donorName]) {
		donors[donorName] = {
			totalCents: 0,
			donationCount: 0,
			lastDonation: 0,
			firstDonation: Date.now()
		};
	}

	donors[donorName].totalCents += amountCents;
	donors[donorName].donationCount += 1;
	donors[donorName].lastDonation = Date.now();

	saveDonors();

	res.json({
		ok: true,
		totalCents: donors[donorName].totalCents,
		donationCount: donors[donorName].donationCount
	});
});

// ===== STRIPE PAYMENTS =====
app.get('/api/stripe-config', (req, res) => {
	res.json({
		publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
		available: !!stripe
	});
});

app.post('/api/create-payment-intent', async (req, res) => {
	if (!stripe) {
		return res.json({ ok: false, error: 'Payments not configured on server' });
	}
	try {
		const { amount, username } = req.body;
		const chargeAmount = Math.max(50, Math.floor(Number(amount) || 100));

		const paymentIntent = await stripe.paymentIntents.create({
			amount: chargeAmount,
			currency: 'usd',
			description: 'Godot Playground Engine - Donation from ' + (username || 'Anonymous'),
			metadata: {
				username: username || 'Anonymous'
			},
			automatic_payment_methods: { enabled: true }
		});

		res.json({
			ok: true,
			clientSecret: paymentIntent.client_secret,
			paymentIntentId: paymentIntent.id
		});
	} catch (e) {
		console.error('Stripe error:', e.message);
		res.json({ ok: false, error: e.message });
	}
});

// ===== MULTIPLAYER =====
const queue = [];
const rooms = {};
let nextRoomId = 1;

function randomName() {
	const adj = ['Swift', 'Silent', 'Ghost', 'Blaze', 'Neon', 'Shadow', 'Cyber', 'Turbo', 'Phantom', 'Rogue'];
	const noun = ['Hunter', 'Warrior', 'Sniper', 'Wolf', 'Fox', 'Reaper', 'Blade', 'Storm', 'Fury', 'Viper'];
	return adj[Math.floor(Math.random() * adj.length)] + noun[Math.floor(Math.random() * noun.length)] + Math.floor(Math.random() * 100);
}

io.on('connection', (socket) => {
	console.log('Player connected:', socket.id);
	socket.data.name = randomName();

	socket.on('setUsername', (username) => {
		if (username && typeof username === 'string') {
			socket.data.name = username;
		}
	});

	socket.on('joinQueue', () => {
		console.log(socket.data.name + ' joined queue');
		if (!queue.includes(socket)) queue.push(socket);
		socket.emit('queueJoined', { position: queue.length, name: socket.data.name });

		if (queue.length >= 2) {
			const p1 = queue.shift();
			const p2 = queue.shift();
			const roomId = 'room_' + nextRoomId++;

			rooms[roomId] = {
				id: roomId,
				players: [p1.id, p2.id],
				scores: { [p1.id]: 0, [p2.id]: 0 },
				names: { [p1.id]: p1.data.name, [p2.id]: p2.data.name },
				startTime: Date.now(),
				duration: 60000
			};

			p1.join(roomId);
			p2.join(roomId);
			p1.data.roomId = roomId;
			p2.data.roomId = roomId;

			p1.emit('matchStart', {
				roomId: roomId,
				you: { id: p1.id, name: p1.data.name },
				opponent: { id: p2.id, name: p2.data.name },
				duration: 60
			});
			p2.emit('matchStart', {
				roomId: roomId,
				you: { id: p2.id, name: p2.data.name },
				opponent: { id: p1.id, name: p1.data.name },
				duration: 60
			});

			console.log('Match:', p1.data.name, 'vs', p2.data.name);
		}
	});

	socket.on('leaveQueue', () => {
		const idx = queue.indexOf(socket);
		if (idx !== -1) queue.splice(idx, 1);
	});

	socket.on('scorePoint', (points) => {
		const roomId = socket.data.roomId;
		if (!roomId || !rooms[roomId]) return;
		const p = Math.max(1, Math.min(10, Number(points) || 1));
		rooms[roomId].scores[socket.id] = (rooms[roomId].scores[socket.id] || 0) + p;

		const players = rooms[roomId].players;
		players.forEach(pid => {
			const targetSocket = io.sockets.sockets.get(pid);
			if (targetSocket) {
				const opponentId = players.find(x => x !== pid);
				targetSocket.emit('scoreUpdate', {
					yourScore: rooms[roomId].scores[pid] || 0,
					opponentScore: rooms[roomId].scores[opponentId] || 0
				});
			}
		});
	});

	// CHAT MESSAGES
	socket.on('chatMessage', (msg) => {
		const roomId = socket.data.roomId;
		if (!roomId || !rooms[roomId]) return;
		if (!msg || typeof msg !== 'string') return;
		const cleanMsg = msg.substring(0, 100).trim();
		if (!cleanMsg) return;

		const players = rooms[roomId].players;
		players.forEach(pid => {
			const targetSocket = io.sockets.sockets.get(pid);
			if (targetSocket) {
				targetSocket.emit('chatReceived', {
					from: socket.data.name,
					message: cleanMsg,
					isYou: pid === socket.id
				});
			}
		});
	});

	socket.on('leaveMatch', () => {
		const roomId = socket.data.roomId;
		if (roomId && rooms[roomId]) {
			socket.to(roomId).emit('opponentLeft');
			socket.leave(roomId);
			delete rooms[roomId];
			socket.data.roomId = null;
		}
	});

	socket.on('disconnect', () => {
		console.log('Disconnected:', socket.id);
		const idx = queue.indexOf(socket);
		if (idx !== -1) queue.splice(idx, 1);

		const roomId = socket.data.roomId;
		if (roomId && rooms[roomId]) {
			io.to(roomId).emit('opponentLeft');
			delete rooms[roomId];
		}
	});
});

setInterval(() => {
	for (const roomId in rooms) {
		const room = rooms[roomId];
		const elapsed = Date.now() - room.startTime;
		if (elapsed >= room.duration) {
			room.players.forEach(pid => {
				const targetSocket = io.sockets.sockets.get(pid);
				if (targetSocket) {
					const opponentId = room.players.find(x => x !== pid);
					targetSocket.emit('matchEnd', {
						yourScore: room.scores[pid] || 0,
						opponentScore: room.scores[opponentId] || 0
					});
				}
			});
			delete rooms[roomId];
		}
	}
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
	console.log('===================================');
	console.log('Godot Playground Engine Server');
	console.log('Running on http://localhost:' + PORT);
	console.log('Stripe:', stripe ? 'ENABLED' : 'DISABLED (no key)');
	console.log('===================================');
});
