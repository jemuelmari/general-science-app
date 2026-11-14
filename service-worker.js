/* ============================================================
   service-worker.js — PWA Offline Cache
   Version: 2.0.0
   Changelog v2.0.0:
     - FIX: './login.html' (does not exist) was in the precache list, so
       cache.addAll() failed and the service worker NEVER installed.
       Precache now skips missing files instead of failing.
     - FIX: JS / CSS / JSON were cache-first forever → students kept old
       question banks, lessons and scripts after an update. Everything is
       now NETWORK-FIRST; the cache is only used when offline.
     - FIX: request.headers.get('accept') can be null.
   ============================================================ */

const CACHE_NAME = 'gensci-v2.0.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './student/login.html',
  './teacher-login.html',
  './config.js',
  './manifest.json',
  './assets/css/main.css',
  './assets/css/student.css',
  './assets/css/teacher.css',
  './assets/js/app.js',
  './assets/js/store.js',
  './assets/js/security.js',
  './assets/js/sync.js',
  './assets/js/randomize.js',
  './assets/js/pt-upload.js',
  './assets/img/icon-192.png',
  './assets/img/icon-512.png'
];

// Install: cache what exists (one missing file must not break the install)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : null))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for every same-origin GET; cache only as offline fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // Apps Script, CDNs, Drive: browser handles it

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match(request, { ignoreSearch: true })))
  );
});
