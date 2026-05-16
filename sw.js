// ATLAS Service Worker — v202605161200
// ─────────────────────────────────────────────────────────────────
// ⚠ BUMP THIS VERSION STRING ON EVERY DEPLOY
//   Format: atlas-v + date (YYYYMMDD) + build number
//   Example next deploy: 'atlas-v202605170001'
//   This is the ONLY thing you need to change to force a cache clear.
// ─────────────────────────────────────────────────────────────────
const CACHE_VERSION = 'atlas-v202605161200';

// Static assets to pre-cache (NOT index.html — always fetched fresh)
const PRECACHE_ASSETS = [
  './manifest.json'
];

// API domains — always bypass cache, go straight to network
const API_BYPASS = [
  'api.anthropic.com',
  'finnhub.io',
  'finance.yahoo.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'allorigins.win',
  'corsproxy.io',
  'api.twelvedata.com',
  'fapi.binance.com',
  'api.binance.com',
  'publicreporting.cftc.gov'
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[ATLAS SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: wipe every old cache version ────────────────────────
self.addEventListener('activate', event => {
  console.log('[ATLAS SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('[ATLAS SW] Deleting stale cache:', k);
            return caches.delete(k);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE: allow page to force SW update ───────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // 1. API calls — passthrough, never cache
  if (API_BYPASS.some(domain => url.includes(domain))) return;

  // 2. HTML — NETWORK FIRST (fresh on every deploy)
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/') || url === self.registration.scope) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // 3. Fonts — cache first
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) caches.open(CACHE_VERSION).then(cache => cache.put(event.request, response.clone()));
          return response;
        });
      })
    );
    return;
  }

  // 4. Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) caches.open(CACHE_VERSION).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
