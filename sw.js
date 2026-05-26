// ================================================================
// ATLAS SERVICE WORKER — Complete PWA + Background Alert Monitor
// Version: 4.2  — full forex symbol coverage (49 pairs)
// Place in SAME folder as index.html
// ================================================================
'use strict';

// ── Cache versioning ───────────────────────────────────────────
// A fresh timestamp-based cache name is generated on every install.
// This guarantees every GitHub Pages deploy gets a clean slate —
// no stale content survives across updates regardless of cache name.
const CACHE_PREFIX   = 'atlas-';
const CACHE_ID_KEY   = 'atlas_sw_cache_id'; // persisted in IDB

// Module-level variable; lives for the lifetime of this SW instance.
// Re-populated from IDB if the SW is restarted by the browser.
let _cacheName = null;

async function activeCacheName() {
  if (_cacheName) return _cacheName;
  try { _cacheName = await idbGet(CACHE_ID_KEY); } catch {}
  return _cacheName || (CACHE_PREFIX + 'fallback');
}

// ── Install ────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // Every install (= every changed sw.js detected by the browser)
    // gets a brand-new unique cache name. Old cache is wiped in activate.
    _cacheName = CACHE_PREFIX + Date.now();
    try { await idbSet(CACHE_ID_KEY, _cacheName); } catch {}

    const cache = await caches.open(_cacheName);

    // Use cache:'reload' to bypass the HTTP/CDN layer and always
    // store the truly latest files on a fresh install.
    await Promise.allSettled([
      fetch('./index.html',   { cache: 'reload' }).then(r => r.ok && cache.put('./index.html',   r)),
      fetch('./manifest.json',{ cache: 'reload' }).then(r => r.ok && cache.put('./manifest.json', r)),
    ]);

    self.skipWaiting();
  })());
});

// ── Activate ───────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Re-read in case SW was restarted and _cacheName is null
    if (!_cacheName) {
      try { _cacheName = await idbGet(CACHE_ID_KEY); } catch {}
    }

    // Wipe EVERY previous atlas-* cache — covers all past version names
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== _cacheName)
        .map(k => caches.delete(k))
    );

    await clients.claim();
  })());
});

// ── Fetch — network-first; HTML always bypasses HTTP cache ────
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Only handle same-origin requests and skip API calls
  if (!url.startsWith(self.location.origin)) return;
  if (url.includes('api.anthropic') || url.includes('yahoo') ||
      url.includes('telegram') || url.includes('supabase')) return;

  e.respondWith((async () => {
    const cacheName = await activeCacheName();

    // For HTML documents, use cache:'no-store' so we always hit the
    // real network and skip GitHub Pages' CDN/HTTP cache layer.
    const isDoc = e.request.destination === 'document';
    const fetchOpts = isDoc ? { cache: 'no-store' } : {};

    try {
      const res = await fetch(e.request, fetchOpts);
      if (res?.ok && e.request.method === 'GET') {
        const cache = await caches.open(cacheName);
        // NEW_VERSION detection: if ETag/Last-Modified changed, tell open tabs
        if (isDoc) {
          const cached = await cache.match(e.request);
          const freshTag  = res.headers.get('etag') || res.headers.get('last-modified') || '';
          const cachedTag = cached ? (cached.headers.get('etag') || cached.headers.get('last-modified') || '') : '';
          if (freshTag && cachedTag && freshTag !== cachedTag) {
            clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(list => {
              list.forEach(c => { try { c.postMessage({ type: 'NEW_VERSION' }); } catch {} });
            });
          }
        }
        cache.put(e.request, res.clone());
      }
      return res;
    } catch {
      // Offline fallback — serve whatever is in the current cache
      const cached = await caches.match(e.request);
      return cached ?? new Response('Offline — no cached version available', {
        status: 503, headers: { 'Content-Type': 'text/plain' }
      });
    }
  })());
});

// ── Periodic Background Sync (Chrome Android PWA) ─────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'atlas-alerts')    e.waitUntil(checkAlerts());
  if (e.tag === 'atlas-wl-scan')   e.waitUntil(checkWlAlerts());
});

// ── Background Sync fallback ───────────────────────────────────
self.addEventListener('sync', e => {
  if (e.tag === 'atlas-alerts-sync') e.waitUntil(checkAlerts());
  if (e.tag === 'atlas-wl-sync')     e.waitUntil(checkWlAlerts());
});

// ── Push notifications (future) ────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const d = e.data.json();
    e.waitUntil(
      self.registration.showNotification(d.title || 'ATLAS Alert', {
        body:  d.body  || '',
        icon:  './icon-192.png',
        badge: './favicon-32.png',
        tag:   d.tag   || 'atlas-push'
      })
    );
  } catch {}
});

// ── Notification click — bring app to front ────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('index.html') || c.url.endsWith('/')) return c.focus();
      }
      return clients.openWindow('./index.html');
    })
  );
});

// ── Message from page ──────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING')    self.skipWaiting();
  if (e.data?.type === 'CHECK_ALERTS_NOW') checkAlerts();
  // Force all open tabs to hard-reload (used after SW takes over)
  if (e.data?.type === 'FORCE_RELOAD') {
    clients.matchAll({ type: 'window' }).then(list => {
      list.forEach(c => { try { c.navigate(c.url); } catch {} });
    });
  }
  // Cache watchlist pairs from page for background scanning
  if (e.data?.type === 'WL_SYNC') {
    idbSet('atlas_wl_pairs',  JSON.stringify(e.data.pairs  || []));
    idbSet('atlas_tg_token',  e.data.tgToken || '');
    idbSet('atlas_tg_chat',   e.data.tgChat  || '');
  }
});

// ═══════════════════════════════════════════════════════════════
// BACKGROUND ALERT ENGINE
// ═══════════════════════════════════════════════════════════════

// ── IndexedDB helpers ──────────────────────────────────────────
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('atlas_sw_db', 1);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const g  = tx.objectStore('kv').get(key);
    g.onsuccess = () => res(g.result);
    g.onerror   = () => rej(g.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    const p  = tx.objectStore('kv').put(val, key);
    p.onsuccess = () => res();
    p.onerror   = () => rej(p.error);
  });
}

// ── Symbol mapper ──────────────────────────────────────────────
function ySym(sym) {
  const m = {
    XAUUSD:'GC=F', XAGUSD:'SI=F', USOIL:'CL=F', UKOIL:'BZ=F',
    US500:'^GSPC', US30:'^DJI', US100:'^NDX', UK100:'^FTSE',
    BTCUSD:'BTC-USD', ETHUSD:'ETH-USD',
    // Major USD pairs (all 7)
    USDJPY:'JPY=X',   EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X',
    AUDUSD:'AUDUSD=X',USDCAD:'CAD=X',    USDCHF:'CHF=X',
    NZDUSD:'NZDUSD=X',
    // USD minors / exotics
    USDSGD:'SGD=X',   USDMXN:'MXN=X',   USDNOK:'NOK=X',
    USDSEK:'SEK=X',   USDZAR:'ZAR=X',   USDTRY:'TRY=X',
    USDHKD:'HKD=X',
    // JPY crosses (all 7)
    EURJPY:'EURJPY=X', GBPJPY:'GBPJPY=X', AUDJPY:'AUDJPY=X',
    CADJPY:'CADJPY=X', CHFJPY:'CHFJPY=X', NZDJPY:'NZDJPY=X',
    // EUR crosses
    EURGBP:'EURGBP=X', EURCAD:'EURCAD=X', EURCHF:'EURCHF=X',
    EURAUD:'EURAUD=X', EURNZD:'EURNZD=X',
    // GBP crosses
    GBPAUD:'GBPAUD=X', GBPCAD:'GBPCAD=X', GBPCHF:'GBPCHF=X',
    GBPNZD:'GBPNZD=X',
    // AUD crosses
    AUDCAD:'AUDCAD=X', AUDCHF:'AUDCHF=X', AUDNZD:'AUDNZD=X',
    // NZD crosses
    NZDCAD:'NZDCAD=X', NZDCHF:'NZDCHF=X'
  };
  return m[sym] || sym;
}

function fmtP(p) {
  if (!p) return '–';
  return p > 500 ? p.toFixed(2) : p > 10 ? p.toFixed(3) : p.toFixed(4);
}

// Returns the EMA value for the last element in closes array
function calcEMA(closes, period) {
  if (!closes || closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a,b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Returns EMA of the second-to-last candle (prev bar) for crossover detection
function calcPrevEMA(closes, period) {
  if (closes.length < 2) return null;
  return calcEMA(closes.slice(0, -1), period);
}

function calcRSI(closes) {
  if (!closes || closes.length < 15) return null;
  const sl = closes.slice(-15).filter(v => v != null);
  if (sl.length < 14) return null;
  let g = 0, l = 0;
  for (let i = 1; i < 14; i++) {
    const d = sl[i] - sl[i-1];
    if (d > 0) g += d; else l += Math.abs(d);
  }
  const ag = g/13, al = l/13;
  return al === 0 ? 100 : 100 - (100 / (1 + ag/al));
}

// ── Core checker ───────────────────────────────────────────────
async function checkAlerts() {
  let raw;
  try { raw = await idbGet('atlas_alerts_v1'); } catch { return; }
  if (!raw) return;

  let alertsData;
  try { alertsData = JSON.parse(raw); } catch { return; }

  const active = alertsData.filter(a => a.active && !a.firedAt);
  if (!active.length) return;

  const syms = [...new Set(active.map(a => a.sym))];
  let changed = false;

  for (const sym of syms) {
    let price = null, rsiVal = null;
    try {
      const r = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/' +
        ySym(sym) + '?interval=1m&range=1d',
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) continue;
      const d = await r.json();
      const res = d?.chart?.result?.[0];
      if (!res) continue;
      const q = res.indicators.quote[0];
      const cl = (q.close || []).filter(v => v != null);
      if (!cl.length) continue;
      price  = cl[cl.length - 1];
      rsiVal = calcRSI(cl);
    } catch { continue; }

    for (const a of active.filter(x => x.sym === sym)) {
      const prev = a.lastPrice;
      let fire = false;

      if (a.condition === 'price_above'    && a.value && price > a.value && (prev == null || prev <= a.value)) fire = true;
      if (a.condition === 'price_below'    && a.value && price < a.value && (prev == null || prev >= a.value)) fire = true;
      if (a.condition === 'price_at_level' && a.value && Math.abs(price-a.value)/a.value < 0.001) fire = true;
      if (a.condition === 'rsi_above' && rsiVal != null && a.value && rsiVal > a.value && (a.lastRsi == null || a.lastRsi <= a.value)) fire = true;
      if (a.condition === 'rsi_below' && rsiVal != null && a.value && rsiVal < a.value && (a.lastRsi == null || a.lastRsi >= a.value)) fire = true;
      if (a.condition === 'rsi_ob' && rsiVal != null && rsiVal > 70 && (a.lastRsi == null || a.lastRsi <= 70)) fire = true;
      if (a.condition === 'rsi_os' && rsiVal != null && rsiVal < 30 && (a.lastRsi == null || a.lastRsi >= 30)) fire = true;
      // EMA crossover conditions
      const fastEMA = calcEMA(cl, 9);
      const slowEMA = calcEMA(cl, 21);
      const prevFastEMA = calcPrevEMA(cl, 9);
      const prevSlowEMA = calcPrevEMA(cl, 21);
      if (a.condition === 'ema_cross_above' && fastEMA && slowEMA && prevFastEMA && prevSlowEMA) {
        if (fastEMA > slowEMA && prevFastEMA <= prevSlowEMA) fire = true;
      }
      if (a.condition === 'ema_cross_below' && fastEMA && slowEMA && prevFastEMA && prevSlowEMA) {
        if (fastEMA < slowEMA && prevFastEMA >= prevSlowEMA) fire = true;
      }
      // New high / new low vs prior candles in the fetched range
      if (a.condition === 'new_high' && cl.length > 1) {
        const prevHigh = Math.max(...cl.slice(0, -1));
        if (price > prevHigh && (prev == null || prev <= prevHigh)) fire = true;
      }
      if (a.condition === 'new_low' && cl.length > 1) {
        const prevLow = Math.min(...cl.slice(0, -1));
        if (price < prevLow && (prev == null || prev >= prevLow)) fire = true;
      }

      a.lastPrice = price;
      if (rsiVal != null) a.lastRsi = rsiVal;

      if (fire) {
        a.firedAt = new Date().toISOString();
        a.active  = false;
        changed   = true;

        // Show OS notification (works when app is closed)
        try {
          await self.registration.showNotification('ATLAS Alert: ' + a.sym, {
            body:     (a.label || (a.sym + ' @ ' + fmtP(price))) +
                      (rsiVal ? '  |  RSI ' + rsiVal.toFixed(1) : '') +
                      '\nPrice: ' + fmtP(price),
            icon:     './icon-192.png',
            badge:    './favicon-32.png',
            tag:      'atlas-alert-' + a.id,
            renotify: true,
            data:     { sym: a.sym, price, label: a.label }
          });
        } catch {}

        // Tell open app tabs
        const appClients = await clients.matchAll({ includeUncontrolled: true });
        for (const c of appClients) {
          try { c.postMessage({ type: 'ALERT_FIRED', label: a.label, sym: a.sym, price }); } catch {}
        }

        // Telegram
        await sendTG(a, price, rsiVal);
      }
    }
  }

  if (changed) {
    try { await idbSet('atlas_alerts_v1', JSON.stringify(alertsData)); } catch {}
  }
}

async function sendTG(a, price, rsiVal) {
  try {
    const token  = await idbGet('atlas_tg_token');
    const chatId = await idbGet('atlas_tg_chat');
    if (!token || !chatId) return;
    const msg = '*🔔 ATLAS ALERT: ' + a.label + '*\n' +
      a.sym + ' @ `' + fmtP(price) + '`' +
      (rsiVal ? '\nRSI: ' + rsiVal.toFixed(1) : '') +
      '\n\n_ATLAS Trading Intelligence_';
    await fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
    });
  } catch {}
}

// ── Watchlist background price check ──────────────────────────
async function checkWlAlerts() {
  let raw;
  try { raw = await idbGet('atlas_wl_pairs'); } catch { return; }
  if (!raw) return;

  let pairs;
  try { pairs = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(pairs) || !pairs.length) return;

  const tgToken = await idbGet('atlas_tg_token').catch(() => null);
  const tgChat  = await idbGet('atlas_tg_chat').catch(() => null);

  // Fetch prices for all watchlist pairs in parallel
  const results = await Promise.allSettled(
    pairs.map(async p => {
      try {
        const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
          ySym(p.sym) + '?interval=1m&range=5m';
        const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const json = await resp.json();
        const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
        return { sym: p.sym, price, pair: p };
      } catch { return null; }
    })
  );

  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) continue;
    const { sym, price, pair } = r.value;
    if (!price || !pair.alertActive) continue;

    // Price-level alert
    let fire = false;
    if (pair.alertPrice) {
      const threshold = price > 100 ? 0.05 : 0.0003;
      if (Math.abs(price - pair.alertPrice) <= threshold) fire = true;
      if (pair.alertDir === 'above' && price >= pair.alertPrice) fire = true;
      if (pair.alertDir === 'below' && price <= pair.alertPrice) fire = true;
    }

    if (!fire) continue;

    const body = `${sym} @ ${fmtP(price)}${pair.alertPrice ? ' — alert level: ' + fmtP(pair.alertPrice) : ''}`;

    // Browser push notification
    await self.registration.showNotification('⚡ ATLAS WATCHLIST: ' + sym, {
      body,
      icon:  './icon-192.png',
      badge: './favicon-32.png',
      tag:   'wl-alert-' + sym,
      renotify: true
    });

    // Telegram
    if (tgToken && tgChat) {
      try {
        await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: tgChat,
            text: `⚡ *ATLAS WATCHLIST ALERT*\n\`${sym}\` @ \`${fmtP(price)}\`\n${pair.alertPrice ? 'Alert level: ' + fmtP(pair.alertPrice) : ''}\n\n_ATLAS background monitor_`,
            parse_mode: 'Markdown'
          })
        });
      } catch {}
    }
  }
}
