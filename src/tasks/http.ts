/**
 * Shared HTTP contract for the Task Management module.
 *
 * Every response is JSON, carries a stable machine-readable `code`, and never leaks internal
 * detail: no principal external ids, no Supabase ids, no service-role values, no tokens, no
 * raw driver errors, no stack traces. Postgres errors are mapped to safe codes here and the
 * original is logged server-side only.
 */

/** Machine-readable error codes. Clients branch on these, never on message text. */
export type TaskErrorCode =
  | 'TASK_MODULE_DISABLED'
  /** The deployment runs the module, but this workspace is not in the current rollout. */
  | 'TASK_ROLLOUT_EXCLUDED'
  | 'TASK_TIME_TRACKING_DISABLED'
  | 'TASK_ACTOR_UNRESOLVED'
  | 'TASK_ENTITLEMENT_EXPIRED'
  | 'TASK_WORKSPACE_SUSPENDED'
  | 'TASK_FORBIDDEN'
  | 'TASK_NOT_FOUND'
  | 'TASK_VALIDATION_FAILED'
  | 'TASK_VERSION_CONFLICT'
  | 'TASK_TIMER_CONFLICT'
  | 'TASK_NO_ACTIVE_TIMER'
  | 'TASK_INTERNAL_ERROR';

/**
 * Task responses must never be cached — by the browser, a CDN, or the service worker.
 * A stale task list is confusing; a stale ACTIVE TIMER is actively wrong, because it would
 * show a timer that has already been stopped (or hide one that is still running).
 */
export function applyNoStore(res: any): void {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

export function ok(res: any, data: unknown, extra: Record<string, unknown> = {}): void {
  applyNoStore(res);
  res.status(200).json({ status: 'success', data, ...extra });
}

export function fail(
  res: any,
  httpStatus: number,
  code: TaskErrorCode,
  message: string,
  extra: Record<string, unknown> = {}
): void {
  applyNoStore(res);
  res.status(httpStatus).json({ status: 'error', code, error: message, ...extra });
}

/** Thrown by handlers to short-circuit with a specific contract response. */
export class TaskError extends Error {
  constructor(
    public httpStatus: number,
    public code: TaskErrorCode,
    message: string,
    public extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'TaskError';
  }
}

export const notFound = (what = 'Resource') =>
  new TaskError(404, 'TASK_NOT_FOUND', `${what} not found.`);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new TaskError(403, 'TASK_FORBIDDEN', message);
export const invalid = (message: string, extra: Record<string, unknown> = {}) =>
  new TaskError(422, 'TASK_VALIDATION_FAILED', message, extra);
export const versionConflict = () =>
  new TaskError(409, 'TASK_VERSION_CONFLICT',
    'This record was modified by someone else. Reload and try again.');

/**
 * Wraps an async handler so thrown TaskErrors become contract responses and anything else
 * becomes a generic 500 — with the real error logged server-side only.
 */
export function handler(fn: (req: any, res: any) => Promise<void>) {
  return async (req: any, res: any) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      if (err instanceof TaskError) {
        return fail(res, err.httpStatus, err.code, err.message, err.extra);
      }
      // Map the few Postgres signals the RPCs raise deliberately.
      const raw = String(err?.message || '');
      if (raw.includes('TASK_NOT_FOUND')) {
        return fail(res, 404, 'TASK_NOT_FOUND', 'Task not found.');
      }
      if (raw.includes('NO_ACTIVE_TIMER')) {
        return fail(res, 404, 'TASK_NO_ACTIVE_TIMER', 'No running timer to stop.');
      }
      console.error('[tasks] unhandled error', {
        route: req?.originalUrl, method: req?.method, message: raw
      });
      return fail(res, 500, 'TASK_INTERNAL_ERROR', 'An unexpected error occurred.');
    }
  };
}

/** Maps a supabase-js error object to a safe TaskError. Never returns the raw message. */
export function mapDbError(error: any, context: string): TaskError {
  const code = error?.code || '';
  // 23503 foreign_key_violation -> caller referenced something outside its workspace,
  // or a parent that does not exist. Both are "not found" from the caller's perspective;
  // saying "wrong workspace" would confirm the existence of another tenant's record.
  if (code === '23503') return new TaskError(404, 'TASK_NOT_FOUND', 'Referenced record not found.');
  if (code === '23505') return new TaskError(409, 'TASK_VERSION_CONFLICT', 'That record already exists.');
  if (code === '23514') return new TaskError(422, 'TASK_VALIDATION_FAILED', 'A field failed validation.');
  console.error(`[tasks] db error (${context})`, { code, message: error?.message });
  return new TaskError(500, 'TASK_INTERNAL_ERROR', 'An unexpected error occurred.');
}
