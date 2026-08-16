const CACHE_NAME = 'godot-playground-v8';
const CORE_ASSETS = [
	'/',
	'/index.html',
	'/style.css',
	'/script.js',
	'/manifest.json',
	'/icons/icon-192.png',
	'/icons/icon-512.png'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => {
			return cache.addAll(CORE_ASSETS).catch(err => {
				console.log('Some assets failed to cache:', err);
			});
		})
	);
	self.skipWaiting();
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => {
			return Promise.all(
				keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
			);
		})
	);
	self.clients.claim();
});

self.addEventListener('fetch', event => {
	// Never cache API, socket, or Stripe requests
	const url = event.request.url;
	if (url.includes('/socket.io/') ||
	    url.includes('/api/') ||
	    url.includes('stripe.com') ||
	    url.includes('js.stripe.com')) {
		return;
	}

	event.respondWith(
		caches.match(event.request).then(cached => {
			return cached || fetch(event.request).then(response => {
				if (response.ok && event.request.method === 'GET') {
					const clone = response.clone();
					caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
				}
				return response;
			}).catch(() => {
				if (event.request.mode === 'navigate') {
					return caches.match('/index.html');
				}
			});
		})
	);
});
