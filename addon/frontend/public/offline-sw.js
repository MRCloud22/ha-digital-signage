const APP_CACHE = 'signage-app-v1';
const MEDIA_CACHE = 'signage-media-v1';

self.addEventListener('install', (event) => {
  const scopeUrl = new URL(self.registration.scope);
  const indexUrl = new URL('index.html', scopeUrl).toString();

  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll([scopeUrl.toString(), indexUrl])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  if (url.pathname.startsWith('/assets/') || /\.(css|js|mjs|png|jpg|jpeg|svg|woff2?)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request, APP_CACHE));
  }
});

async function handleNavigationRequest(request) {
  const cache = await caches.open(APP_CACHE);
  const indexUrl = new URL('index.html', self.registration.scope).toString();

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(indexUrl, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(indexUrl);
    if (cached) return cached;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}
