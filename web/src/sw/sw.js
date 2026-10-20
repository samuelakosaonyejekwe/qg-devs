/* QG-DEVS service worker (hand-written).
 *
 * Caches
 *   qg-shell-<version>  app shell, precached on install
 *   qg-lazy-<version>   all other build chunks, cached in the background after activation
 *   qg-api              GET /api/* responses (stale-while-revalidate)
 *
 * Response headers added to API responses so the UI never presents cached data as fresh:
 *   x-qg-source:    network | cache | offline
 *   x-qg-cached-at: ISO time the payload was fetched from the server
 *
 * Request header x-qg-cache-only: 1 → serve the cached copy without background revalidation
 *   (use it when re-reading after API_REFRESHED). x-qg-no-cache: 1 → bypass the API cache entirely.
 * Messages (page → worker): SKIP_WAITING, GET_CACHE_INFO (reply on ports[0]), CLEAR_API_CACHE
 * Messages (worker → page): API_REFRESHED {url, at}, SYNC_QUEUE, LAZY_CACHED {count}
 */
/* eslint-disable no-restricted-globals */

const SHELL = typeof __QG_SHELL__ !== 'undefined' ? __QG_SHELL__ : ['/', '/index.html'];
const LAZY = typeof __QG_LAZY__ !== 'undefined' ? __QG_LAZY__ : [];
// Precache lists are root-relative; resolve them under this worker's scope so the same sw.js works when the
// app is served from a sub-path (e.g. GitHub Pages "/qg-devs/").
const SCOPE_PATH = new URL(self.registration ? self.registration.scope : self.location.href).pathname.replace(/[^/]*$/, '');
const P = (u) => SCOPE_PATH + String(u).replace(/^\//, '');
const rel = (pathname) => (pathname.startsWith(SCOPE_PATH) ? '/' + pathname.slice(SCOPE_PATH.length) : pathname);
const VERSION = typeof __QG_VERSION__ !== 'undefined' ? __QG_VERSION__ : 'dev';

const SHELL_CACHE = `qg-shell-${VERSION}`;
const LAZY_CACHE = `qg-lazy-${VERSION}`;
const API_CACHE = 'qg-api';
const NAV_TIMEOUT_MS = 4000;
// A cached API copy younger than this is served without a background refresh (prevents refresh loops).
const REVALIDATE_MIN_AGE_MS = 3000;
// The server's gzip middleware sends `Vary: Accept-Encoding`. Entries precached by URL carry no request
// headers, so without ignoreVary they would never match the browser's real requests. Assets are
// content-hashed (immutable) and API entries are keyed by URL, so ignoring Vary is safe here.
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL.map((u) => new Request(P(u), { cache: 'reload' })));
    // First install (no active worker yet): activate immediately. Updates wait for SKIP_WAITING.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => (n.startsWith('qg-shell-') && n !== SHELL_CACHE) || (n.startsWith('qg-lazy-') && n !== LAZY_CACHE))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
    trimApiCache();
    // Background: cache all lazily loaded chunks so every page works offline after the first visit.
    precacheLazy();
  })());
});

async function precacheLazy() {
  try {
    const cache = await caches.open(LAZY_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    let n = 0;
    for (const url0 of LAZY) {
      const url = P(url0);
      if ((await cache.match(url, MATCH)) || (await shell.match(url, MATCH))) { n++; continue; }
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) { await cache.put(url, res); n++; }
      } catch (_) { /* offline during background caching: retry next activation */ }
    }
    await broadcast({ type: 'LAZY_CACHED', count: n, total: LAZY.length });
  } catch (_) { /* ignore */ }
}

async function broadcast(msg) {
  const list = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of list) c.postMessage(msg);
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'x-qg-source': 'offline' },
  });
}

function isApi(url) {
  return url.pathname.startsWith('/api/') || url.pathname.includes('/api/');
}

function isStatic(url) {
  const p = rel(url.pathname);
  return p.startsWith('/assets/') || p.startsWith('/icons/') || p === '/manifest.webmanifest' || p === '/favicon.ico' || p === '/theme-init.js';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (isApi(url)) {
    if (req.method === 'GET') {
      event.respondWith(apiStaleWhileRevalidate(event, req));
    } else {
      event.respondWith(fetch(req).catch(() => jsonResponse(503, { detail: 'offline', offline: true })));
    }
    return;
  }
  if (!sameOrigin || req.method !== 'GET') return;
  if (rel(url.pathname) === '/sw.js') return;

  if (req.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(req));
    return;
  }
  if (isStatic(url)) {
    event.respondWith(cacheFirst(req));
  }
});

async function navigationNetworkFirst(req) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)),
    ]);
    if (res && res.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(P('/index.html'), res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    const cached = (await caches.match(P('/index.html'), MATCH)) || (await caches.match(P('/'), MATCH));
    return cached || new Response('<!doctype html><meta charset="utf-8"><title>QG-DEVS</title><p>Offline and the application shell is not cached yet.</p>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req, MATCH);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(LAZY_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

function cacheable(req, res) {
  if (!res || res.status !== 200) return false;
  if (req.headers.get('x-qg-no-cache') === '1') return false;
  const cc = (req.headers.get('cache-control') || '') + ',' + (res.headers.get('cache-control') || '');
  return !/no-store/i.test(cc);
}

/** Copy a response, adding headers. Body is read into memory (API payloads are small). */
async function withHeaders(res, extra) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  const body = await res.arrayBuffer();
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

// API cache limits: entries older than MAX_AGE are evicted, and at most MAX_ENTRIES are kept
// (oldest stored first), so the cache cannot grow without bound on long-lived installs.
const API_MAX_ENTRIES = 300;
const API_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
let trimming = null;
function trimApiCache() {
  if (trimming) return trimming;
  trimming = (async () => {
    try {
      const cache = await caches.open(API_CACHE);
      const keys = await cache.keys();
      const items = [];
      for (const k of keys) {
        const r = await cache.match(k, MATCH);
        const at = Date.parse((r && r.headers.get('x-qg-stored-at')) || '') || 0;
        items.push({ k, at });
      }
      const now = Date.now();
      items.sort((a, b) => a.at - b.at);
      const excess = Math.max(0, items.length - API_MAX_ENTRIES);
      for (let i = 0; i < items.length; i++) {
        if (i < excess || now - items[i].at > API_MAX_AGE_MS) await cache.delete(items[i].k);
      }
    } catch (_) { /* best effort */ }
    trimming = null;
  })();
  return trimming;
}

async function fetchAndStore(req) {
  const res = await fetch(req);
  const at = new Date().toISOString();
  if (cacheable(req, res)) {
    const stored = await withHeaders(res.clone(), { 'x-qg-stored-at': at });
    const cache = await caches.open(API_CACHE);
    await cache.put(req.url, stored);
    if (Math.random() < 0.1) trimApiCache(); // amortised trimming
  }
  return { res, at };
}

async function apiStaleWhileRevalidate(event, req) {
  const noCache = req.headers.get('x-qg-no-cache') === '1' || /no-store/i.test(req.headers.get('cache-control') || '');
  const cache = await caches.open(API_CACHE);
  const cached = noCache ? null : await cache.match(req.url, MATCH);

  if (cached) {
    const storedAt = cached.headers.get('x-qg-stored-at') || '';
    const age = storedAt ? Date.now() - Date.parse(storedAt) : Infinity;
    const cacheOnly = req.headers.get('x-qg-cache-only') === '1';
    if (cacheOnly || age < REVALIDATE_MIN_AGE_MS) {
      return withHeaders(cached, { 'x-qg-source': 'cache', 'x-qg-cached-at': storedAt });
    }
    // Serve cached copy now; refresh in the background and tell pages when fresh data is stored.
    event.waitUntil((async () => {
      try {
        const { res, at } = await fetchAndStore(req.clone());
        if (res.ok) await broadcast({ type: 'API_REFRESHED', url: req.url, at });
      } catch (_) { /* offline: keep cached copy */ }
    })());
    return withHeaders(cached, { 'x-qg-source': 'cache', 'x-qg-cached-at': storedAt });
  }

  try {
    const { res, at } = noCache ? { res: await fetch(req), at: new Date().toISOString() } : await fetchAndStore(req);
    return withHeaders(res, { 'x-qg-source': 'network', 'x-qg-cached-at': at });
  } catch (_) {
    return jsonResponse(503, { detail: 'offline: no cached copy of this resource', offline: true });
  }
}

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'GET_CACHE_INFO') {
    event.waitUntil((async () => {
      const count = async (name) => {
        if (!(await caches.has(name))) return 0;
        return (await (await caches.open(name)).keys()).length;
      };
      const info = { version: VERSION, shell: await count(SHELL_CACHE), lazy: await count(LAZY_CACHE),
        api: await count(API_CACHE), lazyTotal: LAZY.length, shellTotal: SHELL.length };
      if (event.ports && event.ports[0]) event.ports[0].postMessage(info);
    })());
  } else if (data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE).then(() => {
      if (event.ports && event.ports[0]) event.ports[0].postMessage({ ok: true });
    }));
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'qg-queue') {
    event.waitUntil(broadcast({ type: 'SYNC_QUEUE' }));
  }
});
