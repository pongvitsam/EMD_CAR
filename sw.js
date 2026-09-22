/* EMD CAR — lightweight service worker for installable PWA (iOS/Android) */
const CACHE_NAME = 'emd-car-shell-v4';
const SHELL_URLS = [
  './',
  './index.html',
  './config.js',
  './js/api-client.js',
  './favicon.svg',
  './favicon.ico',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS).catch(function () {
        return Promise.all(
          SHELL_URLS.map(function (url) {
            return cache.add(url).catch(function () {});
          })
        );
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Never cache Google Apps Script / API / CDN dynamically — network only
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/macros/') >= 0) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      const network = fetch(req).then(function (res) {
        if (res && res.ok && (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css') || url.pathname.endsWith('.webmanifest') || url.pathname.indexOf('/icons/') >= 0)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(req, copy);
          });
        }
        return res;
      }).catch(function () {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
      return cached || network;
    })
  );
});
