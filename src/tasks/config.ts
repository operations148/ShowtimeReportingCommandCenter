/**
 * Task Management feature flags.
 *
 * BOTH DEFAULT TO DISABLED. The module is inert unless an operator explicitly opts in, so
 * merging or deploying this code cannot expose the feature in Production by accident.
 *
 * These are enforced on the SERVER, in the router, before any authorization or data access.
 * A later client-side visibility flag is a UX affordance only and is explicitly NOT a
 * security boundary — hiding a nav item does not stop anyone calling the API directly.
 */

/** Parses a boolean env var. Anything other than an explicit truthy string is false. */
function envFlag(name: string): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

/** Master switch. When false, every /api/tasks/* route refuses before touching the database. */
export function isTaskManagementEnabled(): boolean {
  return envFlag('TASK_MANAGEMENT_ENABLED');
}

/**
 * Sub-switch for the time engine. Time tracking can be disabled independently so the task
 * hierarchy can be piloted without timers. Implies nothing when the master switch is off.
 */
export function isTaskTimeTrackingEnabled(): boolean {
  return isTaskManagementEnabled() && envFlag('TASK_TIME_TRACKING_ENABLED');
}

/**
 * Sub-switch for the Channels messaging subsystem, independent of time tracking so messaging
 * can be piloted (or withdrawn) without touching the task hierarchy. Fail-closed like the
 * others: merging or deploying this code cannot expose Channels in Production by accident.
 */
export function isTaskChannelsEnabled(): boolean {
  return isTaskManagementEnabled() && envFlag('TASK_CHANNELS_ENABLED');
}

/**
 * Issuer for Supabase-sourced principals — pins WHICH Supabase project vouched for a user
 * id, so ids from a different project (e.g. after a project migration) are never treated as
 * the same person. Derived from the host only; contains no secret.
 */
export function supabaseIssuer(): string {
  const raw = (process.env.SUPABASE_URL ?? '').trim();
  try {
    return raw ? new URL(raw).host : 'supabase.unknown';
  } catch {
    return 'supabase.unknown';
  }
}

/** Issuer for GHL SSO principals — identifies the GHL app/company that signed the payload. */
export function ghlIssuer(): string {
  const company = (process.env.GHL_COMPANY_ID ?? '').trim();
  return company ? `gohighlevel:${company}` : 'gohighlevel';
}

/** Bounded pagination. Callers may not exceed MAX_PAGE_SIZE regardless of what they ask for. */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
