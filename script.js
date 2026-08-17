import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { Sky } from 'three/addons/objects/Sky.js';

const $ = id => document.getElementById(id);
// ==================== MOBILE DETECTION ====================
const isMobile = /iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(navigator.userAgent) || 
                 (window.innerWidth <= 900 && 'ontouchstart' in window);

const SETTINGS = {
	graphics: 'balanced', sky: 'day', clouds: 'on', sun: 'on',
	shadowQuality: 'high', fov: 70, sensitivity: 10, volume: 0.75
};

// ==================== LOBBY MUSIC ====================
let lobbyMusic = null;
let lobbyMusicStarted = false;
let lobbyFadeInterval = null;

function ensureLobbyMusic() {
	if (lobbyMusic) return;
	lobbyMusic = new Audio('https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
	lobbyMusic.loop = true;
	lobbyMusic.preload = 'auto';
	lobbyMusic.volume = 0;
}

function startLobbyMusic() {
	ensureLobbyMusic();
	if (!lobbyMusic) return;
	clearInterval(lobbyFadeInterval);
	const targetVolume = Math.min(1, SETTINGS.volume * 0.45);
	if (!lobbyMusicStarted) {
		lobbyMusic.currentTime = 0;
		const playPromise = lobbyMusic.play();
		if (playPromise && typeof playPromise.then === 'function') {
			playPromise.catch(() => {});
		}
		lobbyMusicStarted = true;
	}
	lobbyFadeInterval = setInterval(() => {
		if (!lobbyMusic) { clearInterval(lobbyFadeInterval); return; }
		if (lobbyMusic.volume < targetVolume) {
			lobbyMusic.volume = Math.min(targetVolume, lobbyMusic.volume + 0.01);
		} else {
			clearInterval(lobbyFadeInterval);
		}
	}, 60);
}

function stopLobbyMusic(fadeDuration = 2.0) {
	if (!lobbyMusic) return;
	clearInterval(lobbyFadeInterval);
	const stepTime = 60;
	const steps = Math.max(1, Math.floor((fadeDuration * 1000) / stepTime));
	const stepAmount = lobbyMusic.volume / steps;
	lobbyFadeInterval = setInterval(() => {
		if (!lobbyMusic) { clearInterval(lobbyFadeInterval); return; }
		if (lobbyMusic.volume > stepAmount) {
			lobbyMusic.volume = Math.max(0, lobbyMusic.volume - stepAmount);
		} else {
			lobbyMusic.volume = 0;
			lobbyMusic.pause();
			lobbyMusicStarted = false;
			clearInterval(lobbyFadeInterval);
		}
	}, stepTime);
}
// =====================================================

const GameState = {
	started: false, mode: 'playground', autoFire: false, paused: false,
	username: null, isGuest: false, wins: 0, losses: 0,
	socket: null, myId: null, opponentId: null,
	opponentName: '', myName: '',
	inQueue: false, matchActive: false, matchTime: 60,
	myScore: 0, opponentScore: 0
};

const WEAPON = {
	id: 'ak47', name: 'AK-47',
	targetSize: 0.55,
	position: { x: 0.28, y: -0.22, z: -0.45 },
	rotation: { x: -0.08, y: Math.PI + 0.08, z: 0.05 },
	fireRate: 0.11, spread: 0.005, auto: true, recoil: 0.08, soundPitch: 1.0
};

let socket = null;
let baseGunScene = null;
const bulletHoles = [];
let MAX_BULLET_HOLES = 200;

function loadSocketIO() {
	return new Promise((resolve) => {
		if (window.io) { resolve(); return; }
		const script = document.createElement('script');
		script.src = '/socket.io/socket.io.js';
		script.onload = resolve;
		script.onerror = () => resolve();
		document.head.appendChild(script);
	});
}

let authMode = 'login';
$('loginTab').addEventListener('click', () => {
	authMode = 'login';
	$('loginTab').classList.add('active');
	$('signupTab').classList.remove('active');
	$('submitBtnText').textContent = 'LOGIN';
	$('authError').textContent = '';
});
$('signupTab').addEventListener('click', () => {
	authMode = 'signup';
	$('signupTab').classList.add('active');
	$('loginTab').classList.remove('active');
	$('submitBtnText').textContent = 'SIGN UP';
	$('authError').textContent = '';
});
$('submitAuthBtn').addEventListener('click', async () => {
	const username = $('usernameInput').value.trim();
	const password = $('passwordInput').value;
	if (!username || !password) { $('authError').textContent = 'Enter username and password'; return; }
	try {
		const res = await fetch('/api/' + authMode, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password })
		});
		const data = await res.json();
		if (data.ok) {
			GameState.username = data.username;
			GameState.isGuest = false;
			GameState.wins = data.wins || 0;
			GameState.losses = data.losses || 0;
			localStorage.setItem('browser_user', JSON.stringify({ username: data.username, password: password }));
			enterMainMenu();
		} else {
			$('authError').textContent = data.error || 'Failed';
		}
	} catch (e) {
		$('authError').textContent = 'Server error - try again';
	}
});

document.addEventListener('click', () => {
	if ($('mainMenu') && !$('mainMenu').classList.contains('hidden')) {
		startLobbyMusic();
	}
}, { passive: true });

$('guestBtn').addEventListener('click', () => {
	GameState.username = 'Guest' + Math.floor(Math.random() * 10000);
	GameState.isGuest = true;
	enterMainMenu();
});
$('passwordInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('submitAuthBtn').click(); });
$('usernameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('passwordInput').focus(); });

window.addEventListener('load', async () => {
	const saved = localStorage.getItem('browser_user');
	if (saved) {
		try {
			const { username, password } = JSON.parse(saved);
			const res = await fetch('/api/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const data = await res.json();
			if (data.ok) {
				GameState.username = data.username;
				GameState.isGuest = false;
				GameState.wins = data.wins || 0;
				GameState.losses = data.losses || 0;
				enterMainMenu();
			}
		} catch (e) {}
	}
});

function enterMainMenu() {
	$('authScreen').classList.add('hidden');
	$('mainMenu').classList.remove('hidden');
	$('loggedInName').textContent = GameState.username + (GameState.isGuest ? ' (Guest)' : '');
	$('userStats').textContent = GameState.wins + 'W / ' + GameState.losses + 'L';
	startLobbyMusic();
}

$('logoutBtn').addEventListener('click', () => {
	localStorage.removeItem('browser_user');
	location.reload();
});

$('startBtn').addEventListener('click', () => { GameState.mode = 'playground'; showLoading(); });
$('ball1v1Btn').addEventListener('click', () => { GameState.mode = 'ball1v1'; showQueue(); });
$('ctrlBtn').addEventListener('click', () => $('controlsPanel').classList.remove('hidden'));
$('aboutBtn').addEventListener('click', () => $('aboutPanel').classList.remove('hidden'));
$('settingsBtn').addEventListener('click', () => $('settingsPanel').classList.remove('hidden'));
$('ctrlBack').addEventListener('click', () => $('controlsPanel').classList.add('hidden'));
$('aboutBack').addEventListener('click', () => $('aboutPanel').classList.add('hidden'));
$('settingsBack').addEventListener('click', () => $('settingsPanel').classList.add('hidden'));

$('leaderboardBtn').addEventListener('click', () => {
	$('leaderboardPanel').classList.remove('hidden');
	loadLeaderboard();
});
$('leaderboardBack').addEventListener('click', () => $('leaderboardPanel').classList.add('hidden'));

async function loadLeaderboard() {
	const listEl = $('leaderboardList');
	listEl.innerHTML = '<div class="lb-loading">Loading rankings...</div>';
	try {
		const res = await fetch('/api/leaderboard');
		const data = await res.json();
		if (!data.ok || !data.leaderboard || data.leaderboard.length === 0) {
			listEl.innerHTML = '<div class="lb-empty">No players yet.<br>Be the first to win a match!</div>';
			$('leaderboardTotal').textContent = '0 players registered';
			return;
		}
		listEl.innerHTML = data.leaderboard.map((player, idx) => {
			const rank = idx + 1;
			const isMe = player.username === GameState.username;
			const rankLabel = idx === 0 ? '1ST' : idx === 1 ? '2ND' : idx === 2 ? '3RD' : '#' + rank;
			const rankClass = idx < 3 ? 'rank-' + (idx + 1) : '';
			const meClass = isMe ? 'me' : '';
			return `<div class="lb-entry ${rankClass} ${meClass}">
				<div class="lb-rank">#${rank}</div>
				<div class="lb-medal">${rankLabel}</div>
				<div class="lb-name">${escapeHtml(player.username)}${isMe ? '<span class="lb-you-tag">YOU</span>' : ''}</div>
				<div class="lb-stats">
					<div class="lb-stat"><span class="lb-stat-label">WINS</span><span class="lb-stat-value wins">${player.wins}</span></div>
					<div class="lb-stat"><span class="lb-stat-label">LOSS</span><span class="lb-stat-value losses">${player.losses}</span></div>
					<div class="lb-stat"><span class="lb-stat-label">WIN%</span><span class="lb-stat-value wr">${player.winRate}%</span></div>
				</div>
			</div>`;
		}).join('');
		$('leaderboardTotal').textContent = data.total + ' player' + (data.total !== 1 ? 's' : '') + ' registered';
	} catch (e) {
		listEl.innerHTML = '<div class="lb-empty">Failed to load leaderboard</div>';
	}
}

$('donorBoardBtn').addEventListener('click', () => {
	$('donorBoardPanel').classList.remove('hidden');
	loadDonorBoard();
});
$('donorBoardBack').addEventListener('click', () => $('donorBoardPanel').classList.add('hidden'));

async function loadDonorBoard() {
	const listEl = $('donorList');
	listEl.innerHTML = '<div class="lb-loading">Loading donors...</div>';
	try {
		const res = await fetch('/api/donors');
		const data = await res.json();
		if (!data.ok || !data.donors || data.donors.length === 0) {
			listEl.innerHTML = '<div class="lb-empty">No donations yet.<br>Be the first supporter!</div>';
			$('donorTotal').textContent = '$0.00 total donated';
			return;
		}
		listEl.innerHTML = data.donors.map((donor, idx) => {
			const rank = idx + 1;
			const isMe = donor.username === GameState.username;
			const rankLabel = idx === 0 ? 'TOP' : idx === 1 ? '2ND' : idx === 2 ? '3RD' : '#' + rank;
			const rankClass = idx < 3 ? 'rank-' + (idx + 1) : '';
			const meClass = isMe ? 'me' : '';
			const dollars = (donor.totalCents / 100).toFixed(2);
			return `<div class="lb-entry ${rankClass} ${meClass}">
				<div class="lb-rank">#${rank}</div>
				<div class="lb-medal">${rankLabel}</div>
				<div class="lb-name">${escapeHtml(donor.username)}${isMe ? '<span class="lb-you-tag">YOU</span>' : ''}</div>
				<div class="lb-stats">
					<div class="lb-stat"><span class="lb-stat-label">DONATED</span><span class="lb-stat-value donated">$${dollars}</span></div>
					<div class="lb-stat"><span class="lb-stat-label">TIMES</span><span class="lb-stat-value wr">${donor.donationCount}</span></div>
				</div>
			</div>`;
		}).join('');
		const totalDollars = (data.totalRaised / 100).toFixed(2);
		$('donorTotal').textContent = '$' + totalDollars + ' total donated by ' + data.total + ' supporter' + (data.total !== 1 ? 's' : '');
	} catch (e) {
		listEl.innerHTML = '<div class="lb-empty">Failed to load donors</div>';
	}
}

function escapeHtml(str) {
	const div = document.createElement('div');
	div.textContent = str;
	return div.innerHTML;
}

let stripe = null;
let stripeElements = null;
let stripeCardElement = null;
let selectedAmount = 100;

$('donateBtn').addEventListener('click', async () => {
	$('donatePopup').classList.remove('hidden');
	$('donateSuccess').classList.add('hidden');
	$('donateError').textContent = '';
	await initStripe();
});

$('donateBack').addEventListener('click', () => $('donatePopup').classList.add('hidden'));

async function initStripe() {
	if (stripe) return;
	try {
		const res = await fetch('/api/stripe-config');
		const cfg = await res.json();
		if (!cfg.publishableKey || !window.Stripe) {
			$('donateError').textContent = 'Payment system unavailable';
			return;
		}
		stripe = Stripe(cfg.publishableKey);
		stripeElements = stripe.elements();
		stripeCardElement = stripeElements.create('card', {
			style: {
				base: {
					color: '#ffffff',
					fontFamily: 'Rajdhani, sans-serif',
					fontSize: '16px',
					'::placeholder': { color: '#5a6a90' }
				},
				invalid: { color: '#ff4455' }
			}
		});
		stripeCardElement.mount('#stripeCardElement');
	} catch (e) {
		$('donateError').textContent = 'Failed to load payment system';
	}
}

document.querySelectorAll('.donate-amount').forEach(btn => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('.donate-amount').forEach(b => b.classList.remove('active'));
		btn.classList.add('active');
		selectedAmount = parseInt(btn.dataset.cents);
		$('customAmount').value = '';
		updateDonateLabel();
	});
});

$('customAmount').addEventListener('input', (e) => {
	const dollars = parseFloat(e.target.value);
	if (!isNaN(dollars) && dollars >= 0.5) {
		selectedAmount = Math.floor(dollars * 100);
		document.querySelectorAll('.donate-amount').forEach(b => b.classList.remove('active'));
		updateDonateLabel();
	}
});

function updateDonateLabel() {
	$('donateAmountLabel').textContent = '$' + (selectedAmount / 100).toFixed(2);
}

$('donateSubmitBtn').addEventListener('click', async () => {
	if (!stripe || !stripeCardElement) { $('donateError').textContent = 'Payment system not ready'; return; }
	if (selectedAmount < 50) { $('donateError').textContent = 'Minimum donation is $0.50 (Stripe requirement)'; return; }

	$('donateError').textContent = '';
	$('donateSubmitBtn').disabled = true;
	$('donateSubmitBtn').innerHTML = 'Processing...';

	try {
		const res = await fetch('/api/create-payment-intent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ amount: selectedAmount, username: GameState.username || 'Anonymous' })
		});
		const data = await res.json();
		if (!data.ok) {
			$('donateError').textContent = data.error || 'Payment failed';
			resetDonateBtn();
			return;
		}
		const result = await stripe.confirmCardPayment(data.clientSecret, {
			payment_method: {
				card: stripeCardElement,
				billing_details: { name: GameState.username || 'Anonymous' }
			}
		});
		if (result.error) {
			$('donateError').textContent = result.error.message;
			resetDonateBtn();
		} else if (result.paymentIntent.status === 'succeeded') {
			try {
				await fetch('/api/recordDonation', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						username: GameState.username || 'Anonymous',
						amountCents: selectedAmount
					})
				});
			} catch (e) {}

			$('donateSuccess').classList.remove('hidden');
			$('donateSubmitBtn').style.display = 'none';
			setTimeout(() => {
				$('donatePopup').classList.add('hidden');
				$('donateSubmitBtn').style.display = '';
				$('donateSuccess').classList.add('hidden');
				resetDonateBtn();
			}, 3500);
		}
	} catch (e) {
		$('donateError').textContent = 'Payment error - please try again';
		resetDonateBtn();
	}
});

function resetDonateBtn() {
	$('donateSubmitBtn').disabled = false;
	$('donateSubmitBtn').innerHTML = '<svg class="mbtn-icon"><use href="#icon-heart"/></svg> DONATE <span id="donateAmountLabel">$' + (selectedAmount/100).toFixed(2) + '</span>';
}

$('cancelQueueBtn').addEventListener('click', cancelQueue);
$('playAgainBtn').addEventListener('click', () => { $('endScreen').classList.add('hidden'); showQueue(); });
$('backMenuBtn').addEventListener('click', quitToMenu);
$('quitToMenuBtn').addEventListener('click', quitToMenu);
$('resumeBtn').addEventListener('click', resumeGame);
$('quitFromPauseBtn').addEventListener('click', quitToMenu);

function quitToMenu() {
	GameState.started = false;
	GameState.matchActive = false;
	GameState.paused = false;
	if (socket && GameState.opponentId) socket.emit('leaveMatch');
	$('infoOverlay').classList.add('hidden');
	$('ball1v1HUD').classList.add('hidden');
	$('endScreen').classList.add('hidden');
	$('pauseMenu').classList.add('hidden');
	$('clickPrompt').classList.add('hidden');
	$('weaponHUD').classList.add('hidden');
	const chatC = $('chatContainer'); if (chatC) chatC.classList.add('hidden');
	const chatI = $('chatInputWrap'); if (chatI) chatI.classList.add('hidden');
	const qcw = $('quickChatWheel'); if (qcw) qcw.classList.add('hidden');
	chatOpen = false;
	quickChatOpen = false;
	$('mainMenu').classList.remove('hidden');
	if (document.pointerLockElement) document.exitPointerLock();
	startLobbyMusic();
	if (isMobile) $('mobileControls').classList.add('hidden');
}

function resumeGame() {
	GameState.paused = false;
	$('pauseMenu').classList.add('hidden');
	document.body.requestPointerLock();
}

function pauseGame() {
	if (!GameState.started) return;
	GameState.paused = true;
	$('pauseMenu').classList.remove('hidden');
	if (document.pointerLockElement) document.exitPointerLock();
}

$('graphicsPreset').addEventListener('change', e => { SETTINGS.graphics = e.target.value; applyGraphicsPreset(); });
$('skyMode').addEventListener('change', e => { SETTINGS.sky = e.target.value; applySky(); });
$('cloudsToggle').addEventListener('change', e => { SETTINGS.clouds = e.target.value; applyClouds(); });
$('sunToggle').addEventListener('change', e => { SETTINGS.sun = e.target.value; applySun(); });
$('shadowQuality').addEventListener('change', e => { SETTINGS.shadowQuality = e.target.value; applyShadows(); });
$('fovSlider').addEventListener('input', e => {
	SETTINGS.fov = +e.target.value;
	$('fovVal').textContent = e.target.value;
	if (camera) { camera.fov = SETTINGS.fov + (sprintFovBoost || 0); camera.updateProjectionMatrix(); }
});
$('sensSlider').addEventListener('input', e => {
	SETTINGS.sensitivity = +e.target.value;
	$('sensVal').textContent = e.target.value;
});
$('volSlider').addEventListener('input', e => {
	SETTINGS.volume = +e.target.value / 100;
	$('volVal').textContent = e.target.value;
	if (masterGain) masterGain.gain.value = SETTINGS.volume;
	if (lobbyMusic && !lobbyMusic.paused) {
		lobbyMusic.volume = Math.min(1, SETTINGS.volume * 0.45);
	}
});

async function showQueue() {
	stopLobbyMusic(1.5);
	$('mainMenu').classList.add('hidden');
	$('queueScreen').classList.remove('hidden');
	$('queueStatus').textContent = 'CONNECTING TO SERVER...';
	$('queueSubtext').textContent = 'Please wait...';
	await loadSocketIO();
	if (!window.io) {
		$('queueStatus').textContent = 'SERVER UNAVAILABLE';
		$('queueSubtext').textContent = 'Multiplayer requires the Node server.';
		return;
	}
	if (!socket) {
		socket = io();
		setupSocketHandlers();
	}
	socket.emit('setUsername', GameState.username);
	socket.emit('joinQueue');
	GameState.inQueue = true;
	$('queueStatus').textContent = 'SEARCHING FOR OPPONENT';
	$('queueSubtext').textContent = 'Logged in as "' + GameState.username + '"';
}

function cancelQueue() {
	if (socket) socket.emit('leaveQueue');
	GameState.inQueue = false;
	$('queueScreen').classList.add('hidden');
	$('mainMenu').classList.remove('hidden');
	startLobbyMusic();
}

function setupSocketHandlers() {
	socket.on('chatReceived', (data) => {
		addChatMessage(data.from, data.message, data.isYou);
		if (!data.isYou) playChatSound();
	});
	socket.on('queueJoined', () => {
		$('queueSubtext').textContent = 'You are "' + GameState.username + '" - waiting...';
	});
	socket.on('matchStart', (data) => {
		GameState.inQueue = false;
		GameState.matchActive = true;
		GameState.myScore = 0;
		GameState.opponentScore = 0;
		GameState.myId = data.you.id;
		GameState.myName = data.you.name;
		GameState.opponentId = data.opponent.id;
		GameState.opponentName = data.opponent.name;
		$('queueScreen').classList.add('hidden');
		$('matchFoundOverlay').classList.remove('hidden');
		$('foundMyName').textContent = GameState.myName;
		$('foundOpponentName').textContent = GameState.opponentName;
		playMatchFoundChime();
		setTimeout(() => {
			$('matchFoundOverlay').classList.add('hidden');
			showLoading();
		}, 2500);
	});
	socket.on('scoreUpdate', (data) => {
		const oldMyScore = GameState.myScore;
		GameState.myScore = data.yourScore || 0;
		GameState.opponentScore = data.opponentScore || 0;
		if (GameState.myScore > oldMyScore) playScorePoint();
		updateBall1v1HUD();
	});
	socket.on('matchEnd', (data) => {
		GameState.myScore = data.yourScore || 0;
		GameState.opponentScore = data.opponentScore || 0;
		endMatch();
	});
	socket.on('opponentLeft', () => {
		if (GameState.matchActive) {
			GameState.matchActive = false;
			$('ball1v1HUD').classList.add('hidden');
			$('endScreen').classList.remove('hidden');
			$('endTitle').textContent = 'OPPONENT LEFT';
			$('endTitle').className = 'end-title victory';
			$('endIcon').innerHTML = '<img src="/icons/icon-192.png" style="width:150px;border-radius:20px;filter:drop-shadow(0 0 40px rgba(72,116,255,0.8));">';
			$('endSubtitle').textContent = 'VICTORY BY DEFAULT!';
			$('finalPlayerScore').textContent = GameState.myScore;
			$('finalBotScore').textContent = GameState.opponentScore;
			playVictoryFanfare();
			if (document.pointerLockElement) document.exitPointerLock();
			updateStatsOnServer(true);
		}
	});
}

async function updateStatsOnServer(won) {
	if (GameState.isGuest || !GameState.username) return;
	try {
		const res = await fetch('/api/updateStats', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: GameState.username, won: won })
		});
		const data = await res.json();
		if (data.ok) {
			GameState.wins = data.wins;
			GameState.losses = data.losses;
			$('userStats').textContent = GameState.wins + 'W / ' + GameState.losses + 'L';
		}
	} catch (e) {}
}

function showLoading() {
	$('mainMenu').classList.add('hidden');
	$('loading').classList.remove('hidden');
	const steps = ['Initializing engine...', 'Building arena...', 'Loading AK-47...', 'Placing balls...', 'Ready!'];
	let p = 0;
	const iv = setInterval(() => {
		p += Math.random() * 18 + 8;
		if (p > 100) p = 100;
		$('loadFill').style.width = p + '%';
		const si = Math.min(steps.length - 1, Math.floor(p / 100 * steps.length));
		$('loadMsg').textContent = steps[si];
		if (p >= 100) { clearInterval(iv); setTimeout(startGame, 400); }
	}, 200);
}

function startGame() {
	stopLobbyMusic(2.0);
	$('loading').classList.add('hidden');
	$('infoOverlay').classList.remove('hidden');
	$('weaponHUD').classList.remove('hidden');
	GameState.started = true;
	GameState.paused = false;
	initAudioSystem();
	applyGraphicsPreset();
	applySky();
	applyClouds();
	applySun();
	applyShadows();
	loadAK47();
	if (GameState.mode === 'ball1v1') startBall1v1();
}

const clock = new THREE.Clock();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x88ccee);
scene.fog = new THREE.Fog(0x88ccee, 0, 60);

const camera = new THREE.PerspectiveCamera(SETTINGS.fov, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.rotation.order = 'YXZ';
scene.add(camera);

const ambientLight = new THREE.AmbientLight(0x8dc1de, 0.6);
scene.add(ambientLight);
const hemiLight = new THREE.HemisphereLight(0x8dc1de, 0x00668d, 1.2);
hemiLight.position.set(2, 1, 1);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
sunLight.position.set(-30, 60, -20);
sunLight.castShadow = true;
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 200;
sunLight.shadow.camera.right = 50;
sunLight.shadow.camera.left = -50;
sunLight.shadow.camera.top = 50;
sunLight.shadow.camera.bottom = -50;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024;
sunLight.shadow.radius = 4;
sunLight.shadow.bias = -0.00006;
scene.add(sunLight);

const sunGroup = new THREE.Group();
sunGroup.position.set(-200, 150, -150);
scene.add(sunGroup);

function createSunSprite(size, color, opacity) {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 256;
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
	const c = new THREE.Color(color);
	const r = Math.floor(c.r * 255);
	const g = Math.floor(c.g * 255);
	const b = Math.floor(c.b * 255);
	gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
	gradient.addColorStop(0.3, `rgba(${r}, ${g}, ${b}, 0.6)`);
	gradient.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.2)`);
	gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 256, 256);

	const texture = new THREE.CanvasTexture(canvas);
	const material = new THREE.SpriteMaterial({
		map: texture,
		transparent: true,
		opacity: opacity,
		blending: THREE.AdditiveBlending,
		fog: false,
		depthWrite: false,
		depthTest: true
	});
	const sprite = new THREE.Sprite(material);
	sprite.scale.set(size, size, 1);
	return sprite;
}

const sunCore = createSunSprite(30, 0xffffff, 1.0);
const sunInner = createSunSprite(60, 0xfff4c4, 0.9);
const sunMid = createSunSprite(100, 0xffcc66, 0.6);
const sunOuter = createSunSprite(180, 0xff8833, 0.35);
const sunHalo = createSunSprite(300, 0xffaa44, 0.15);
sunGroup.add(sunHalo);
sunGroup.add(sunOuter);
sunGroup.add(sunMid);
sunGroup.add(sunInner);
sunGroup.add(sunCore);

const sunLayers = {
	core: sunCore.material,
	inner: sunInner.material,
	mid: sunMid.material,
	outer: sunOuter.material,
	halo: sunHalo.material
};

const gunKeyLight = new THREE.PointLight(0xffffff, 3.0, 1.5, 2);
gunKeyLight.position.set(-0.2, 0.2, -0.3);
camera.add(gunKeyLight);

const gunFillLight = new THREE.PointLight(0x88bbff, 1.5, 1.5, 2);
gunFillLight.position.set(0.5, -0.1, -0.2);
camera.add(gunFillLight);

const gunRimLight = new THREE.PointLight(0xffddaa, 2.0, 1.5, 2);
gunRimLight.position.set(0.3, 0.1, -0.8);
camera.add(gunRimLight);

const sky = new Sky();
sky.scale.setScalar(1000);
scene.add(sky);
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 8;
skyUniforms['rayleigh'].value = 2;
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.8;

const sunPosition = new THREE.Vector3();
function updateSkySun(elevation, azimuth) {
	const phi = THREE.MathUtils.degToRad(90 - elevation);
	const theta = THREE.MathUtils.degToRad(azimuth);
	sunPosition.setFromSphericalCoords(1, phi, theta);
	skyUniforms['sunPosition'].value.copy(sunPosition);
}
updateSkySun(15, -140);

const clouds = [];
let cloudTex = null;
function generateClouds() {
	clouds.forEach(c => scene.remove(c));
	clouds.length = 0;
	if (!cloudTex) cloudTex = createCloudTexture();
	const count = SETTINGS.graphics === 'performance' ? 8 : SETTINGS.graphics === 'balanced' ? 15 : 25;
	for (let i = 0; i < count; i++) {
		const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide });
		const cloud = new THREE.Mesh(new THREE.PlaneGeometry(30 + Math.random() * 40, 15 + Math.random() * 20), cloudMat);
		cloud.position.set((Math.random() - 0.5) * 400, 60 + Math.random() * 40, (Math.random() - 0.5) * 400);
		cloud.rotation.x = -Math.PI / 2;
		cloud.rotation.z = Math.random() * Math.PI;
		cloud.userData.driftSpeed = 0.5 + Math.random() * 1;
		cloud.frustumCulled = true;
		scene.add(cloud);
		clouds.push(cloud);
	}
}

function createCloudTexture() {
	const canvas = document.createElement('canvas');
	canvas.width = 128; canvas.height = 128;
	const ctx = canvas.getContext('2d');
	const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
	g.addColorStop(0, 'rgba(255,255,255,1)');
	g.addColorStop(0.3, 'rgba(255,255,255,0.9)');
	g.addColorStop(0.6, 'rgba(255,255,255,0.4)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(canvas);
}

function applyGraphicsPreset() {
	if (SETTINGS.graphics === 'potato') {
		renderer.setPixelRatio(0.5);
		renderer.shadowMap.enabled = false;
		sunLight.castShadow = false;
		scene.fog.far = 25;
		hemiLight.intensity = 0.8;
		MAX_BULLET_HOLES = 10;
		clouds.forEach(c => c.visible = false);
		sunGroup.visible = false;
	} else if (SETTINGS.graphics === 'performance') {
		renderer.setPixelRatio(0.75);
		renderer.shadowMap.enabled = false;
		sunLight.castShadow = false;
		scene.fog.far = 40;
	} else if (SETTINGS.graphics === 'balanced') {
		renderer.setPixelRatio(1);
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;
		sunLight.castShadow = true;
		sunLight.shadow.mapSize.width = 1024;
		sunLight.shadow.mapSize.height = 1024;
		scene.fog.far = 60;
	} else if (SETTINGS.graphics === 'ultra') {
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		sunLight.castShadow = true;
		sunLight.shadow.mapSize.width = 2048;
		sunLight.shadow.mapSize.height = 2048;
		scene.fog.far = 100;
	}
}

function applySky() {
	const s = SETTINGS.sky;
	if (s === 'day') {
		updateSkySun(15, -140);
		scene.fog.color.setHex(0x88ccee);
		scene.background = new THREE.Color(0x88ccee);
		ambientLight.color.setHex(0x8dc1de); ambientLight.intensity = 0.6;
		sunLight.color.setHex(0xffffff); sunLight.intensity = 3.0;
		sunLayers.core.color.setHex(0xffffff);
		sunLayers.inner.color.setHex(0xfff4c4);
		sunLayers.mid.color.setHex(0xffcc66);
		sunLayers.outer.color.setHex(0xff8833);
		sky.visible = true;
	} else if (s === 'sunset') {
		updateSkySun(3, -140);
		scene.fog.color.setHex(0xff8844);
		ambientLight.color.setHex(0xff7744); ambientLight.intensity = 0.5;
		sunLight.color.setHex(0xffaa66); sunLight.intensity = 2.5;
		sky.visible = true;
	} else if (s === 'night') {
		sky.visible = false;
		scene.background = new THREE.Color(0x000818);
		scene.fog.color.setHex(0x000818);
		ambientLight.color.setHex(0x223366); ambientLight.intensity = 0.35;
		sunLight.color.setHex(0x8899ff); sunLight.intensity = 0.6;
	} else if (s === 'storm') {
		sky.visible = false;
		scene.background = new THREE.Color(0x333340);
		scene.fog.color.setHex(0x444455);
		ambientLight.color.setHex(0x555566); ambientLight.intensity = 0.5;
	} else if (s === 'alien') {
		sky.visible = false;
		scene.background = new THREE.Color(0x330066);
		scene.fog.color.setHex(0x440088);
		ambientLight.color.setHex(0x8844ff); ambientLight.intensity = 0.7;
	} else if (s === 'blood') {
		sky.visible = false;
		scene.background = new THREE.Color(0x330000);
		scene.fog.color.setHex(0x550000);
		ambientLight.color.setHex(0xaa2222); ambientLight.intensity = 0.6;
	} else if (s === 'green') {
		sky.visible = false;
		scene.background = new THREE.Color(0x003300);
		scene.fog.color.setHex(0x005500);
		ambientLight.color.setHex(0x33aa33); ambientLight.intensity = 0.7;
	}
}

function applyClouds() {
	if (SETTINGS.clouds === 'on') {
		if (clouds.length === 0) generateClouds();
		clouds.forEach(c => c.visible = true);
	} else clouds.forEach(c => c.visible = false);
}

function applySun() {
	sunGroup.visible = SETTINGS.sun === 'on';
	sunLight.visible = SETTINGS.sun === 'on';
}

function applyShadows() {
	if (SETTINGS.shadowQuality === 'off') {
		renderer.shadowMap.enabled = false;
		sunLight.castShadow = false;
	} else {
		renderer.shadowMap.enabled = true;
		sunLight.castShadow = true;
		if (SETTINGS.shadowQuality === 'low') { sunLight.shadow.mapSize.width = 512; sunLight.shadow.mapSize.height = 512; renderer.shadowMap.type = THREE.BasicShadowMap; }
		else if (SETTINGS.shadowQuality === 'high') { sunLight.shadow.mapSize.width = 1024; sunLight.shadow.mapSize.height = 1024; renderer.shadowMap.type = THREE.PCFShadowMap; }
		else if (SETTINGS.shadowQuality === 'ultra') { sunLight.shadow.mapSize.width = 2048; sunLight.shadow.mapSize.height = 2048; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
	}
}

const container = document.body;
const renderer = new THREE.WebGLRenderer({
	antialias: false, powerPreference: 'high-performance',
	stencil: false, depth: true
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const GRAVITY = 30;
const NUM_SPHERES = 100000000000;
const SPHERE_RADIUS = 0.2;
const STEPS_PER_FRAME = 3;

const sphereGeometry = new THREE.SphereGeometry(SPHERE_RADIUS, 16, 12);
const spheres = [];
let sphereIdx = 0;

const BALL_COLORS = [0xff3333, 0x3388ff, 0x33dd44, 0xff44cc, 0x222222, 0xffffff, 0xffcc00, 0xaa44ff, 0xff8800, 0x00eecc];

for (let i = 0; i < NUM_SPHERES; i++) {
	const mat = new THREE.MeshStandardMaterial({ color: 0xdede8d, roughness: 0.4, metalness: 0.2 });
	const sphere = new THREE.Mesh(sphereGeometry, mat);
	sphere.castShadow = true;
	sphere.receiveShadow = false;
	scene.add(sphere);
	spheres.push({
		mesh: sphere,
		collider: new THREE.Sphere(new THREE.Vector3(0, -100, 0), SPHERE_RADIUS),
		velocity: new THREE.Vector3(),
		alive: false,
		shotFor: false
	});
}

const worldOctree = new Octree();
const playerCollider = new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35);
const playerVelocity = new THREE.Vector3();
const playerDirection = new THREE.Vector3();
let playerOnFloor = false;
let mouseTime = 0;
const keyStates = {};
const vector1 = new THREE.Vector3();
const vector2 = new THREE.Vector3();
const vector3 = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

let mapMeshes = [];

function startBall1v1() {
	GameState.matchActive = true;
	GameState.matchTime = 60;
	$('ball1v1HUD').classList.remove('hidden');
	scatterBalls();
	updateBall1v1HUD();
}

function scatterBalls() {
	spheres.forEach((s) => {
		const randomColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
		s.mesh.material.color.setHex(randomColor);
		s.mesh.material.emissive.setHex(randomColor);
		s.mesh.material.emissiveIntensity = 0.2;
		s.collider.center.set((Math.random() - 0.5) * 30, 5 + Math.random() * 3, (Math.random() - 0.5) * 30);
		s.velocity.set(0, 0, 0);
		s.alive = true;
		s.shotFor = false;
		s.mesh.visible = true;
	});
}

function updateBall1v1HUD() {
	$('playerScoreVal').textContent = GameState.myScore;
	$('botScoreVal').textContent = GameState.opponentScore;
	$('matchTimer').textContent = Math.max(0, Math.ceil(GameState.matchTime));
	$('opponentNameLabel').textContent = GameState.opponentName || 'OPPONENT';
	$('myNameLabel').textContent = GameState.myName || GameState.username || 'YOU';
}

function endMatch() {
	GameState.matchActive = false;
	$('ball1v1HUD').classList.add('hidden');
	$('endScreen').classList.remove('hidden');

	let won = false;
	if (GameState.myScore > GameState.opponentScore) {
		won = true;
		playVictoryFanfare();
		$('endTitle').textContent = 'BROWSER VICTORY';
		$('endTitle').className = 'end-title victory';
		$('endIcon').innerHTML = '<img src="/icons/icon-192.png" style="width:150px;border-radius:20px;filter:drop-shadow(0 0 40px rgba(72,116,255,0.8));">';
		$('endSubtitle').textContent = 'YOU BEAT ' + (GameState.opponentName || 'OPPONENT').toUpperCase() + '!';
	} else if (GameState.myScore < GameState.opponentScore) {
		playDefeatSound();
		$('endTitle').textContent = 'YOU LOST';
		$('endTitle').className = 'end-title defeat';
		$('endIcon').innerHTML = '<svg width="150" height="150" viewBox="0 0 24 24" style="color:#ff4444;filter:drop-shadow(0 0 30px rgba(255,68,68,0.6));"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" transform="rotate(180 12 12)"/></svg>';
		$('endSubtitle').textContent = (GameState.opponentName || 'OPPONENT').toUpperCase() + ' BEAT YOU!';
	} else {
		$('endTitle').textContent = 'TIE GAME';
		$('endTitle').className = 'end-title tie';
		$('endIcon').innerHTML = '<svg width="150" height="150" viewBox="0 0 24 24" style="color:#ffcc00;filter:drop-shadow(0 0 30px rgba(255,204,0,0.6));"><path fill="currentColor" d="M11 2v2H9V2h2zm6 3l-3 3v2h-2v-2l-3-3H6v2l3 3v2h6v-2l3-3V5h-1zM4 12v8h16v-8h-2v6H6v-6H4z"/></svg>';
		$('endSubtitle').textContent = 'CLOSE MATCH!';
	}
	$('finalPlayerScore').textContent = GameState.myScore;
	$('finalBotScore').textContent = GameState.opponentScore;
	if (document.pointerLockElement) document.exitPointerLock();
	if (GameState.myScore !== GameState.opponentScore) updateStatsOnServer(won);
}

let audioCtx = null;
let gunshotBuffer = null;
let sharedReverbNode = null;
let echoDelay = null;
let echoFeedback = null;
let masterGain = null;
let reverbSend = null;
let activeSourceCount = 0;
const MAX_ACTIVE_SOURCES = 15;

async function initAudioSystem() {
	if (audioCtx) return;
	try {
		audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		masterGain = audioCtx.createGain();
		masterGain.gain.value = SETTINGS.volume;
		masterGain.connect(audioCtx.destination);

		const reverbBuffer = createSmoothReverb(audioCtx, 2.0, 3.0);
		sharedReverbNode = audioCtx.createConvolver();
		sharedReverbNode.buffer = reverbBuffer;
		const reverbFilter = audioCtx.createBiquadFilter();
		reverbFilter.type = 'lowpass';
		reverbFilter.frequency.value = 3000;
		reverbSend = audioCtx.createGain();
		reverbSend.gain.value = 0.32;
		sharedReverbNode.connect(reverbFilter);
		reverbFilter.connect(reverbSend);
		reverbSend.connect(masterGain);

		echoDelay = audioCtx.createDelay(1.0);
		echoDelay.delayTime.value = 0.24;
		echoFeedback = audioCtx.createGain();
		echoFeedback.gain.value = 0.32;
		const echoFilter = audioCtx.createBiquadFilter();
		echoFilter.type = 'lowpass';
		echoFilter.frequency.value = 1500;
		const echoOut = audioCtx.createGain();
		echoOut.gain.value = 0.38;
		echoDelay.connect(echoFilter);
		echoFilter.connect(echoFeedback);
		echoFeedback.connect(echoDelay);
		echoFilter.connect(echoOut);
		echoOut.connect(masterGain);

		const response = await fetch('./sounds/ak47_shot.wav');
		const arrayBuffer = await response.arrayBuffer();
		gunshotBuffer = await audioCtx.decodeAudioData(arrayBuffer);
	} catch (e) { console.warn('Audio failed', e); }
}

function createSmoothReverb(ctx, duration, decay) {
	const sampleRate = ctx.sampleRate;
	const length = sampleRate * duration;
	const impulse = ctx.createBuffer(2, length, sampleRate);
	const impulseL = impulse.getChannelData(0);
	const impulseR = impulse.getChannelData(1);
	for (let i = 0; i < length; i++) {
		const t = i / length;
		const envelope = Math.exp(-t * decay);
		impulseL[i] = (Math.random() * 2 - 1) * envelope;
		impulseR[i] = (Math.random() * 2 - 1) * envelope;
	}
	return impulse;
}

function playGunshot(pitchMult = 1.0) {
	if (!audioCtx || !gunshotBuffer) return;
	if (activeSourceCount >= MAX_ACTIVE_SOURCES) return;
	try {
		const now = audioCtx.currentTime;
		activeSourceCount++;
		const source = audioCtx.createBufferSource();
		source.buffer = gunshotBuffer;
		source.playbackRate.value = pitchMult * (0.92 + Math.random() * 0.16);
		const mainGain = audioCtx.createGain();
		mainGain.gain.value = 0.6;
		source.connect(mainGain);
		mainGain.connect(masterGain);
		mainGain.connect(sharedReverbNode);
		mainGain.connect(echoDelay);
		source.onended = () => { activeSourceCount--; };
		source.start(now);
		const bass = audioCtx.createOscillator();
		const bassGain = audioCtx.createGain();
		bass.type = 'sine';
		bass.frequency.setValueAtTime(130 * pitchMult, now);
		bass.frequency.exponentialRampToValueAtTime(30, now + 0.22);
		bassGain.gain.setValueAtTime(0, now);
		bassGain.gain.linearRampToValueAtTime(0.75, now + 0.003);
		bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
		bass.connect(bassGain);
		bassGain.connect(masterGain);
		bass.start(now);
		bass.stop(now + 0.25);
	} catch (e) { activeSourceCount--; }
}

function playHitSound() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(2000, now);
		osc.frequency.exponentialRampToValueAtTime(400, now + 0.15);
		gain.gain.setValueAtTime(0.22, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
		osc.connect(gain); gain.connect(masterGain);
		osc.start(now); osc.stop(now + 0.15);
	} catch (e) {}
}

function playMatchFoundChime() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		[523, 659, 784].forEach((freq, i) => {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0, now + i * 0.12);
			gain.gain.linearRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.6);
			osc.connect(gain); gain.connect(masterGain);
			osc.start(now + i * 0.12);
			osc.stop(now + i * 0.12 + 0.6);
		});
	} catch (e) {}
}

function playCountdownBeep(isFinal) {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.type = 'square';
		osc.frequency.value = isFinal ? 880 : 440;
		gain.gain.setValueAtTime(0.15, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
		osc.connect(gain); gain.connect(masterGain);
		osc.start(now); osc.stop(now + 0.15);
	} catch (e) {}
}

function playScorePoint() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(1200, now);
		osc.frequency.exponentialRampToValueAtTime(1800, now + 0.1);
		gain.gain.setValueAtTime(0.12, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
		osc.connect(gain); gain.connect(masterGain);
		osc.start(now); osc.stop(now + 0.15);
	} catch (e) {}
}

function playVictoryFanfare() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const notes = [523, 659, 784, 1047, 1319];
		notes.forEach((freq, i) => {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = 'triangle';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0, now + i * 0.15);
			gain.gain.linearRampToValueAtTime(0.2, now + i * 0.15 + 0.03);
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.5);
			osc.connect(gain); gain.connect(masterGain);
			osc.start(now + i * 0.15);
			osc.stop(now + i * 0.15 + 0.5);
		});
	} catch (e) {}
}

function playDefeatSound() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const notes = [523, 466, 415, 349];
		notes.forEach((freq, i) => {
			const osc = audioCtx.createOscillator();
			const gain = audioCtx.createGain();
			osc.type = 'sawtooth';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0, now + i * 0.25);
			gain.gain.linearRampToValueAtTime(0.15, now + i * 0.25 + 0.05);
			gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.25 + 0.7);
			osc.connect(gain); gain.connect(masterGain);
			osc.start(now + i * 0.25);
			osc.stop(now + i * 0.25 + 0.7);
		});
	} catch (e) {}
}

function playChatSound() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		const osc = audioCtx.createOscillator();
		const gain = audioCtx.createGain();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(1000, now);
		osc.frequency.linearRampToValueAtTime(1400, now + 0.05);
		gain.gain.setValueAtTime(0.1, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
		osc.connect(gain); gain.connect(masterGain);
		osc.start(now); osc.stop(now + 0.1);
	} catch (e) {}
}

function playFootstep(volume = 1.0) {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;
		footstepIndex = 1 - footstepIndex;
		const pitchVariation = footstepIndex === 0 ? 1.0 : 0.85;

		const bufferSize = audioCtx.sampleRate * 0.3;
		const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) {
			const t = i / bufferSize;
			const envelope = Math.pow(1 - t, 2);
			data[i] = (Math.random() * 2 - 1) * envelope;
		}

		const noise = audioCtx.createBufferSource();
		noise.buffer = buffer;
		noise.playbackRate.value = pitchVariation;

		const filter = audioCtx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 300 * pitchVariation;
		filter.Q.value = 3;

		const gain = audioCtx.createGain();
		gain.gain.setValueAtTime(0.4 * volume, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

		noise.connect(filter);
		filter.connect(gain);
		gain.connect(masterGain);

		const thump = audioCtx.createOscillator();
		const thumpGain = audioCtx.createGain();
		thump.type = 'sine';
		thump.frequency.setValueAtTime(50 * pitchVariation, now);
		thump.frequency.exponentialRampToValueAtTime(25, now + 0.2);
		thumpGain.gain.setValueAtTime(0.55 * volume, now);
		thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
		thump.connect(thumpGain);
		thumpGain.connect(masterGain);

		const subBass = audioCtx.createOscillator();
		const subGain = audioCtx.createGain();
		subBass.type = 'sine';
		subBass.frequency.setValueAtTime(32 * pitchVariation, now);
		subBass.frequency.exponentialRampToValueAtTime(16, now + 0.25);
		subGain.gain.setValueAtTime(0.45 * volume, now);
		subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
		subBass.connect(subGain);
		subGain.connect(masterGain);

		noise.start(now);
		noise.stop(now + 0.3);
		thump.start(now);
		thump.stop(now + 0.25);
		subBass.start(now);
		subBass.stop(now + 0.3);
	} catch (e) {}
}

function playSlideSound() {
	if (!audioCtx) return;
	try {
		const now = audioCtx.currentTime;

		const bufferSize = audioCtx.sampleRate * 1.0;
		const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < bufferSize; i++) {
			const t = i / bufferSize;
			const envelope = Math.pow(1 - t, 1.3);
			data[i] = (Math.random() * 2 - 1) * envelope;
		}

		const noise = audioCtx.createBufferSource();
		noise.buffer = buffer;

		const filter = audioCtx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.setValueAtTime(700, now);
		filter.frequency.exponentialRampToValueAtTime(180, now + 1.0);
		filter.Q.value = 1.5;

		const gain = audioCtx.createGain();
		gain.gain.setValueAtTime(0.45, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

		noise.connect(filter);
		filter.connect(gain);
		gain.connect(masterGain);

		const rumble = audioCtx.createOscillator();
		const rumbleGain = audioCtx.createGain();
		rumble.type = 'sine';
		rumble.frequency.setValueAtTime(65, now);
		rumble.frequency.exponentialRampToValueAtTime(28, now + 0.4);
		rumbleGain.gain.setValueAtTime(0.55, now);
		rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
		rumble.connect(rumbleGain);
		rumbleGain.connect(masterGain);

		noise.start(now);
		noise.stop(now + 1.0);
		rumble.start(now);
		rumble.stop(now + 0.5);
	} catch (e) {}
}

let chatOpen = false;
let quickChatOpen = false;

function openChat() {
	if (!GameState.matchActive) return;
	chatOpen = true;
	$('chatInputWrap').classList.remove('hidden');
	$('chatContainer').classList.remove('hidden');
	$('chatInput').value = '';
	$('chatInput').focus();
	if (document.pointerLockElement) document.exitPointerLock();
}

function closeChat() {
	chatOpen = false;
	$('chatInputWrap').classList.add('hidden');
	$('chatInput').blur();
	if (GameState.started && !GameState.paused) document.body.requestPointerLock();
}

function sendChatMessage() {
	const input = $('chatInput');
	const msg = input.value.trim();
	if (msg && socket) {
		socket.emit('chatMessage', msg);
		input.value = '';
	}
	closeChat();
}

function addChatMessage(from, message, isYou) {
	const container = $('chatMessages');
	if (!container) return;
	$('chatContainer').classList.remove('hidden');
	const div = document.createElement('div');
	div.className = 'chat-msg ' + (isYou ? 'self' : 'opponent');
	const fromSpan = document.createElement('span');
	fromSpan.className = 'chat-from';
	fromSpan.textContent = from + ':';
	const msgSpan = document.createElement('span');
	msgSpan.textContent = ' ' + message;
	div.appendChild(fromSpan);
	div.appendChild(msgSpan);
	container.appendChild(div);
	while (container.children.length > 6) container.removeChild(container.firstChild);
	setTimeout(() => {
		if (div.parentNode) {
			div.classList.add('fading');
			setTimeout(() => { if (div.parentNode) div.remove(); }, 500);
		}
	}, 8000);
}

function openQuickChat() {
	if (!GameState.matchActive) return;
	quickChatOpen = true;
	$('quickChatWheel').classList.remove('hidden');
	if (document.pointerLockElement) document.exitPointerLock();
}

function closeQuickChat() {
	quickChatOpen = false;
	$('quickChatWheel').classList.add('hidden');
	if (GameState.started && !GameState.paused) document.body.requestPointerLock();
}

document.querySelectorAll('.qc-btn').forEach(btn => {
	btn.addEventListener('click', () => {
		const msg = btn.dataset.msg;
		if (msg && socket) socket.emit('chatMessage', msg);
		closeQuickChat();
	});
});

const chatInputEl = $('chatInput');
if (chatInputEl) {
	chatInputEl.addEventListener('keydown', e => {
		e.stopPropagation();
		if (e.key === 'Enter') sendChatMessage();
		else if (e.key === 'Escape') closeChat();
	});
}

let gunModel = null;
let gunInner = null;
let muzzleFlashModel = null;
let muzzleFlashTimer = 0;
let gunRecoil = 0;
let lastAutoShotTime = 0;

const gunLoader = new GLTFLoader().setPath('./models/weapons/');

function loadAK47() {
	if (baseGunScene) {
		attachGun();
		return;
	}
	gunLoader.load('ak47.glb',
		(gltf) => {
			baseGunScene = gltf.scene;
			baseGunScene.traverse(c => {
				if (c.isMesh) {
					const name = (c.name || '').toLowerCase();
					const matName = (c.material?.name || '').toLowerCase();
					const isArm = name.includes('skeletal') || name.includes('arm') || name.includes('hand') ||
					              matName.includes('arm') || matName.includes('hand') || matName.includes('skin');
					if (isArm) {
						c.visible = false;
						c.userData.isArm = true;
					} else {
						c.visible = true;
						c.castShadow = false;
						c.frustumCulled = false;
						c.userData.isArm = false;
						if (c.material) {
							c.material = c.material.clone();
							if (c.material.metalness !== undefined) c.material.metalness = 0.7;
							if (c.material.roughness !== undefined) c.material.roughness = 0.3;
						}
					}
				}
			});
			attachGun();
		},
		undefined,
		(error) => { console.error('FAILED TO LOAD GUN:', error); }
	);
}

function attachGun() {
	if (gunModel) {
		camera.remove(gunModel);
		gunModel = null;
		gunInner = null;
	}
	if (!baseGunScene) return;

	gunInner = baseGunScene.clone(true);
	gunInner.traverse(c => {
		if (c.isSkinnedMesh) c.bindMode = 'detached';
	});
	gunInner.updateMatrixWorld(true);

	const box = new THREE.Box3().setFromObject(gunInner);
	const size = new THREE.Vector3();
	const center = new THREE.Vector3();
	box.getSize(size);
	box.getCenter(center);

	const maxDim = Math.max(size.x, size.y, size.z);
	const normalizeScale = WEAPON.targetSize / maxDim;

	const centeringGroup = new THREE.Group();
	centeringGroup.add(gunInner);
	gunInner.position.set(-center.x, -center.y, -center.z);
	centeringGroup.scale.setScalar(normalizeScale);

	gunInner.traverse(c => {
		if (c.isMesh) {
			if (c.userData.isArm) {
				c.visible = false;
			} else {
				c.visible = true;
				c.frustumCulled = false;
				c.castShadow = true;
				c.receiveShadow = true;
				if (c.material) {
					c.material.needsUpdate = true;
					c.material.transparent = false;
					c.material.opacity = 1.0;
					c.material.visible = true;
					if (c.material.isMeshStandardMaterial) {
						c.material.metalness = 0.85;
						c.material.roughness = 0.4;
						c.material.envMapIntensity = 1.5;
					}
				}
			}
		}
	});

	gunModel = new THREE.Group();
	gunModel.add(centeringGroup);
	gunModel.position.set(WEAPON.position.x, WEAPON.position.y, WEAPON.position.z);
	gunModel.rotation.set(WEAPON.rotation.x, WEAPON.rotation.y, WEAPON.rotation.z);
	camera.add(gunModel);
}

let bulletHoleTexture = null;
function createBulletHoleTexture() {
	if (bulletHoleTexture) return bulletHoleTexture;
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');

	const outerGradient = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
	outerGradient.addColorStop(0, 'rgba(90, 80, 70, 0.4)');
	outerGradient.addColorStop(0.5, 'rgba(70, 60, 55, 0.2)');
	outerGradient.addColorStop(1, 'rgba(50, 45, 40, 0)');
	ctx.fillStyle = outerGradient;
	ctx.fillRect(0, 0, 128, 128);

	const midGradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 35);
	midGradient.addColorStop(0, 'rgba(15, 10, 5, 0.95)');
	midGradient.addColorStop(0.4, 'rgba(30, 20, 15, 0.85)');
	midGradient.addColorStop(0.7, 'rgba(50, 35, 25, 0.5)');
	midGradient.addColorStop(1, 'rgba(60, 45, 35, 0)');
	ctx.fillStyle = midGradient;
	ctx.fillRect(0, 0, 128, 128);

	const coreGradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 14);
	coreGradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
	coreGradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.95)');
	coreGradient.addColorStop(1, 'rgba(10, 5, 0, 0)');
	ctx.fillStyle = coreGradient;
	ctx.fillRect(0, 0, 128, 128);

	ctx.strokeStyle = 'rgba(15, 10, 5, 0.75)';
	ctx.lineCap = 'round';
	const crackCount = 8 + Math.floor(Math.random() * 4);
	for (let i = 0; i < crackCount; i++) {
		const angle = (Math.PI * 2 * i) / crackCount + (Math.random() - 0.5) * 0.6;
		const len = 20 + Math.random() * 25;
		const startRadius = 10;
		ctx.lineWidth = 1.5 - Math.random() * 0.7;
		ctx.beginPath();
		ctx.moveTo(64 + Math.cos(angle) * startRadius, 64 + Math.sin(angle) * startRadius);
		let x = 64 + Math.cos(angle) * startRadius;
		let y = 64 + Math.sin(angle) * startRadius;
		const segments = 3 + Math.floor(Math.random() * 3);
		for (let s = 1; s <= segments; s++) {
			const segLen = len / segments;
			const jitter = (Math.random() - 0.5) * 0.4;
			const segAngle = angle + jitter;
			x += Math.cos(segAngle) * segLen;
			y += Math.sin(segAngle) * segLen;
			ctx.lineTo(x, y);
		}
		ctx.stroke();
	}

	ctx.fillStyle = 'rgba(20, 15, 10, 0.6)';
	for (let i = 0; i < 15; i++) {
		const angle = Math.random() * Math.PI * 2;
		const dist = 15 + Math.random() * 30;
		const size = 0.5 + Math.random() * 1.5;
		ctx.beginPath();
		ctx.arc(64 + Math.cos(angle) * dist, 64 + Math.sin(angle) * dist, size, 0, Math.PI * 2);
		ctx.fill();
	}

	bulletHoleTexture = new THREE.CanvasTexture(canvas);
	return bulletHoleTexture;
}

function createBulletHole(position, normal) {
	const texture = createBulletHoleTexture();
	const size = 0.18 + Math.random() * 0.08;
	const geometry = new THREE.PlaneGeometry(size, size);
	const material = new THREE.MeshBasicMaterial({
		map: texture, transparent: true, depthWrite: false,
		polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
		side: THREE.DoubleSide
	});
	const hole = new THREE.Mesh(geometry, material);
	hole.position.copy(position).addScaledVector(normal, 0.01);
	const lookAt = position.clone().add(normal);
	hole.lookAt(lookAt);
	hole.rotateZ(Math.random() * Math.PI * 2);
	scene.add(hole);
	bulletHoles.push(hole);
	createImpactSmoke(position, normal);

	if (bulletHoles.length > MAX_BULLET_HOLES) {
		const oldHole = bulletHoles.shift();
		scene.remove(oldHole);
		if (oldHole.material.map) oldHole.material.map.dispose();
		oldHole.material.dispose();
		oldHole.geometry.dispose();
	}

	setTimeout(() => {
		if (hole.parent) {
			let opacity = 1;
			const fadeInterval = setInterval(() => {
				opacity -= 0.02;
				hole.material.opacity = opacity;
				if (opacity <= 0) {
					clearInterval(fadeInterval);
					if (hole.parent) {
						scene.remove(hole);
						hole.material.dispose();
						hole.geometry.dispose();
						const idx = bulletHoles.indexOf(hole);
						if (idx !== -1) bulletHoles.splice(idx, 1);
					}
				}
			}, 50);
		}
	}, 15000);
}

let smokeTexture = null;
function createSmokeTexture() {
	if (smokeTexture) return smokeTexture;
	const canvas = document.createElement('canvas');
	canvas.width = 64;
	canvas.height = 64;
	const ctx = canvas.getContext('2d');
	const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	gradient.addColorStop(0, 'rgba(200, 195, 190, 0.9)');
	gradient.addColorStop(0.3, 'rgba(180, 175, 170, 0.6)');
	gradient.addColorStop(0.6, 'rgba(150, 145, 140, 0.3)');
	gradient.addColorStop(1, 'rgba(120, 115, 110, 0)');
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, 64, 64);
	for (let i = 0; i < 30; i++) {
		const x = Math.random() * 64;
		const y = Math.random() * 64;
		const distFromCenter = Math.sqrt((x-32)**2 + (y-32)**2);
		if (distFromCenter < 28) {
			const alpha = (1 - distFromCenter/28) * 0.15;
			ctx.fillStyle = `rgba(${100 + Math.random()*80}, ${95 + Math.random()*75}, ${90 + Math.random()*70}, ${alpha})`;
			ctx.beginPath();
			ctx.arc(x, y, 2 + Math.random() * 4, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	smokeTexture = new THREE.CanvasTexture(canvas);
	return smokeTexture;
}

function createImpactSmoke(position, normal) {
	if (SETTINGS.graphics === 'potato') return;
	const texture = createSmokeTexture();
	const puffCount = SETTINGS.graphics === 'performance' ? 3 : 6;
	for (let i = 0; i < puffCount; i++) {
		const size = 0.15 + Math.random() * 0.15;
		const mat = new THREE.SpriteMaterial({
			map: texture, transparent: true, opacity: 0.75, depthWrite: false, color: 0xaaa599
		});
		const smoke = new THREE.Sprite(mat);
		smoke.scale.set(size, size, 1);
		smoke.position.copy(position).addScaledVector(normal, 0.02);
		smoke.position.x += (Math.random() - 0.5) * 0.08;
		smoke.position.y += (Math.random() - 0.5) * 0.08;
		smoke.position.z += (Math.random() - 0.5) * 0.08;
		const speed = 0.8 + Math.random() * 1.2;
		const velocity = normal.clone().multiplyScalar(speed);
		velocity.x += (Math.random() - 0.5) * 1.5;
		velocity.y += 0.4 + Math.random() * 0.6;
		velocity.z += (Math.random() - 0.5) * 1.5;
		scene.add(smoke);
		const startTime = performance.now();
		const duration = 700 + Math.random() * 500;
		const rotSpeed = (Math.random() - 0.5) * 0.05;
		function animateSmoke() {
			const elapsed = performance.now() - startTime;
			const t = elapsed / duration;
			if (t >= 1) {
				scene.remove(smoke);
				mat.dispose();
				return;
			}
			smoke.position.addScaledVector(velocity, 0.016);
			velocity.multiplyScalar(0.94);
			velocity.y -= 0.02;
			const currentSize = size * (1 + t * 2.5);
			smoke.scale.set(currentSize, currentSize, 1);
			smoke.material.rotation += rotSpeed;
			mat.opacity = 0.75 * Math.pow(1 - t, 1.5);
			requestAnimationFrame(animateSmoke);
		}
		animateSmoke();
	}
	const debrisCount = SETTINGS.graphics === 'performance' ? 2 : 5;
	for (let i = 0; i < debrisCount; i++) {
		const debrisGeo = new THREE.SphereGeometry(0.008 + Math.random() * 0.008, 4, 4);
		const debrisMat = new THREE.MeshBasicMaterial({ color: 0x554433, transparent: true, opacity: 1.0 });
		const debris = new THREE.Mesh(debrisGeo, debrisMat);
		debris.position.copy(position).addScaledVector(normal, 0.02);
		const debrisSpeed = 2 + Math.random() * 3;
		const debrisVel = normal.clone().multiplyScalar(debrisSpeed);
		debrisVel.x += (Math.random() - 0.5) * 3;
		debrisVel.y += (Math.random() - 0.5) * 3;
		debrisVel.z += (Math.random() - 0.5) * 3;
		scene.add(debris);
		const startTime = performance.now();
		const duration = 400 + Math.random() * 300;
		function animateDebris() {
			const elapsed = performance.now() - startTime;
			const t = elapsed / duration;
			if (t >= 1) {
				scene.remove(debris);
				debrisMat.dispose();
				debrisGeo.dispose();
				return;
			}
			debris.position.addScaledVector(debrisVel, 0.016);
			debrisVel.y -= 0.15;
			debrisMat.opacity = 1 - t;
			requestAnimationFrame(animateDebris);
		}
		animateDebris();
	}
}

// ==================== MOVEMENT STATE ====================
let leftMouseDown = false;

let footstepTimer = 0;
let footstepIndex = 0;

let isCrouching = false;
let crouchAmount = 0;
const CROUCH_SPEED = 8;
const STAND_HEIGHT = 0.65;
const CROUCH_HEIGHT = 0.35;
const CROUCH_SPEED_MULT = 0.5;

let isSliding = false;
let slideTimer = 0;
let slideDirection = new THREE.Vector3();
const SLIDE_DURATION = 0.9;
const SLIDE_BOOST = 22;
const SLIDE_COOLDOWN = 0.5;
let slideCooldownTimer = 0;

let sprintCharge = 0;
const SPRINT_RAMP_UP = 1.2;
const SPRINT_RAMP_DOWN = 3.5;
const BASE_SPEED = 25;
const SPRINT_MAX_MULTIPLIER = 1.75;
let sprintFovBoost = 0;
// ==================== SCREEN SHAKE ====================
let shakeIntensity = 0;
let shakeDecay = 0;
const shakeOffset = new THREE.Vector3();

function triggerScreenShake(intensity = 0.04, decay = 0.9) {
	shakeIntensity = intensity;
	shakeDecay = decay;
}

function updateScreenShake() {
	if (shakeIntensity > 0.001) {
		shakeOffset.x = (Math.random() - 0.5) * shakeIntensity;
		shakeOffset.y = (Math.random() - 0.5) * shakeIntensity;
		camera.rotation.x += shakeOffset.x;
		camera.rotation.y += shakeOffset.y;
		shakeIntensity *= shakeDecay;
	} else {
		shakeIntensity = 0;
	}
}
// =====================================================

document.addEventListener('keydown', e => {
	if (chatOpen) return;
	keyStates[e.code] = true;

	if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && GameState.matchActive && !GameState.paused) {
		e.preventDefault();
		openChat();
		return;
	}

	if (e.code === 'KeyT' && GameState.started && !GameState.paused) {
		e.preventDefault();
		if (playerOnFloor) {
			if (sprintCharge > 0.5 && !isSliding && slideCooldownTimer <= 0) {
				isSliding = true;
				slideTimer = SLIDE_DURATION;
				isCrouching = true;
				slideDirection.copy(playerVelocity).normalize();
				playSlideSound();
			} else if (sprintCharge < 0.2 && !isSliding) {
				isCrouching = !isCrouching;
			}
		}
		return;
	}

	if (e.code === 'KeyY' && GameState.matchActive && !GameState.paused) {
		e.preventDefault();
		if (quickChatOpen) closeQuickChat();
		else openQuickChat();
		return;
	}

	if (e.code === 'KeyF' && GameState.started && !GameState.paused) {
		GameState.autoFire = !GameState.autoFire;
		showAutoFireStatus();
	}
	if (e.code === 'Escape' && GameState.started) {
		if (quickChatOpen) { closeQuickChat(); return; }
		if (GameState.paused) resumeGame();
		else pauseGame();
	}
});
document.addEventListener('keyup', e => { keyStates[e.code] = false; });

container.addEventListener('mousedown', (e) => {
	if (!GameState.started || GameState.paused) return;
	if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
	if (!document.pointerLockElement) document.body.requestPointerLock();
	mouseTime = performance.now();
	if (e.button === 0) leftMouseDown = true;
});

document.addEventListener('mouseup', (e) => {
	if (!GameState.started || GameState.paused) return;
	if (e.button === 0) leftMouseDown = false;
	if (document.pointerLockElement !== null) {
		if (e.button === 0 && !GameState.autoFire) shootGun();
		else if (e.button === 2) throwBall();
	}
});

document.addEventListener('contextmenu', e => e.preventDefault());

const MAX_PITCH = Math.PI / 2 - 0.05;
document.body.addEventListener('mousemove', e => {
	if (document.pointerLockElement === document.body && !GameState.paused) {
		const s = SETTINGS.sensitivity / 5000;
		camera.rotation.y -= e.movementX * s;
		camera.rotation.x -= e.movementY * s;
		camera.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.rotation.x));
	}
});

document.addEventListener('pointerlockchange', () => {
	// ==================== MOBILE CONTROLS ====================
if (isMobile) {
	// Show mobile controls when game starts
	const originalStartGame = startGame;
	window.startGame = function() {
		originalStartGame();
		$('mobileControls').classList.remove('hidden');
	};

	// JOYSTICK for movement
	const joystick = $('mobileJoystick');
	const knob = $('mobileJoystickKnob');
	let joystickActive = false;
	let joystickStartX = 0, joystickStartY = 0;
	const JOYSTICK_MAX = 50;

	joystick.addEventListener('touchstart', (e) => {
		e.preventDefault();
		joystickActive = true;
		const touch = e.touches[0];
		const rect = joystick.getBoundingClientRect();
		joystickStartX = rect.left + rect.width / 2;
		joystickStartY = rect.top + rect.height / 2;
	});

	joystick.addEventListener('touchmove', (e) => {
		e.preventDefault();
		if (!joystickActive) return;
		const touch = e.touches[0];
		let dx = touch.clientX - joystickStartX;
		let dy = touch.clientY - joystickStartY;
		const dist = Math.sqrt(dx*dx + dy*dy);
		if (dist > JOYSTICK_MAX) {
			dx = (dx / dist) * JOYSTICK_MAX;
			dy = (dy / dist) * JOYSTICK_MAX;
		}
		knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
		
		// Convert to WASD-like input
		const threshold = 15;
		keyStates['KeyW'] = dy < -threshold;
		keyStates['KeyS'] = dy > threshold;
		keyStates['KeyA'] = dx < -threshold;
		keyStates['KeyD'] = dx > threshold;
	});

	joystick.addEventListener('touchend', (e) => {
		e.preventDefault();
		joystickActive = false;
		knob.style.transform = 'translate(-50%, -50%)';
		keyStates['KeyW'] = false;
		keyStates['KeyS'] = false;
		keyStates['KeyA'] = false;
		keyStates['KeyD'] = false;
	});

	// LOOK AREA for camera
	const lookArea = $('mobileLookArea');
	let lookActive = false;
	let lastLookX = 0, lastLookY = 0;

	lookArea.addEventListener('touchstart', (e) => {
		e.preventDefault();
		lookActive = true;
		const touch = e.touches[0];
		lastLookX = touch.clientX;
		lastLookY = touch.clientY;
	});

	lookArea.addEventListener('touchmove', (e) => {
		e.preventDefault();
		if (!lookActive) return;
		const touch = e.touches[0];
		const dx = touch.clientX - lastLookX;
		const dy = touch.clientY - lastLookY;
		lastLookX = touch.clientX;
		lastLookY = touch.clientY;
		
		const sens = SETTINGS.sensitivity / 3000;
		camera.rotation.y -= dx * sens;
		camera.rotation.x -= dy * sens;
		camera.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.rotation.x));
	});

	lookArea.addEventListener('touchend', (e) => {
		e.preventDefault();
		lookActive = false;
	});

	// SHOOT BUTTON (hold to auto-fire!)
	const shootBtn = $('mobileShootBtn');
	let mobileShooting = false;
	let mobileShootInterval = null;

	shootBtn.addEventListener('touchstart', (e) => {
		e.preventDefault();
		if (GameState.paused) return;
		mobileShooting = true;
		leftMouseDown = true;
		shootGun();
		// Auto-fire while held
		mobileShootInterval = setInterval(() => {
			if (mobileShooting && !GameState.paused) shootGun();
		}, WEAPON.fireRate * 1000);
	});

	shootBtn.addEventListener('touchend', (e) => {
		e.preventDefault();
		mobileShooting = false;
		leftMouseDown = false;
		if (mobileShootInterval) {
			clearInterval(mobileShootInterval);
			mobileShootInterval = null;
		}
	});

	// JUMP BUTTON
	$('mobileJumpBtn').addEventListener('touchstart', (e) => {
		e.preventDefault();
		keyStates['Space'] = true;
	});
	$('mobileJumpBtn').addEventListener('touchend', (e) => {
		e.preventDefault();
		keyStates['Space'] = false;
	});

	// CROUCH BUTTON
	$('mobileCrouchBtn').addEventListener('touchstart', (e) => {
		e.preventDefault();
		if (playerOnFloor && !isSliding) {
			if (sprintCharge > 0.5 && slideCooldownTimer <= 0) {
				isSliding = true;
				slideTimer = SLIDE_DURATION;
				isCrouching = true;
				slideDirection.copy(playerVelocity).normalize();
				playSlideSound();
			} else {
				isCrouching = !isCrouching;
			}
		}
	});

	// SPRINT BUTTON (hold)
	$('mobileSprintBtn').addEventListener('touchstart', (e) => {
		e.preventDefault();
		keyStates['ShiftLeft'] = true;
	});
	$('mobileSprintBtn').addEventListener('touchend', (e) => {
		e.preventDefault();
		keyStates['ShiftLeft'] = false;
	});

	// PAUSE BUTTON
	$('mobilePauseBtn').addEventListener('touchstart', (e) => {
		e.preventDefault();
		if (GameState.paused) resumeGame();
		else pauseGame();
	});

	// Disable pointer lock on mobile (not needed)
	const oldMouseDown = container.onmousedown;
	container.removeEventListener('mousedown', () => {});
	
	// Hide click prompt on mobile
	if ($('clickPrompt')) $('clickPrompt').style.display = 'none';
}
// =====================================================
	if (document.pointerLockElement === document.body) $('clickPrompt').classList.add('hidden');
	else if (GameState.started && !GameState.paused && !chatOpen && !quickChatOpen) $('clickPrompt').classList.remove('hidden');
});

window.addEventListener('resize', () => {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
});

function showAutoFireStatus() {
	let notice = document.getElementById('autoFireNotice');
	if (!notice) {
		notice = document.createElement('div');
		notice.id = 'autoFireNotice';
		notice.style.cssText = 'position:fixed;top:120px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;padding:12px 24px;font-family:Orbitron,sans-serif;letter-spacing:4px;font-size:14px;border:1px solid rgba(72,116,255,0.5);z-index:100;pointer-events:none;';
		document.body.appendChild(notice);
	}
	notice.textContent = GameState.autoFire ? 'AUTO-FIRE: ON' : 'AUTO-FIRE: OFF';
	notice.style.color = GameState.autoFire ? '#4874ff' : '#ff4444';
	notice.style.opacity = '1';
	clearTimeout(notice._t);
	notice._t = setTimeout(() => { notice.style.transition = 'opacity 0.5s'; notice.style.opacity = '0'; }, 1500);
}

function shootGun() {
	if (GameState.paused) return;

	if (muzzleFlashModel) {
		muzzleFlashModel.visible = true;
		muzzleFlashModel.rotation.z = Math.random() * Math.PI * 2;
		muzzleFlashTimer = 0.05;
	}
	gunRecoil = WEAPON.recoil;
	triggerScreenShake(0.006, 0.75);
	playGunshot(WEAPON.soundPitch);

	camera.rotation.x += WEAPON.recoil * 0.15;
	camera.rotation.y += (Math.random() - 0.5) * WEAPON.recoil * 0.1;
	camera.rotation.x = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, camera.rotation.x));

	camera.getWorldDirection(playerDirection);
	const spread = WEAPON.spread;
	playerDirection.x += (Math.random() - 0.5) * spread;
	playerDirection.y += (Math.random() - 0.5) * spread;
	playerDirection.z += (Math.random() - 0.5) * spread;
	playerDirection.normalize();

	raycaster.set(camera.position, playerDirection);

	const sphereMeshes = spheres.filter(s => s.alive).map(s => s.mesh);
	const ballHits = raycaster.intersectObjects(sphereMeshes);
	const wallHits = mapMeshes.length > 0 ? raycaster.intersectObjects(mapMeshes, true) : [];

	const ballDist = ballHits.length > 0 ? ballHits[0].distance : Infinity;
	const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

	if (ballDist < wallDist && ballHits.length > 0) {
		const hitMesh = ballHits[0].object;
		const hitSphere = spheres.find(s => s.mesh === hitMesh);
		if (hitSphere && hitSphere.alive) {
			const blastDir = playerDirection.clone();
			hitSphere.velocity.copy(blastDir).multiplyScalar(40);
			hitSphere.velocity.y += 10;
			if (!hitSphere.shotFor) {
				hitSphere.shotFor = true;
				if (GameState.mode === 'playground') {
					GameState.myScore = (GameState.myScore || 0) + 1;
					if ($('scoreNum')) $('scoreNum').textContent = GameState.myScore;
				}
				else if (GameState.mode === 'ball1v1' && GameState.matchActive) {
					if (socket && socket.connected) socket.emit('scorePoint', 1);
				}
				setTimeout(() => { if (hitSphere) hitSphere.shotFor = false; }, 1000);
			}
			const origColor = hitMesh.material.color.getHex();
			hitMesh.material.color.setHex(0xffffff);
			hitMesh.material.emissive.setHex(0xff2222);
			hitMesh.material.emissiveIntensity = 0.8;
			setTimeout(() => {
				hitMesh.material.color.setHex(origColor);
				hitMesh.material.emissiveIntensity = 0.2;
			}, 200);
			showHitMarker();
			playHitSound();
		}
	} else if (wallHits.length > 0) {
		const hit = wallHits[0];
		if (hit.face && hit.face.normal) {
			const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
			createBulletHole(hit.point, normal);
		}
	}
}

function showHitMarker() {
	const ch = $('crosshair');
	ch.style.transform = 'translate(-50%, -50%) scale(1.5)';
	ch.style.filter = 'brightness(2)';
	setTimeout(() => {
		ch.style.transform = 'translate(-50%, -50%) scale(1)';
		ch.style.filter = 'none';
	}, 100);
}

function throwBall() {
	if (GameState.paused) return;
	const sphere = spheres[sphereIdx];
	const randomColor = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)];
	sphere.mesh.material.color.setHex(randomColor);
	sphere.mesh.material.emissive.setHex(randomColor);
	sphere.mesh.material.emissiveIntensity = 0.15;
	sphere.alive = true;
	sphere.shotFor = false;
	camera.getWorldDirection(playerDirection);
	sphere.collider.center.copy(playerCollider.end).addScaledVector(playerDirection, playerCollider.radius * 1.5);
	const impulse = 15 + 30 * (1 - Math.exp((mouseTime - performance.now()) * 0.001));
	sphere.velocity.copy(playerDirection).multiplyScalar(impulse);
	sphere.velocity.addScaledVector(playerVelocity, 2);
	sphereIdx = (sphereIdx + 1) % spheres.length;
}

function playerCollisions() {
	const result = worldOctree.capsuleIntersect(playerCollider);
	playerOnFloor = false;
	if (result) {
		playerOnFloor = result.normal.y > 0;
		if (!playerOnFloor) playerVelocity.addScaledVector(result.normal, -result.normal.dot(playerVelocity));
		if (result.depth >= 1e-10) playerCollider.translate(result.normal.multiplyScalar(result.depth));
	}
}

function updatePlayer(deltaTime) {
	let damping = Math.exp(-4 * deltaTime) - 1;
	if (!playerOnFloor) {
		playerVelocity.y -= GRAVITY * deltaTime;
		damping *= 0.1;
	}
	playerVelocity.addScaledVector(playerVelocity, damping);
	const deltaPosition = playerVelocity.clone().multiplyScalar(deltaTime);
	playerCollider.translate(deltaPosition);
	playerCollisions();

	const targetCrouch = isCrouching ? 1 : 0;
	crouchAmount += (targetCrouch - crouchAmount) * deltaTime * CROUCH_SPEED;
	const currentHeight = STAND_HEIGHT - (STAND_HEIGHT - CROUCH_HEIGHT) * crouchAmount;
	const startPos = playerCollider.start.clone();
	playerCollider.end.copy(startPos).add(new THREE.Vector3(0, currentHeight, 0));

	camera.position.copy(playerCollider.end);
}

function playerSphereCollision(sphere) {
	const center = vector1.addVectors(playerCollider.start, playerCollider.end).multiplyScalar(0.5);
	const sc = sphere.collider.center;
	const r = playerCollider.radius + sphere.collider.radius;
	const r2 = r * r;
	for (const point of [playerCollider.start, playerCollider.end, center]) {
		const d2 = point.distanceToSquared(sc);
		if (d2 < r2) {
			const normal = vector1.subVectors(point, sc).normalize();
			const v1 = vector2.copy(normal).multiplyScalar(normal.dot(playerVelocity));
			const v2 = vector3.copy(normal).multiplyScalar(normal.dot(sphere.velocity));
			playerVelocity.add(v2).sub(v1);
			sphere.velocity.add(v1).sub(v2);
			const d = (r - Math.sqrt(d2)) / 2;
			sc.addScaledVector(normal, -d);
		}
	}
}

function spheresCollisions() {
	for (let i = 0, length = spheres.length; i < length; i++) {
		const s1 = spheres[i];
		if (!s1.alive) continue;
		for (let j = i + 1; j < length; j++) {
			const s2 = spheres[j];
			if (!s2.alive) continue;
			const d2 = s1.collider.center.distanceToSquared(s2.collider.center);
			const r = s1.collider.radius + s2.collider.radius;
			const r2 = r * r;
			if (d2 < r2) {
				const normal = vector1.subVectors(s1.collider.center, s2.collider.center).normalize();
				const v1 = vector2.copy(normal).multiplyScalar(normal.dot(s1.velocity));
				const v2 = vector3.copy(normal).multiplyScalar(normal.dot(s2.velocity));
				s1.velocity.add(v2).sub(v1);
				s2.velocity.add(v1).sub(v2);
				const d = (r - Math.sqrt(d2)) / 2;
				s1.collider.center.addScaledVector(normal, d);
				s2.collider.center.addScaledVector(normal, -d);
			}
		}
	}
}

function updateSpheres(deltaTime) {
	spheres.forEach(sphere => {
		if (!sphere.alive) return;
		sphere.collider.center.addScaledVector(sphere.velocity, deltaTime);
		const result = worldOctree.sphereIntersect(sphere.collider);
		if (result) {
			sphere.velocity.addScaledVector(result.normal, -result.normal.dot(sphere.velocity) * 1.5);
			sphere.collider.center.add(result.normal.multiplyScalar(result.depth));
		} else {
			sphere.velocity.y -= GRAVITY * deltaTime;
		}
		const damping = Math.exp(-1.5 * deltaTime) - 1;
		sphere.velocity.addScaledVector(sphere.velocity, damping);
		playerSphereCollision(sphere);
	});
	spheresCollisions();
	for (const sphere of spheres) sphere.mesh.position.copy(sphere.collider.center);
}

function getForwardVector() {
	camera.getWorldDirection(playerDirection);
	playerDirection.y = 0;
	playerDirection.normalize();
	return playerDirection;
}

function getSideVector() {
	camera.getWorldDirection(playerDirection);
	playerDirection.y = 0;
	playerDirection.normalize();
	playerDirection.cross(camera.up);
	return playerDirection;
}

function controls(deltaTime) {
	if (slideCooldownTimer > 0) slideCooldownTimer -= deltaTime * STEPS_PER_FRAME;

	if (isSliding) {
		slideTimer -= deltaTime * STEPS_PER_FRAME;
		if (slideTimer <= 0 || !playerOnFloor) {
			isSliding = false;
			slideCooldownTimer = SLIDE_COOLDOWN;
		} else {
			const slidePower = (slideTimer / SLIDE_DURATION);
			const slideForce = SLIDE_BOOST * slidePower;
			playerVelocity.x = slideDirection.x * slideForce;
			playerVelocity.z = slideDirection.z * slideForce;
		}
	}

	const isMovingForward = keyStates['KeyW'];
	const isSprintKey = keyStates['ShiftLeft'] || keyStates['ShiftRight'];
	const canSprint = isMovingForward && isSprintKey && playerOnFloor && !isCrouching && !isSliding;

	if (canSprint) {
		sprintCharge += deltaTime * STEPS_PER_FRAME / SPRINT_RAMP_UP;
		if (sprintCharge > 1) sprintCharge = 1;
	} else {
		sprintCharge -= deltaTime * STEPS_PER_FRAME / SPRINT_RAMP_DOWN;
		if (sprintCharge < 0) sprintCharge = 0;
	}

	const sprintCurve = sprintCharge * sprintCharge * (3 - 2 * sprintCharge);
	const speedMultiplier = 1 + (SPRINT_MAX_MULTIPLIER - 1) * sprintCurve;

	const crouchMult = 1 - (crouchAmount * (1 - CROUCH_SPEED_MULT));
	const baseSpeed = playerOnFloor ? BASE_SPEED : 8;
	const speedDelta = deltaTime * baseSpeed * speedMultiplier * crouchMult;

	if (!isSliding) {
		if (keyStates['KeyW']) playerVelocity.add(getForwardVector().multiplyScalar(speedDelta));
		if (keyStates['KeyS']) playerVelocity.add(getForwardVector().multiplyScalar(-speedDelta));
		if (keyStates['KeyA']) playerVelocity.add(getSideVector().multiplyScalar(-speedDelta));
		if (keyStates['KeyD']) playerVelocity.add(getSideVector().multiplyScalar(speedDelta));
	}

	if (playerOnFloor && keyStates['Space']) {
		if (isSliding) {
			isSliding = false;
			isCrouching = false;
			slideCooldownTimer = SLIDE_COOLDOWN;
			playerVelocity.y = 15;
		} else if (isCrouching) {
			isCrouching = false;
			keyStates['Space'] = false;
		} else {
			playerVelocity.y = 15;
		}
	}

	if ((sprintCharge > 0.2 || !playerOnFloor) && !isSliding) {
		isCrouching = false;
	}

	let targetFovBoost = sprintCurve * 12;
	if (isSliding) targetFovBoost = 15;
	sprintFovBoost += (targetFovBoost - sprintFovBoost) * 0.1;
	camera.fov = SETTINGS.fov + sprintFovBoost;
	camera.updateProjectionMatrix();

	const isMoving = keyStates['KeyW'] || keyStates['KeyS'] || keyStates['KeyA'] || keyStates['KeyD'];
	const horizontalSpeed = Math.sqrt(playerVelocity.x * playerVelocity.x + playerVelocity.z * playerVelocity.z);

	if (isMoving && playerOnFloor && horizontalSpeed > 1 && !isSliding) {
		let stepInterval;
		let stepVolume;

		if (isCrouching) {
			stepInterval = 0.95;
			stepVolume = 0.5;
		} else if (sprintCharge > 0.3) {
			stepInterval = 0.60 - (sprintCurve * 0.12);
			stepVolume = 1.0 + sprintCurve * 0.3;
		} else {
			stepInterval = 0.78;
			stepVolume = 0.85;
		}

		footstepTimer += deltaTime * STEPS_PER_FRAME;
		if (footstepTimer >= stepInterval) {
			playFootstep(stepVolume);
			footstepTimer = 0;
		}
	} else {
		footstepTimer = 0.5;
	}
}

const loader = new GLTFLoader().setPath('./models/gltf/');
loader.load('collision-world.glb', gltf => {
	scene.add(gltf.scene);
	worldOctree.fromGraphNode(gltf.scene);
	gltf.scene.traverse(child => {
		if (child.isMesh) {
			child.castShadow = true;
			child.receiveShadow = true;
			if (child.material.map) child.material.map.anisotropy = 2;
			mapMeshes.push(child);
		}
	});
});

gunLoader.load('muzzle_flash.glb', (gltf) => {
	muzzleFlashModel = gltf.scene;
	muzzleFlashModel.scale.set(0.15, 0.15, 0.15);
	muzzleFlashModel.position.set(0.3, -0.2, -1.0);
	muzzleFlashModel.visible = false;
	muzzleFlashModel.traverse(c => {
		if (c.isMesh) {
			c.frustumCulled = false;
			if (c.material) { c.material.transparent = true; c.material.opacity = 0.9; }
		}
	});
	camera.add(muzzleFlashModel);
});

function teleportPlayerIfOob() {
	if (camera.position.y <= -25) {
		playerCollider.start.set(0, 0.35, 0);
		playerCollider.end.set(0, 1, 0);
		playerCollider.radius = 0.35;
		camera.position.copy(playerCollider.end);
		camera.rotation.set(0, 0, 0);
	}
}

let frameCount = 0;
let fpsTimer = 0;
let lowFpsFrames = 0;
let autoOptimized = false;

function detectLowEndDevice() {
	const cores = navigator.hardwareConcurrency || 2;
	const memory = navigator.deviceMemory || 2;
	const isLowEnd = cores <= 2 || memory <= 2;
	if (isLowEnd) {
		SETTINGS.graphics = 'potato';
		if ($('graphicsPreset')) $('graphicsPreset').value = 'potato';
		console.log('Low-end device detected, using Potato mode');
	}
}
detectLowEndDevice();

function animate() {
	const deltaTime = Math.min(0.05, clock.getDelta()) / STEPS_PER_FRAME;

	if (GameState.started && !GameState.paused) {
		for (let i = 0; i < STEPS_PER_FRAME; i++) {
			controls(deltaTime);
			updatePlayer(deltaTime);
			updateSpheres(deltaTime);
			teleportPlayerIfOob();
		}
		if (GameState.autoFire && leftMouseDown && document.pointerLockElement) {
			if (WEAPON.auto) {
				const now = performance.now() / 1000;
				if (now - lastAutoShotTime >= WEAPON.fireRate) {
					shootGun();
					lastAutoShotTime = now;
				}
			}
		}
		if (GameState.matchActive) {
			const prevTime = GameState.matchTime;
			GameState.matchTime -= deltaTime * STEPS_PER_FRAME;
			if (frameCount % 30 === 0) updateBall1v1HUD();
			const prevSec = Math.ceil(prevTime);
			const currSec = Math.ceil(GameState.matchTime);
			if (prevSec !== currSec && currSec <= 10 && currSec > 0) {
				playCountdownBeep(currSec <= 3);
			}
			if (GameState.matchTime <= 0) {
				GameState.matchTime = 0;
				if (GameState.matchActive) {
					GameState.matchActive = false;
					endMatch();
				}
			}
		}
	}

	if (sunGroup && sunGroup.visible && frameCount % 3 === 0) {
		const pulse = 0.9 + Math.sin(performance.now() * 0.001) * 0.1;
		sunLayers.inner.opacity = 0.9 * pulse;
		sunLayers.mid.opacity = 0.6 * pulse;
		sunLayers.outer.opacity = 0.35 * pulse;
	}

	if (SETTINGS.clouds === 'on' && GameState.started && !GameState.paused && frameCount % 2 === 0) {
		clouds.forEach(c => {
			c.position.x += c.userData.driftSpeed * deltaTime * STEPS_PER_FRAME * 2;
			if (c.position.x > 250) c.position.x = -250;
		});
	}

	if (gunModel && gunRecoil > 0) {
		gunRecoil *= 0.85;
		gunModel.position.z = WEAPON.position.z + gunRecoil;
		gunModel.rotation.x = -gunRecoil * 0.5 + WEAPON.rotation.x;
	} else if (gunModel) {
		gunModel.position.z += (WEAPON.position.z - gunModel.position.z) * 0.2;
		gunModel.rotation.x += (WEAPON.rotation.x - gunModel.rotation.x) * 0.2;
	}

	if (muzzleFlashTimer > 0) {
		muzzleFlashTimer -= deltaTime * STEPS_PER_FRAME;
		if (muzzleFlashTimer <= 0 && muzzleFlashModel) muzzleFlashModel.visible = false;
	}
	updateScreenShake();
	if (GameState.started) renderer.render(scene, camera);

	frameCount++;
	fpsTimer += deltaTime * STEPS_PER_FRAME;
	if (fpsTimer >= 1) {
		const fps = Math.round(frameCount / fpsTimer);
		if ($('fpsNum')) $('fpsNum').textContent = fps;

		if (!autoOptimized && GameState.started) {
			if (fps < 25) {
				lowFpsFrames++;
				if (lowFpsFrames >= 5) {
					SETTINGS.graphics = 'potato';
					if ($('graphicsPreset')) $('graphicsPreset').value = 'potato';
					applyGraphicsPreset();
					autoOptimized = true;
					console.log('Auto-switched to Potato mode for better FPS');
				}
			} else {
				lowFpsFrames = 0;
			}
		}

		frameCount = 0;
		fpsTimer = 0;
	}
}
