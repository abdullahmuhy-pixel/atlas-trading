// ATLAS Service Worker — Offline Cache
const CACHE_NAME = 'atlas-v8';
const ASSETS = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Syncopate:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// Install — cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(() => {});
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — serve from cache, fall back to network
self.addEventListener('fetch', event => {
  // Don't cache API calls (Finnhub, Yahoo Finance, Anthropic)
  const url = event.request.url;
  if (url.includes('api.anthropic') ||
      url.includes('finnhub.io') ||
      url.includes('finance.yahoo') ||
      url.includes('allorigins') ||
      url.includes('corsproxy')) {
    return; // Let these go to network directly
  }

  // Network-first for HTML pages — always get latest version
  if (event.request.mode === 'navigate' || event.request.url.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Update cache with fresh HTML
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => {
        // Only fall back to cache if network fails (offline)
        return caches.match(event.request);
      })
    );
    return;
  }

  // Cache-first for other assets (fonts, icons)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => null);
    })
  );
});
