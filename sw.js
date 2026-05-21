// ATLAS Service Worker — v202605260001
// ─────────────────────────────────────────────────────────────────
// ⚠ BUMP VERSION STRING ON EVERY DEPLOY to force cache refresh
// ─────────────────────────────────────────────────────────────────
const CACHE_VERSION = 'atlas-v202605260001';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png'
];

const API_BYPASS = [
  'api.anthropic.com',
  'finance.yahoo.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'allorigins.win',
  'corsproxy.io',
  'api.twelvedata.com',
  'fapi.binance.com',
  'api.binance.com',
  'publicreporting.cftc.gov',
  'nfs.faireconomy.media'
];

// ── OFFLINE FALLBACK PAGE ─────────────────────────────────────────
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ATLAS — Offline</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#03040a;color:#e8e0d0;font-family:'Space Grotesk',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .wrap{text-align:center;max-width:320px}
  .logo{font-size:36px;font-weight:800;color:#d4a84b;letter-spacing:3px;margin-bottom:6px}
  .sub{font-size:11px;color:#60687d;letter-spacing:2px;margin-bottom:32px}
  .icon{font-size:48px;margin-bottom:20px}
  h2{font-size:18px;font-weight:700;margin-bottom:10px;color:#e8e0d0}
  p{font-size:13px;color:#60687d;line-height:1.7;margin-bottom:24px}
  .btn{display:inline-block;padding:12px 28px;background:#d4a84b;color:#03040a;border-radius:10px;font-size:13px;font-weight:800;text-decoration:none;cursor:pointer;border:none;letter-spacing:0.5px}
  .cached{margin-top:20px;font-size:11px;color:#60687d}
</style>
</head>
<body>
<div class="wrap">
  <div class="logo">ATLAS</div>
  <div class="sub">MARKET INTELLIGENCE</div>
  <div class="icon">📡</div>
  <h2>No connection</h2>
  <p>ATLAS needs an internet connection to fetch live market data and run AI analysis. Your settings and paper trades are saved locally and will be here when you reconnect.</p>
  <button class="btn" onclick="location.reload()">↺ Try Again</button>
  <div class="cached">Your API key, watchlist, and paper trades are stored on this device.</div>
</div>
</body>
</html>`;

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[ATLAS SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        // Cache assets individually so one failure doesn't block all
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url => cache.add(url).catch(e => console.warn('[ATLAS SW] Precache failed:', url, e)))
        );
      })
      .then(() => {
        // Cache offline fallback
        const offlineResponse = new Response(OFFLINE_HTML, {
          headers: { 'Content-Type': 'text/html' }
        });
        return caches.open(CACHE_VERSION).then(cache => cache.put('__offline__', offlineResponse));
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: wipe stale caches ───────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[ATLAS SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => {
          console.log('[ATLAS SW] Deleting stale cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── MESSAGE ───────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      return clients.openWindow('./');
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;

  // 1. API calls — never cache, always fresh
  if (API_BYPASS.some(domain => url.includes(domain))) return;

  // 2. HTML / navigation — network first, offline fallback
  if (event.request.mode === 'navigate' || url.endsWith('.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() =>
          caches.match(event.request)
            .then(cached => cached || caches.match('__offline__'))
        )
    );
    return;
  }

  // 3. Icons, fonts, static assets — cache first
  if (url.includes('fonts.googleapis') || url.includes('fonts.gstatic') ||
      url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.svg') ||
      url.endsWith('.webp') || url.endsWith('.ico')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('', { status: 404 }));
      })
    );
    return;
  }

  // 4. Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(c => c || caches.match('__offline__')))
  );
});
