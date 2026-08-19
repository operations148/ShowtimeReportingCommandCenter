/**
 * Post-deployment production smoke test.
 *
 *   BASE_URL=https://your-app.vercel.app npx tsx scripts/smoke-test-production.ts
 *
 * Optional authenticated check — supply credentials via environment only, never as args
 * (argv is visible in process listings and shell history):
 *   SMOKE_EMAIL=... SMOKE_PASSWORD=... BASE_URL=... npx tsx scripts/smoke-test-production.ts
 *
 * Prints no password, JWT, service-role key, or Authorization header under any outcome.
 * Exits non-zero if any check fails, so it can gate a deploy pipeline.
 */

import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true } as any);

const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) {
  console.error('\nBASE_URL is required, e.g. BASE_URL=https://your-app.vercel.app\n');
  process.exit(1);
}

const TIMEOUT_MS = 20_000;
let passed = 0;
const failures: string[] = [];

function record(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

async function req(method: string, pathname: string, opts: { body?: unknown; token?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['x-auth-token'] = opts.token;
  const started = Date.now();
  try {
    const res = await fetch(BASE_URL + pathname, {
      method, headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body */ }
    return { status: res.status, json, text, ms: Date.now() - started };
  } catch (err: any) {
    // Only the error name/code is surfaced — never headers or body.
    return { status: 0, json: null, text: `${err?.name || 'Error'}: ${err?.cause?.code || err?.message || 'request failed'}`, ms: Date.now() - started };
  }
}

async function main() {
  console.log(`\nSmoke test against ${BASE_URL}\n`);

  // 1. Auth dependency health
  {
    const r = await req('GET', '/api/health/auth');
    record('GET /api/health/auth -> 200', r.status === 200, `got ${r.status} (${r.text.slice(0, 60)})`);
    record('health body is minimal {"status":"ok"}', r.text.trim() === '{"status":"ok"}', r.text.slice(0, 60));
  }

  // 2. Routing reaches Express and validates input
  {
    const r = await req('POST', '/api/auth/login', { body: {} });
    record('POST /api/auth/login (missing email) -> 400', r.status === 400, `got ${r.status}`);
  }

  // 3. Session endpoint rejects anonymous callers
  {
    const r = await req('GET', '/api/auth/me');
    record('GET /api/auth/me (no token) -> 401', r.status === 401, `got ${r.status}`);
  }

  // 4. Representative protected route rejects anonymous callers
  {
    const r = await req('GET', '/api/admin/workspaces');
    record('GET /api/admin/workspaces (no token) -> 401', r.status === 401, `got ${r.status}`);
  }

  // 5. Wrong credentials must be a credential rejection, not an infrastructure error.
  //    A 503 here would mean the backend is unreachable and the deploy is not healthy.
  {
    const r = await req('POST', '/api/auth/login', {
      body: { email: 'smoke-test-nonexistent@example.invalid', password: 'not-a-real-password' }
    });
    record('POST /api/auth/login (bad credentials) -> 401, not 503', r.status === 401, `got ${r.status}`);
  }

  // 6. Optional authenticated flow
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (email && password) {
    const login = await req('POST', '/api/auth/login', { body: { email, password } });
    const token: string | undefined = login.json?.session?.token;
    record('authenticated login -> 200 with session', login.status === 200 && !!token, `got ${login.status}`);

    if (token) {
      const me = await req('GET', '/api/auth/me', { token });
      record('GET /api/auth/me (valid token) -> 200', me.status === 200, `got ${me.status}`);
      record('session carries an active workspace', !!me.json?.session?.activeWorkspace?.id);
      record('session carries an entitlement decision', !!me.json?.session?.entitlement?.accessStatus);
    }
  } else {
    console.log('  SKIP  authenticated checks (set SMOKE_EMAIL and SMOKE_PASSWORD to enable)');
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`  All ${passed} smoke checks passed.\n`);
  } else {
    console.log(`  ${passed} passed, ${failures.length} FAILED:`);
    failures.forEach(f => console.log(`   x ${f}`));
    console.log('');
    process.exitCode = 1;
  }
}

main().catch(err => { console.error(err?.message || err); process.exitCode = 1; });
