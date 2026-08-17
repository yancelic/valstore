/**
 * sw.js — ValStore Service Worker
 * Enables "Add to Home Screen" PWA functionality.
 * Only caches app shell (HTML, CSS, JS) — never API data.
 */

const CACHE_NAME = 'valstore-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.json'];

// Install: cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: bypass all cross-origin requests and API requests
self.addEventListener('fetch', (e) => {
  // Never intercept cross-origin requests (e.g. media.valorant-api.com, fonts)
  if (!e.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(e.request.url);

  // Always go to network directly for API calls
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // App shell: Network first, fall back to cache for offline support
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
