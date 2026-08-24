// DashPro Service Worker v5
//
// RULES:
//  - NEVER_CACHED_API_PATHS → never intercepted, never stored, never served from cache.
//    They must always reach the network.
//  - Other API GET requests → network-first, cached for offline fallback.
//  - Non-GET API requests (POST/PUT/DELETE) → network-only, never cached.
//  - Static assets (JS/CSS/images) → cache-first, populated on first hit.
//  - Navigation → SPA fallback to cached index.html when offline.

const SHELL_CACHE = 'dashpro-shell-v5';
const DATA_CACHE  = 'dashpro-data-v5';
const OLD_CACHES  = [
  'dashpro-v1', 'dashpro-v2',
  'dashpro-shell-v2', 'dashpro-data-v2',
  'dashpro-shell-v3', 'dashpro-data-v3',
  // v4 data cache is retired so any /api/tasks responses that a previous worker may have
  // stored are dropped rather than lingering as stale task data.
  'dashpro-shell-v4', 'dashpro-data-v4'
];

// API paths that must NEVER be served from Cache Storage. Renamed from AUTH_PATHS because
// the list is no longer auth-specific — it is now "responses where a stale answer is worse
// than no answer at all":
//   /api/auth/, /api/ghl/sso  a synthetic/cached error makes verifySession log the user out.
//   /api/health/              a cached {"status":"ok"} would hide a live outage.
//   /api/tasks/               task state is mutable and collaborative; a stale board, or a
//                             stale ACTIVE TIMER showing a timer that was already stopped,
//                             is actively misleading. Time data must never come from cache.
const NEVER_CACHED_API_PATHS = ['/api/auth/', '/api/ghl/sso', '/api/health/', '/api/tasks/'];

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

  // ── Never-cached APIs: pass through entirely — never intercept ─────────
  // Auth/SSO: intercepting causes logout() to fire on any network hiccup.
  // Health: a cached "ok" would mask a live outage.
  // Tasks: stale board state or a stale active timer is worse than an error.
  if (NEVER_CACHED_API_PATHS.some(p => url.pathname.startsWith(p))) {
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
