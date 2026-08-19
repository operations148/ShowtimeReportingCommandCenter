import { createClient } from '@supabase/supabase-js';

/**
 * Normalizes a raw environment-variable value against the two corruption patterns that have
 * actually occurred in this project's history:
 *   - A UTF-8 byte-order mark (U+FEFF) prefixed onto the value when it was written to Vercel
 *     via a tool that defaults to BOM-emitting UTF-8 (e.g. PowerShell 5.1's
 *     [System.IO.File]::WriteAllText). This turns SUPABASE_URL into an invalid URL, which
 *     surfaced historically as a silent 30s timeout (see commit f39a00f).
 *   - Accidental wrapping quotes and/or leading/trailing whitespace from manual copy-paste
 *     into a dashboard or .env file.
 * Order matters: quotes are stripped only after the outer BOM/whitespace are gone, then BOM
 * and whitespace are stripped again in case the quotes had wrapped a still-corrupted inner
 * value (e.g. `"﻿https://..."`).
 */
export function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  let v = raw;
  v = v.replace(/^﻿/, '').trim();
  const quoted = /^"(.*)"$/.exec(v) || /^'(.*)'$/.exec(v);
  if (quoted) v = quoted[1];
  v = v.replace(/^﻿/, '').trim();
  return v;
}

/** Strips exactly one trailing slash so callers can safely template `${url}/auth/v1/...`. */
function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

const supabaseUrl = stripTrailingSlash(normalizeEnvValue(process.env.SUPABASE_URL));
const supabaseServiceKey = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

// Warn rather than throw at module level — module-level throws cause
// FUNCTION_INVOCATION_FAILED on Vercel before any request handler runs,
// giving no diagnostic information. Actual failures surface per-request instead.
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[Supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
} else {
  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:') {
      console.error(`[Supabase] SUPABASE_URL uses protocol "${parsed.protocol}" — expected https: in production.`);
    }
  } catch {
    console.error('[Supabase] SUPABASE_URL does not parse as a valid URL after normalization.');
  }
}

/**
 * createClient() throws on a malformed URL. At module scope that throw is fatal: the
 * function dies with FUNCTION_INVOCATION_FAILED before any route — including the health
 * endpoint — can run, and the platform returns a plain-text error page that clients parsing
 * JSON choke on. Guarding on truthiness alone is not enough, because the corruption pattern
 * seen in this project (a BOM-prefixed URL) is non-empty *and* malformed. Fall back to an
 * unreachable placeholder so the process boots and every request instead receives a
 * structured, diagnosable error.
 */
const supabaseUrlIsUsable = (() => {
  if (!supabaseUrl) return false;
  try {
    const p = new URL(supabaseUrl);
    return p.protocol === 'http:' || p.protocol === 'https:';
  } catch { return false; }
})();

// Server-side only — service role key bypasses RLS, never expose to client.
// IMPORTANT: never call .auth.signInWithPassword() on this client — doing so
// mutates its internal session, causing all subsequent .from() queries to use
// the user JWT instead of the service role key (403 on RLS-protected tables).
export const supabaseAdmin = createClient(
  supabaseUrlIsUsable ? supabaseUrl : 'https://placeholder.supabase.co',
  supabaseServiceKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  }
);

// Export URL and key so auth routes can call Supabase Auth REST directly,
// which never mutates supabaseAdmin's session state.
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_SERVICE_KEY = supabaseServiceKey;

/**
 * Classifies a thrown fetch error against the Supabase host.
 *
 * The distinction that matters operationally: a DNS failure means the configured host does
 * not exist at all — a dead or renamed project, or a bad SUPABASE_URL. That is a
 * configuration incident requiring new credentials, not a blip to retry. Everything else
 * (resets, timeouts, refused connections) is transient. Reporting both as a generic
 * "fetch failed" has repeatedly cost hours of misdirected investigation.
 */
export function classifyFetchError(err: any): { kind: 'config' | 'network'; detail: string; code: string; errorName: string } {
  const code = err?.cause?.code || err?.code || '';
  const errorName = err?.name || '';
  const msg = String(err?.message || '');

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /ENOTFOUND|getaddrinfo/i.test(msg)) {
    return {
      kind: 'config',
      code: code || 'ENOTFOUND',
      errorName,
      detail: `the configured Supabase host (${supabaseHost || 'unset'}) does not resolve — the project may have been deleted, renamed, or SUPABASE_URL is wrong`
    };
  }
  if (errorName === 'TimeoutError' || code === 'ETIMEDOUT') {
    // Derived from the constant rather than hardcoded — the per-attempt timeout was reduced
    // from 10s to 4.5s when retry was added, and a stale literal here would misreport it.
    return { kind: 'network', code: code || 'ETIMEDOUT', errorName, detail: `the request timed out after ${AUTH_ATTEMPT_TIMEOUT_MS / 1000}s` };
  }
  if (code === 'ECONNREFUSED') return { kind: 'network', code, errorName, detail: 'the connection was refused' };
  if (code === 'ECONNRESET') return { kind: 'network', code, errorName, detail: 'the connection was reset' };
  return { kind: 'network', code: code || 'UNKNOWN', errorName, detail: msg || 'unknown network error' };
}

/** Hostname only — safe to surface in errors and logs; contains no secret. */
const supabaseHost = (() => {
  try { return supabaseUrl ? new URL(supabaseUrl).host : ''; } catch { return ''; }
})();

/**
 * Server-side-only diagnostic snapshot of current config health, for logging around a
 * failure. Deliberately excludes both env values entirely — length and BOM/whitespace/quote
 * detection run against the RAW (pre-normalization) process.env reads, so a corrupted value
 * is visible in logs even though normalizeEnvValue() has already cleaned the value actually
 * in use.
 */
export function safeConfigDiagnostics(): Record<string, unknown> {
  const rawUrl = process.env.SUPABASE_URL || '';
  const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const rawFlags = (raw: string) => ({
    present: raw.length > 0,
    length: raw.length,
    hadLeadingBom: raw.charCodeAt(0) === 0xFEFF,
    hadSurroundingWhitespace: raw !== raw.trim(),
    hadWrappingQuotes: /^"(.*)"$/.test(raw) || /^'(.*)'$/.test(raw)
  });
  return {
    supabaseHost,
    normalizedUrlParses: (() => { try { return !!supabaseUrl && !!new URL(supabaseUrl); } catch { return false; } })(),
    rawUrl: rawFlags(rawUrl),
    rawKey: rawFlags(rawKey)
  };
}

// ── Bounded retry policy ──────────────────────────────────────────────────────────────
//
// Budget arithmetic matters here: Vercel kills the function at 30s, and two naive 10s
// attempts plus backoff would leave almost no headroom for the rest of the login handler
// (profile lookup, workspace resolution, audit write). Sizing each attempt at 4.5s keeps
// the worst case at 4500 + 500 + 4500 = 9500ms, comfortably inside a ~10s budget.
export const AUTH_ATTEMPT_TIMEOUT_MS = 4_500;
export const AUTH_MAX_ATTEMPTS = 2;
export const AUTH_BACKOFF_MIN_MS = 200;
export const AUTH_BACKOFF_MAX_MS = 500;
/** Worst-case wall time for the whole retried operation. Asserted in tests. */
export const AUTH_TOTAL_BUDGET_MS =
  AUTH_MAX_ATTEMPTS * AUTH_ATTEMPT_TIMEOUT_MS + (AUTH_MAX_ATTEMPTS - 1) * AUTH_BACKOFF_MAX_MS;

/** Injection points for tests — production always uses the real implementations. */
export interface AuthRequestDeps {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Only 5xx is retryable. A 4xx from GoTrue is a definitive answer about the request itself
 * (bad password, malformed body, rate limited) — retrying cannot change it, and retrying a
 * 429 in particular would actively worsen the rate limit that produced it.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

/** Safe, non-identifying deployment context. All of these are Vercel system values. */
function deploymentContext(): Record<string, unknown> {
  return {
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    region: process.env.VERCEL_REGION || undefined,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || undefined,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || undefined
  };
}

/**
 * The single structured event to alert on. Emitted only when authentication infrastructure
 * has definitively failed after exhausting retries — never when a retry recovered, and never
 * for a rejected password. Contains no credential, email, token, key, or raw env value.
 */
export function logAuthUpstreamUnavailable(params: {
  route: string;
  attempts: number;
  kind: string;
  code: string;
  errorName?: string;
  timedOut: boolean;
}): void {
  console.error(JSON.stringify({
    event: 'AUTH_UPSTREAM_UNAVAILABLE',
    timestamp: new Date().toISOString(),
    route: params.route,
    attempts: params.attempts,
    classification: params.kind,
    causeCode: params.code,
    errorName: params.errorName || undefined,
    timedOut: params.timedOut,
    ...deploymentContext()
  }));
}

interface AuthAttemptFailure {
  kind: 'config' | 'network';
  detail: string;
  code: string;
  errorName: string;
  timedOut: boolean;
}

/**
 * Performs a Supabase Auth request with one bounded retry.
 *
 * Retries only a thrown transport error or an HTTP 5xx, and at most once. Every other
 * outcome — including 400/401/403/422/429 — is returned immediately and untouched, so the
 * caller's ability to distinguish "wrong password" from "backend down" is preserved exactly.
 */
async function requestAuthWithRetry(
  url: string,
  init: RequestInit,
  route: string,
  deps: AuthRequestDeps = {}
): Promise<{ response?: Response; failure?: AuthAttemptFailure; attempts: number }> {
  const doFetch = deps.fetchImpl || fetch;
  const sleep = deps.sleepImpl || defaultSleep;
  let lastFailure: AuthAttemptFailure | undefined;

  for (let attempt = 1; attempt <= AUTH_MAX_ATTEMPTS; attempt++) {
    const isFinal = attempt === AUTH_MAX_ATTEMPTS;
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(AUTH_ATTEMPT_TIMEOUT_MS) });

      if (isRetryableHttpStatus(response.status) && !isFinal) {
        console.warn(`[auth] ${route}: upstream returned ${response.status}, retrying once`, { attempt });
        await sleep(AUTH_BACKOFF_MIN_MS + Math.random() * (AUTH_BACKOFF_MAX_MS - AUTH_BACKOFF_MIN_MS));
        continue;
      }
      if (attempt > 1) {
        console.warn(`[auth] ${route}: recovered on attempt ${attempt}`, { status: response.status });
      }
      return { response, attempts: attempt };
    } catch (err: any) {
      const { kind, detail, code, errorName } = classifyFetchError(err);
      lastFailure = { kind, detail, code, errorName, timedOut: errorName === 'TimeoutError' || code === 'ETIMEDOUT' };

      // A config-class failure (host does not resolve) is deterministic — a second attempt
      // 200ms later cannot succeed, so fail fast rather than burning the budget.
      if (kind === 'config' || isFinal) {
        return { failure: lastFailure, attempts: attempt };
      }
      console.warn(`[auth] ${route}: attempt ${attempt} failed (${code || errorName || 'network'}), retrying once`);
      await sleep(AUTH_BACKOFF_MIN_MS + Math.random() * (AUTH_BACKOFF_MAX_MS - AUTH_BACKOFF_MIN_MS));
    }
  }

  return { failure: lastFailure, attempts: AUTH_MAX_ATTEMPTS };
}

/**
 * Signs in a user via the Supabase Auth REST API directly.
 * NEVER use supabaseAdmin.auth.signInWithPassword() — it taints the singleton.
 */
export async function supabaseSignIn(email: string, password: string, deps: AuthRequestDeps = {}): Promise<{
  accessToken?: string;
  userId?: string;
  userMetadata?: Record<string, any>;
  email?: string;
  error?: string;
  /** Distinguishes a rejected password from a broken server, so callers can
   *  return 503 instead of a misleading 401. */
  kind?: 'config' | 'network' | 'credentials';
  /** Upstream attempts made. Exposed for tests/telemetry; never sent to the client. */
  attempts?: number;
}> {
  // Without a base URL the template below yields a relative path, which Node's
  // fetch rejects. Unhandled, that rejection hangs the request until the
  // platform's function timeout kills it — a 504 with no diagnostic.
  if (!supabaseUrl || !supabaseServiceKey) {
    return {
      kind: 'config',
      error: 'Server misconfigured: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.'
    };
  }
  // Present but malformed is a distinct failure from absent, and must not reach fetch()
  // where it would surface as an ambiguous transport error.
  if (!supabaseUrlIsUsable) {
    console.error('[supabaseSignIn] SUPABASE_URL is present but malformed', safeConfigDiagnostics());
    return {
      kind: 'config',
      error: 'Server misconfigured: SUPABASE_URL is not a valid URL. This needs an administrator — retrying will not help.'
    };
  }

  const { response: res, failure, attempts } = await requestAuthWithRetry(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey
      },
      body: JSON.stringify({ email, password })
    },
    '/api/auth/login',
    deps
  );

  if (failure) {
    // Full safe diagnostic server-side only — never returned to the client, never contains
    // either secret value. This is the difference between "fetch failed" (uninformative,
    // identical for every distinct cause) and being able to tell a dead project apart from
    // a transient blip after the fact from logs alone.
    console.error('[supabaseSignIn] auth request failed', {
      kind: failure.kind, code: failure.code, errorName: failure.errorName, detail: failure.detail, attempts,
      ...safeConfigDiagnostics()
    });
    logAuthUpstreamUnavailable({
      route: '/api/auth/login', attempts,
      kind: failure.kind, code: failure.code, errorName: failure.errorName, timedOut: failure.timedOut
    });
    return {
      kind: failure.kind,
      attempts,
      error: failure.kind === 'config'
        ? `Sign-in is unavailable: ${failure.detail}. This needs an administrator — retrying will not help.`
        : `Authentication service temporarily unreachable (${failure.detail}). Please try again.`
    };
  }

  if (!res!.ok) {
    const err = await res!.json().catch(() => ({}));
    // 4xx from GoTrue is a genuine credential rejection; 5xx is the service failing.
    const kind = res!.status >= 500 ? 'network' : 'credentials';
    if (kind === 'network') {
      // Retries were already exhausted upstream; this is a definitive infrastructure failure.
      logAuthUpstreamUnavailable({
        route: '/api/auth/login', attempts, kind, code: `HTTP_${res!.status}`, timedOut: false
      });
    }
    return { kind, attempts, error: err.error_description || err.msg || `Auth failed (HTTP ${res!.status})` };
  }
  const data = await res!.json();
  return {
    accessToken: data.access_token,
    userId: data.user?.id,
    userMetadata: data.user?.user_metadata ?? {},
    email: data.user?.email,
    attempts
  };
}

// ── Auth reachability probe (backs GET /api/health/auth) ──────────────────────────────

/** Cached probe result. Serverless containers persist between invocations, so this bounds
 *  upstream traffic if the endpoint is polled aggressively or abused. */
let healthCache: { at: number; healthy: boolean; reason: string } | null = null;
const HEALTH_CACHE_TTL_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3_000;

export function __resetAuthHealthCache(): void { healthCache = null; }

/**
 * Checks that Supabase Auth is configured and reachable, without authenticating anyone.
 *
 * Deliberately sends NO service-role key: GoTrue's /auth/v1/health answers unauthenticated
 * requests with an HTTP response (401 "No API key found"), and *any* HTTP response proves
 * DNS + TLS + transport + the service being up, which is the entire question. Only a thrown
 * error means unreachable. This keeps the probe from putting a privileged credential on the
 * wire for a public endpoint.
 */
export async function checkAuthReachability(
  deps: AuthRequestDeps & { now?: () => number } = {}
): Promise<{ healthy: boolean; reason: string; cached: boolean; diagnostics: Record<string, unknown> }> {
  const now = deps.now || Date.now;
  const doFetch = deps.fetchImpl || fetch;

  if (healthCache && now() - healthCache.at < HEALTH_CACHE_TTL_MS) {
    return { healthy: healthCache.healthy, reason: healthCache.reason, cached: true, diagnostics: {} };
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    const reason = 'config_missing';
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: safeConfigDiagnostics() };
  }
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    const reason = 'config_invalid_url';
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: safeConfigDiagnostics() };
  }
  if (parsed.protocol !== 'https:') {
    const reason = 'config_insecure_protocol';
    healthCache = { at: now(), healthy: false, reason };
    return { healthy: false, reason, cached: false, diagnostics: { ...safeConfigDiagnostics(), protocol: parsed.protocol } };
  }

  try {
    const res = await doFetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
    });
    // Any HTTP status proves reachability. A 5xx means the service itself is failing.
    const healthy = !isRetryableHttpStatus(res.status);
    const reason = healthy ? 'reachable' : `upstream_${res.status}`;
    healthCache = { at: now(), healthy, reason };
    return { healthy, reason, cached: false, diagnostics: { upstreamStatus: res.status } };
  } catch (err: any) {
    const { kind, detail, code, errorName } = classifyFetchError(err);
    const reason = kind === 'config' ? 'host_unresolvable' : 'unreachable';
    healthCache = { at: now(), healthy: false, reason };
    return {
      healthy: false, reason, cached: false,
      diagnostics: { kind, code, errorName, detail, timedOut: errorName === 'TimeoutError' || code === 'ETIMEDOUT' }
    };
  }
}
