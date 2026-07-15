import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Warn rather than throw at module level — module-level throws cause
// FUNCTION_INVOCATION_FAILED on Vercel before any request handler runs,
// giving no diagnostic information. Actual failures surface per-request instead.
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[Supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

// Server-side only — service role key bypasses RLS, never expose to client.
// IMPORTANT: never call .auth.signInWithPassword() on this client — doing so
// mutates its internal session, causing all subsequent .from() queries to use
// the user JWT instead of the service role key (403 on RLS-protected tables).
export const supabaseAdmin = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
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
 * Signs in a user via the Supabase Auth REST API directly.
 * NEVER use supabaseAdmin.auth.signInWithPassword() — it taints the singleton.
 */
export async function supabaseSignIn(email: string, password: string): Promise<{
  accessToken?: string;
  userId?: string;
  userMetadata?: Record<string, any>;
  email?: string;
  error?: string;
  /** Distinguishes a rejected password from a broken server, so callers can
   *  return 503 instead of a misleading 401. */
  kind?: 'config' | 'network' | 'credentials';
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

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseServiceKey
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000)
    });
  } catch (err: any) {
    const reason = err?.name === 'TimeoutError'
      ? 'timed out after 10s'
      : (err?.message || 'unknown error');
    return { kind: 'network', error: `Authentication service unreachable (${reason}).` };
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 4xx from GoTrue is a genuine credential rejection; 5xx is the service failing.
    const kind = res.status >= 500 ? 'network' : 'credentials';
    return { kind, error: err.error_description || err.msg || `Auth failed (HTTP ${res.status})` };
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    userId: data.user?.id,
    userMetadata: data.user?.user_metadata ?? {},
    email: data.user?.email
  };
}
