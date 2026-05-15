// ATLAS Service Worker
// ⚠ CACHE_VERSION must change on every deploy — bump this string each time you push
// Easiest: replace the date portion with today's date + a counter
const CACHE_VERSION = 'atlas-v202605151543';

const STATIC_ASSETS = [
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,300;0,400;0,500;1,300&family=Syncopate:wght@400;700&family=DM+Sans:wght@300;400;500;600&display=swap'
];

// ── INSTALL: pre-cache static assets (NOT index.html — we always fetch that fresh) ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(() => {});
    })
  );
  // Take over immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ── ACTIVATE: delete every cache that isn't this version ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('[ATLAS SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    )
  );
  // Immediately control all open tabs — no reload required
  self.clients.claim();
});

// ── FETCH: strategy depends on resource type ──
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // 1. API calls — always go to network, never cache
  const isAPI = (
    url.includes('api.anthropic') ||
    url.includes('finnhub.io') ||
    url.includes('finance.yahoo') ||
    url.includes('allorigins') ||
    url.includes('corsproxy') ||
    url.includes('twelvedata') ||
    url.includes('binance') ||
    url.includes('cftc.gov')
  );
  if (isAPI) return; // fall through to browser network

  // 2. HTML navigation — NETWORK FIRST, cache fallback for offline only
  //    This is the critical fix: index.html is always fetched fresh when online
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          // Update the cache with the fresh copy
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline — serve stale copy if we have one
          return caches.match(event.request)
            .then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // 3. Fonts / static assets — cache first (they never change for same URL)
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 4. Everything else (manifest.json, icons) — network first, cache fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
