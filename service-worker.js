/* ============================================================
   service-worker.js — PWA Offline Cache
   Version: 1.0.0
   ============================================================ */

const CACHE_NAME = 'gensci-v1.0.10';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './login.html',
  './manifest.json',
  './assets/css/main.css',
  './assets/css/student.css',
  './assets/css/teacher.css',
  './assets/js/app.js',
  './assets/js/store.js',
  './assets/js/security.js',
  './assets/js/sync.js',
  './assets/js/pt-upload.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png'
];

// Install: Cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Network-first for HTML, Cache-first for assets
self.addEventListener('fetch', (event) => {
  const request = event.request;
  
  // Skip caching for non-GET requests or external APIs (Google Apps Script)
  if (request.method !== 'GET' || request.url.includes('script.google.com')) {
    return;
  }

  // Always fetch fresh HTML from network, fallback to cache if offline
  if (request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(request).then((networkResponse) => {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
        return networkResponse;
      }).catch(() => {
        return caches.match(request);
      })
    );
    return;
  }

  // For JS/CSS/Images: Cache-first, fallback to network
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });
        return networkResponse;
      });
    })
  );
});
