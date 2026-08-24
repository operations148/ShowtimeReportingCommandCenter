/**
 * Task Management entitlement policy (decision D4).
 *
 * The module needs softer behaviour than the rest of the API. Elsewhere, an expired tenant
 * is refused outright. Here that would be harmful: a user with a RUNNING TIMER at the moment
 * their trial lapses could never stop it, and the entry would accrue forever. So:
 *
 *   SUSPENDED (or licence revoked) -> everything blocked, including reads. Unchanged posture.
 *   EXPIRED / NOT_STARTED          -> reads allowed; stopping a running timer allowed;
 *                                     every other mutation refused.
 *   ACTIVE / LICENSED              -> normal.
 *   SUPER_ADMIN                    -> retains existing recovery access throughout.
 *
 * This policy lives ONLY in the task module. All non-task routes keep their current
 * behaviour exactly, because requireAuth still defaults to entitlementMode 'enforce'.
 */

import { UserRole } from '../types.js';
import { TaskError } from './http.js';
import { supabaseAdmin } from '../supabase.js';

/** What a request is trying to do, for entitlement purposes. */
export type TaskOperation = 'read' | 'timer.stop' | 'mutate';

export interface EntitlementLike {
  accessStatus: string;
  hasAccess: boolean;
  denialReason?: string | null;
}

/**
 * Applies the policy. Throws a TaskError when the operation is not permitted.
 */
export function assertTaskEntitlement(
  entitlement: EntitlementLike | null | undefined,
  role: UserRole,
  operation: TaskOperation
): void {
  // Platform staff keep the recovery access they have everywhere else.
  if (role === UserRole.SUPER_ADMIN) return;

  // Missing entitlement data is treated as unusable rather than assumed good.
  if (!entitlement) {
    throw new TaskError(403, 'TASK_ENTITLEMENT_EXPIRED',
      'This workspace does not currently have access to Task Management.');
  }

  // A suspended or revoked workspace is fully closed — reads included.
  if (entitlement.accessStatus === 'SUSPENDED') {
    throw new TaskError(403, 'TASK_WORKSPACE_SUSPENDED',
      entitlement.denialReason || 'This workspace has been suspended.',
      { accessDenied: true, suspended: true });
  }

  if (entitlement.hasAccess) return;

  // Expired / never-started: read-only, plus the ability to stop a timer already running.
  if (operation === 'read' || operation === 'timer.stop') return;

  throw new TaskError(403, 'TASK_ENTITLEMENT_EXPIRED',
    entitlement.denialReason ||
    'Your trial has ended. Task data remains readable, but changes require full access.',
    { accessDenied: true });
}

/**
 * Closes any running timers for a workspace at an authoritative database cutoff.
 *
 * Called when a workspace loses access — lazily on the first task request after expiry, and
 * eagerly when an administrator suspends or revokes a workspace. Idempotent: it only touches
 * entries whose ended_at is still null, so repeated calls are harmless.
 *
 * Failures are logged and swallowed: this is a cleanup side effect and must never turn a
 * legitimate read into an error for the user.
 */
export async function closeActiveTimersForWorkspace(
  workspaceId: string,
  reason: string
): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin.rpc('task_close_active_timers', {
      p_workspace_id: workspaceId,
      p_reason: reason
    });
    if (error) {
      console.error('[tasks] failed to close active timers', {
        workspaceId, reason, code: error.code
      });
      return 0;
    }
    const closed = typeof data === 'number' ? data : 0;
    if (closed > 0) {
      console.warn('[tasks] auto-closed running timers', { workspaceId, reason, closed });
    }
    return closed;
  } catch (err: any) {
    console.error('[tasks] closeActiveTimersForWorkspace threw', {
      workspaceId, reason, message: err?.message
    });
    return 0;
  }
}
