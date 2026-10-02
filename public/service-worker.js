const CACHE_NAME = 'plugpark-pwa-v1';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/plugpark-192.png',
  '/icons/plugpark-512.png',
  '/icons/plugpark-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live/application APIs must never be served from a Service Worker cache.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Network-first prevents an old deployment from sticking after a new release.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }

        return new Response('오프라인 상태입니다. 실시간 주차·충전 정보는 인터넷 연결이 필요합니다.', {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }),
  );
});
