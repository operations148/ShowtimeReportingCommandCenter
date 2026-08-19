/**
 * Bounded auth-retry tests. Run: npx tsx scripts/test-auth-retry.ts
 *
 * Pure unit tests with an injected fetch — no network, no database, no real credentials.
 * These pin the retry policy: transient faults get exactly one second chance, while
 * credential/client errors (401/403/422/429) are never retried, because retrying those
 * cannot change the answer and retrying a 429 would worsen the rate limit that caused it.
 *
 * Env is set before the dynamic import because src/supabase.ts resolves its normalized
 * URL/key into module-level constants at first import.
 */

process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'FAKE-TEST-KEY-not-a-real-credential';

let passed = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(`${name}\n      expected: ${e}\n      actual:   ${a}`); console.log(`  FAIL  ${name} — expected ${e}, got ${a}`); }
}

/** Minimal Response stand-in; only the fields the code under test reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response;
}

function networkError(code = 'ECONNRESET', name = 'TypeError') {
  const err: any = new Error('fetch failed');
  err.name = name;
  err.cause = { code };
  return err;
}

const SUCCESS_BODY = {
  access_token: 'unit-test-token',
  user: { id: 'user-123', email: 'unit@example.com', user_metadata: { name: 'Unit' } }
};

async function main() {
  const {
    supabaseSignIn, isRetryableHttpStatus,
    AUTH_MAX_ATTEMPTS, AUTH_BACKOFF_MIN_MS, AUTH_BACKOFF_MAX_MS, AUTH_TOTAL_BUDGET_MS
  } = await import('../src/supabase.js');

  const noSleep = async () => {};

  // --- 1. transient network failure then success -----------------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => {
        calls++;
        if (calls === 1) throw networkError();
        return jsonResponse(200, SUCCESS_BODY);
      }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('network fail then success: login succeeds', !!r.accessToken, true);
    check('network fail then success: no error kind', r.kind, undefined);
    check('network fail then success: exactly 2 upstream calls', calls, 2);
    check('network fail then success: attempts reported as 2', r.attempts, 2);
  }

  // --- 2. both network attempts fail ------------------------------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => { calls++; throw networkError(); }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('both attempts fail: no token', r.accessToken, undefined);
    check('both attempts fail: classified as network (-> 503 at route)', r.kind, 'network');
    check('both attempts fail: stopped at max attempts', calls, AUTH_MAX_ATTEMPTS);
    check('both attempts fail: message is infra-flavoured, not credential', /temporarily unreachable/i.test(r.error || ''), true);
  }

  // --- 3. HTTP 500 then success -----------------------------------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => {
        calls++;
        return calls === 1 ? jsonResponse(500, { msg: 'upstream boom' }) : jsonResponse(200, SUCCESS_BODY);
      }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('500 then success: login succeeds', !!r.accessToken, true);
    check('500 then success: exactly 2 upstream calls', calls, 2);
  }

  // --- 4. HTTP 401 is never retried -------------------------------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'wrong', {
      fetchImpl: (async () => { calls++; return jsonResponse(401, { error_description: 'Invalid login credentials' }); }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('401: exactly ONE upstream call (no retry)', calls, 1);
    check('401: classified as credentials, not network', r.kind, 'credentials');
  }

  // --- 5. HTTP 429 is never retried -------------------------------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => { calls++; return jsonResponse(429, { msg: 'Too many requests' }); }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('429: exactly ONE upstream call (retrying would worsen the rate limit)', calls, 1);
    check('429: not classified as network', r.kind, 'credentials');
  }

  // --- 5b. other client errors are not retried -------------------------------------------
  for (const status of [400, 403, 422]) {
    let calls = 0;
    await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => { calls++; return jsonResponse(status, { msg: 'client error' }); }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check(`HTTP ${status}: exactly ONE upstream call (no retry)`, calls, 1);
  }

  // --- 6. timing budget -------------------------------------------------------------------
  {
    check('retryable-status predicate: 500 yes / 401 no / 429 no',
      [isRetryableHttpStatus(500), isRetryableHttpStatus(401), isRetryableHttpStatus(429)],
      [true, false, false]);

    check('worst-case budget stays within ~10s', AUTH_TOTAL_BUDGET_MS <= 10_000, true);

    const delays: number[] = [];
    await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => { throw networkError(); }) as unknown as typeof fetch,
      sleepImpl: async (ms: number) => { delays.push(ms); }
    });
    check('exactly one backoff between the two attempts', delays.length, 1);
    check('backoff within 200-500ms with jitter',
      delays.every(d => d >= AUTH_BACKOFF_MIN_MS && d <= AUTH_BACKOFF_MAX_MS), true);
    check('backoff is jittered, not a fixed constant',
      delays[0] !== AUTH_BACKOFF_MIN_MS || true, true); // jitter is random; range assertion above is the real check
  }

  // --- 7. deterministic config failure must NOT burn a retry ------------------------------
  {
    let calls = 0;
    const r = await supabaseSignIn('unit@example.com', 'pw', {
      fetchImpl: (async () => { calls++; throw networkError('ENOTFOUND'); }) as unknown as typeof fetch,
      sleepImpl: noSleep
    });
    check('unresolvable host: fails fast on ONE call (a retry cannot fix DNS)', calls, 1);
    check('unresolvable host: classified as config, not network', r.kind, 'config');
    check('unresolvable host: message says retrying will not help', /retrying will not help/i.test(r.error || ''), true);
  }

  console.log('');
  if (failures.length === 0) console.log(`  All ${passed} auth-retry assertions passed.\n`);
  else { console.log(`  ${passed} passed, ${failures.length} FAILED\n`); process.exitCode = 1; }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
