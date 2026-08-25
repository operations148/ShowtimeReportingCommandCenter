/**
 * Task Management staged-rollout gate.
 *
 * This sits BETWEEN the master feature flag and the entitlement policy. The master flag
 * answers "does this deployment run Task Management at all"; this answers "is THIS workspace
 * allowed to yet". Both must pass before any authorization or data access.
 *
 *   off    — the module is closed. Nothing new may be created, read or changed.
 *   canary — only workspaces named in TASK_MANAGEMENT_CANARY_WORKSPACE_IDS may use it.
 *   all    — every workspace, subject to the normal entitlement and RBAC rules. Reserved
 *            for the approved production release; it is NOT used by the canary.
 *
 * FAILS CLOSED, ALWAYS. A missing, empty, mis-typed or unrecognised mode resolves to `off`.
 * `canary` with an empty or unparseable allowlist admits nobody. There is deliberately no
 * "allow everything if the config looks broken" path, because a typo in an environment
 * variable must never be the thing that exposes an unreleased module to a live tenant.
 *
 * THE WORKSPACE ID IS NEVER TAKEN FROM THE REQUEST. Callers pass req.workspace.id, which
 * requireAuth derived from the session — so a client cannot name its way into the canary.
 *
 * CONTROLLED-SHUTDOWN CARVE-OUT: observing and stopping an ALREADY-RUNNING timer stays
 * permitted even when the workspace is out of rollout. Removing a workspace from the
 * allowlist (or flipping the mode to `off`) must not strand a running timer that would
 * otherwise accrue forever with no way to close it. Neither operation can create data:
 * one is a read of the caller's own timer, the other only sets ended_at on an entry that
 * already exists. Everything else is refused.
 */

import { TaskError } from './http.js';

export type RolloutMode = 'off' | 'canary' | 'all';

const VALID_MODES: RolloutMode[] = ['off', 'canary', 'all'];

/**
 * The configured mode. Anything not exactly one of the three known values — absent, blank,
 * whitespace, "ON", "true", "canary,all", a typo — resolves to `off`.
 */
export function rolloutMode(): RolloutMode {
  const raw = (process.env.TASK_MANAGEMENT_ROLLOUT_MODE ?? '').trim().toLowerCase();
  return (VALID_MODES as string[]).includes(raw) ? (raw as RolloutMode) : 'off';
}

/**
 * The canary allowlist, parsed from a comma-separated list.
 *
 * Entries are trimmed and blanks dropped, so trailing commas and stray whitespace are
 * tolerated rather than silently admitting an empty-string workspace id. Matching is exact
 * and case-sensitive: workspace ids in this system are opaque identifiers, and loosening the
 * comparison would let a near-miss value grant access.
 */
export function canaryWorkspaceIds(): string[] {
  const raw = process.env.TASK_MANAGEMENT_CANARY_WORKSPACE_IDS;
  if (typeof raw !== 'string') return [];
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/** Whether one workspace may use the module right now. Pure, so it is directly testable. */
export function isWorkspaceInRollout(workspaceId: string | null | undefined): boolean {
  const mode = rolloutMode();
  if (mode === 'off') return false;
  if (mode === 'all') return true;

  // canary
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') return false;
  return canaryWorkspaceIds().includes(workspaceId);
}

/**
 * Operations that survive a workspace leaving the rollout, so a running timer is never
 * stranded. Kept as a named set rather than inlined so the carve-out is auditable in one
 * place and cannot quietly grow.
 */
export type RolloutExemptOperation = 'timer.active' | 'timer.stop';

/**
 * Enforces the gate. Throws TaskError(403, TASK_ROLLOUT_EXCLUDED) when the workspace is not
 * in the rollout and the operation is not one of the shutdown carve-outs.
 *
 * The message is deliberately identical whether the mode is `off` or the workspace is merely
 * absent from the allowlist: a tenant has no business learning which other tenants are in a
 * canary, or how the rollout is currently configured.
 */
export function assertWorkspaceInRollout(
  workspaceId: string | null | undefined,
  opts: { exemptOperation?: RolloutExemptOperation } = {}
): void {
  if (isWorkspaceInRollout(workspaceId)) return;
  if (opts.exemptOperation) return;

  throw new TaskError(403, 'TASK_ROLLOUT_EXCLUDED',
    'Task Management is not available for this workspace yet.');
}

/** Operator-facing summary for diagnostics. Contains no secret and no other tenant's data. */
export function rolloutSummary(): { mode: RolloutMode; canaryWorkspaceCount: number } {
  return { mode: rolloutMode(), canaryWorkspaceCount: canaryWorkspaceIds().length };
}
