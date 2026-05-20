// ATLAS Service Worker — v202505261400 (force cache bust)
const CACHE_VERSION = 'atlas-v202505261400';
const PRECACHE_ASSETS = ['./manifest.json'];
const API_BYPASS = [
  'api.anthropic.com','finnhub.io','finance.yahoo.com',
  'query1.finance.yahoo.com','query2.finance.yahoo.com',
  'allorigins.win','corsproxy.io','api.twelvedata.com',
  'fapi.binance.com','api.binance.com','publicreporting.cftc.gov',
  'nfs.faireconomy.media','s3.tradingview.com','api.allorigins.win'
];

self.addEventListener('install', event => {
  // skipWaiting immediately — don't wait for old version to become idle
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_ASSETS).catch(()=>{}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    // Delete ALL old caches with different version
    caches.keys()
      .then(keys => Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>{
        console.log('[SW] Deleting old cache:', k);
        return caches.delete(k);
      })))
      .then(() => {
        console.log('[SW] Cache busted — now on', CACHE_VERSION);
        return self.clients.claim(); // take control of all pages immediately
      })
  );
});

self.addEventListener('message', event => {
  if(event.data==='SKIP_WAITING') self.skipWaiting();
  if(event.data==='CLEAR_CACHE'){
    caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k))));
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const sym = event.notification.data?.sym;
  const action = event.action;
  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(cs => {
      const existing = cs.find(c => c.url.includes('atlas'));
      if(existing) {
        existing.focus();
        if(sym && action !== 'dismiss') existing.postMessage({type:'ANALYSE_SYM', sym});
        return;
      }
      if(action !== 'dismiss') clients.openWindow(self.registration.scope + (sym ? '?sym='+sym : ''));
    })
  );
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = event.request.url;
  if(API_BYPASS.some(d => url.includes(d))) return;

  // For the main HTML file — ALWAYS fetch fresh from network, never serve cached
  if(event.request.mode==='navigate' || url.endsWith('.html') || url.endsWith('/') || url===self.registration.scope){
    event.respondWith(
      fetch(event.request, {cache:'no-store'})
        .then(r => {
          if(r.ok){
            const clone = r.clone();
            caches.open(CACHE_VERSION).then(c => c.put(event.request, clone));
          }
          return r;
        })
        .catch(() => caches.match(event.request)
          .then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Fonts and static assets — cache first
  if(url.includes('fonts.googleapis') || url.includes('fonts.gstatic')){
    event.respondWith(
      caches.match(event.request).then(cached => {
        if(cached) return cached;
        return fetch(event.request).then(r => {
          if(r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
          return r;
        });
      })
    );
    return;
  }

  // Everything else — network first, cache fallback
  event.respondWith(
    fetch(event.request, {cache:'no-store'})
      .then(r => {
        if(r.ok) caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
        return r;
      })
      .catch(() => caches.match(event.request))
  );
});
