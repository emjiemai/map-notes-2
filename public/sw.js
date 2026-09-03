/**
 * MAP NOTES - SERVICE WORKER
 * Caches core static assets for reliable offline performance
 */

const CACHE_NAME = 'mapnotes-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/idb.js',
  '/js/api.js',
  '/js/tracker.js',
  '/js/map.js',
  '/js/route-viewer.js',
  '/js/teams.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Never cache API requests - always network
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
