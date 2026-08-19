// DashPro Service Worker v4
//
// RULES:
//  - Auth + SSO endpoints (/api/auth/*, /api/ghl/sso) → NEVER intercepted.
//    They must always reach the network. Returning a synthetic error here
//    causes verifySession to call logout() and bounce the user to login.
//  - Non-auth API GET requests → network-first, cached for offline fallback.
//  - Non-GET API requests (POST/PUT/DELETE) → network-only, never cached.
//  - Static assets (JS/CSS/images) → cache-first, populated on first hit.
//  - Navigation → SPA fallback to cached index.html when offline.

const SHELL_CACHE = 'dashpro-shell-v4';
const DATA_CACHE  = 'dashpro-data-v4';
const OLD_CACHES  = [
  'dashpro-v1', 'dashpro-v2',
  'dashpro-shell-v2', 'dashpro-data-v2',
  'dashpro-shell-v3', 'dashpro-data-v3'
];

// Auth-related paths that must NEVER be served from cache.
// /api/health/ is included deliberately: it is a GET under /api/, so without this it would
// fall into the network-first data cache below and could serve a stale {"status":"ok"}
// during a live outage — the one thing a health probe must never do.
const AUTH_PATHS = ['/api/auth/', '/api/ghl/sso', '/api/health/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.add('/'))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => OLD_CACHES.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── helpers ────────────────────────────────────────────────────────────────

function notifyClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true })
    .then(clients => clients.forEach(c => c.postMessage(msg)));
}

async function cacheApiResponse(request, response) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put(request, response.clone());
  await cache.put(
    new Request(request.url + '__ts'),
    new Response(String(Date.now()), { headers: { 'Content-Type': 'text/plain' } })
  );
}

async function getCachedApi(request) {
  const cache = await caches.open(DATA_CACHE);
  const [res, ts] = await Promise.all([
    cache.match(request),
    cache.match(new Request(request.url + '__ts'))
  ]);
  if (!res) return null;
  const cachedAt = ts ? Number(await ts.text()) : 0;
  return { response: res, cachedAt };
}

// ── fetch handler ──────────────────────────────────────────────────────────

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── AUTH + SSO: pass through entirely — never intercept ────────────────
  // Intercepting these causes logout() to fire on any network hiccup.
  if (AUTH_PATHS.some(p => url.pathname.startsWith(p))) {
    return; // browser handles it directly, no SW involvement
  }

  // ── Non-GET API requests (POST/PUT/DELETE): network-only ───────────────
  // Never cache mutations; let them fail naturally if offline.
  if (url.pathname.startsWith('/api/') && request.method !== 'GET') {
    return; // browser handles it directly
  }

  // ── API GET requests: network-first, fall back to data cache ───────────
  if (url.pathname.startsWith('/api/')) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request.clone());
        if (res.ok) {
          await cacheApiResponse(request, res);
          notifyClients({ type: 'DATA_FRESH', url: request.url, time: Date.now() });
        }
        return res;
      } catch {
        const hit = await getCachedApi(request);
        if (hit) {
          notifyClients({ type: 'DATA_FROM_CACHE', url: request.url, cachedAt: hit.cachedAt });
          const body = await hit.response.text();
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': hit.response.headers.get('Content-Type') || 'application/json',
              'X-SW-Cache': 'true',
              'X-SW-Cache-Time': String(hit.cachedAt)
            }
          });
        }
        // No cache — propagate the network failure naturally
        // (do NOT synthesize a 503; callers must handle fetch() throwing)
        throw new Error('offline-no-cache');
      }
    })());
    return;
  }

  // ── Navigation: SPA fallback ────────────────────────────────────────────
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cached = await caches.match('/');
        if (cached) return cached;
        const fallback = await caches.match('/index.html');
        if (fallback) return fallback;
        return new Response(
          '<h1>Offline</h1><p>Please reconnect to use DashPro.</p>',
          { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
      }
    })());
    return;
  }

  // ── Static assets: cache-first ──────────────────────────────────────────
  e.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const res = await fetch(request);
      if (res.ok && res.type !== 'opaque') {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, res.clone()); // fire-and-forget
      }
      return res;
    } catch {
      return new Response('', { status: 408 });
    }
  })());
});

// ── message handler ────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
