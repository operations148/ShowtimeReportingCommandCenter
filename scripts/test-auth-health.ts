/**
 * Auth health-probe tests. Run: npx tsx scripts/test-auth-health.ts
 *
 * Two layers:
 *   1. Unit tests of checkAuthReachability() with an injected fetch (no network).
 *   2. Route-level tests of GET /api/health/auth against the REAL compiled api/index.js,
 *      each in its own subprocess because src/supabase.ts fixes its normalized config at
 *      first import. These assert the public body is minimal and leaks nothing.
 *
 * Requires api/index.js to be current: run the Vercel buildCommand first.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';

process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'FAKE-TEST-KEY-not-a-real-credential';

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${e}, got ${a}`); }
}

function resp(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as unknown as Response;
}
function netErr(code: string, name = 'TypeError') {
  const e: any = new Error('fetch failed'); e.name = name; e.cause = { code }; return e;
}

const WORKER = path.resolve(process.cwd(), '_health_route_worker.mjs');

/** Boots the compiled Express app with the given env and probes /api/health/auth once. */
function routeProbe(env: Record<string, string>): { status?: number; body?: string; keys?: string[] } {
  const src = `
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { default: app } = require('./api/index.js');
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const res = await fetch('http://127.0.0.1:' + port + '/api/health/auth');
const body = await res.text();
console.log(JSON.stringify({ status: res.status, body, keys: Object.keys(JSON.parse(body)) }));
server.close(); process.exit(0);
`;
  writeFileSync(WORKER, src);
  try {
    const r = spawnSync('node', [WORKER], {
      env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000, cwd: process.cwd()
    });
    const line = (r.stdout || '').trim().split('\n').filter(l => l.startsWith('{')).pop();
    return line ? JSON.parse(line) : { body: r.stderr };
  } finally {
    try { unlinkSync(WORKER); } catch { /* already gone */ }
  }
}

async function main() {
  const { checkAuthReachability, __resetAuthHealthCache } = await import('../src/supabase.js');

  console.log('\n--- unit: checkAuthReachability ---');

  // Healthy: GoTrue answers unauthenticated /auth/v1/health with 401 — any HTTP response
  // proves DNS + TLS + transport + service liveness, which is the whole question.
  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => resp(401)) as unknown as typeof fetch });
    check('401 from GoTrue counts as reachable (no key sent, still proves liveness)', r.healthy, true);
    check('reason is "reachable"', r.reason, 'reachable');
  }

  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => resp(200)) as unknown as typeof fetch });
    check('200 from upstream is healthy', r.healthy, true);
  }

  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => resp(503)) as unknown as typeof fetch });
    check('upstream 5xx is degraded', r.healthy, false);
    check('upstream 5xx reason names the status', r.reason, 'upstream_503');
  }

  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => { throw netErr('ENOTFOUND'); }) as unknown as typeof fetch });
    check('DNS failure is degraded', r.healthy, false);
    check('DNS failure reason', r.reason, 'host_unresolvable');
  }

  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => { throw netErr('ECONNRESET'); }) as unknown as typeof fetch });
    check('TLS/connection reset is degraded', r.healthy, false);
    check('connection failure reason', r.reason, 'unreachable');
  }

  __resetAuthHealthCache();
  {
    const r = await checkAuthReachability({ fetchImpl: (async () => { throw netErr('ETIMEDOUT', 'TimeoutError'); }) as unknown as typeof fetch });
    check('timeout is degraded', r.healthy, false);
    check('timeout is flagged in server-side diagnostics', (r.diagnostics as any).timedOut, true);
  }

  // Cache: bounds upstream traffic so polling/abuse cannot be amplified.
  __resetAuthHealthCache();
  {
    let calls = 0;
    const f = (async () => { calls++; return resp(401); }) as unknown as typeof fetch;
    await checkAuthReachability({ fetchImpl: f });
    const second = await checkAuthReachability({ fetchImpl: f });
    check('second call within TTL is served from cache (upstream hit once)', calls, 1);
    check('cached result is flagged as cached', second.cached, true);
  }

  console.log('\n--- unit: missing / invalid configuration ---');
  // These need different module-level config, so they run in subprocesses via the route.

  console.log('\n--- route: GET /api/health/auth (real compiled app) ---');

  {
    const r = routeProbe({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    check('missing config -> 503', r.status, 503);
    check('missing config -> body is exactly {"status":"degraded"}', r.body, '{"status":"degraded"}');
  }

  {
    const r = routeProbe({ SUPABASE_URL: 'not-a-valid-url', SUPABASE_SERVICE_ROLE_KEY: 'FAKE-TEST-KEY-2' });
    check('invalid URL config -> 503', r.status, 503);
    check('invalid URL config -> minimal body', r.keys, ['status']);
  }

  {
    const SECRET_HOST = 'health-secret-probe-zzqx.supabase.co';
    const SECRET_KEY = 'FAKE-KEY-MUST-NEVER-APPEAR-IN-RESPONSE-BODY';
    const r = routeProbe({ SUPABASE_URL: `https://${SECRET_HOST}`, SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY });
    check('unresolvable host -> 503', r.status, 503);
    check('body has exactly one key ("status") — no reason, no diagnostics', r.keys, ['status']);
    check('body never contains the Supabase hostname', (r.body || '').includes(SECRET_HOST), false);
    check('body never contains the service-role key', (r.body || '').includes(SECRET_KEY), false);
    check('body never contains a DNS/error code', /ENOTFOUND|EAI_AGAIN|ECONN|getaddrinfo/i.test(r.body || ''), false);
    check('body never contains a stack trace', /at .*\(|\.ts:|\.js:/.test(r.body || ''), false);
  }

  // Live check against the real project, if credentials are available locally.
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true, quiet: true } as any);
  const liveUrl = process.env.SUPABASE_URL;
  const liveKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (liveUrl && liveKey && liveUrl.includes('supabase.co') && !liveUrl.includes('unit-test')) {
    const r = routeProbe({ SUPABASE_URL: liveUrl, SUPABASE_SERVICE_ROLE_KEY: liveKey });
    check('live project -> 200', r.status, 200);
    check('live project -> body is exactly {"status":"ok"}', r.body, '{"status":"ok"}');
  } else {
    console.log('  SKIP  live-project probe (no usable .env.local credentials)');
  }

  console.log('');
  if (failures.length === 0) console.log(`  All ${passed} health assertions passed.\n`);
  else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
