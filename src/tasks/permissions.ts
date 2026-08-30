/**
 * Task Management authorization (decisions D6 and D7).
 *
 * Every rule here is enforced server-side. The frontend mirrors these predicates only to
 * decide which controls to render — hiding a button is an affordance, never a boundary.
 */

import { UserRole } from '../types.js';
import { forbidden } from './http.js';

/** Full control over every task-module record in the active workspace. */
const MANAGER_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.WORKSPACE_OWNER,
  UserRole.ADMIN
];

/** May create tasks, and edit only what they created or are assigned to. */
const CONTRIBUTOR_ROLES: UserRole[] = [
  UserRole.SALES_REP,
  UserRole.TEAM_MEMBER
];

export const isManager = (role: UserRole): boolean => MANAGER_ROLES.includes(role);
export const isContributor = (role: UserRole): boolean => CONTRIBUTOR_ROLES.includes(role);
export const isReadOnly = (role: UserRole): boolean => role === UserRole.READ_ONLY;

/** Spaces, Lists and statuses are manager-only (create/rename/reorder/archive/restore). */
export function assertCanManageHierarchy(role: UserRole): void {
  if (!isManager(role)) {
    throw forbidden('Only workspace administrators can manage Spaces, Lists and statuses.');
  }
}

/** Managers and contributors may create tasks and subtasks. READ_ONLY may not. */
export function assertCanCreateTask(role: UserRole): void {
  if (!isManager(role) && !isContributor(role)) {
    throw forbidden('You do not have permission to create tasks.');
  }
}

/**
 * D6 edit scope. A manager may edit any task. A contributor may edit a task only when they
 * created it or are currently assigned to it. READ_ONLY may never edit.
 *
 * `assigneeActorIds` must be the task's CURRENT assignees, read fresh from the database —
 * never taken from the request — otherwise a caller could grant themselves edit rights by
 * claiming to be an assignee.
 */
export function assertCanMutateTask(
  role: UserRole,
  actorId: string,
  task: { created_by: string | null },
  assigneeActorIds: string[]
): void {
  if (isManager(role)) return;
  if (!isContributor(role)) {
    throw forbidden('You do not have permission to modify tasks.');
  }
  const isCreator = task.created_by === actorId;
  const isAssignee = assigneeActorIds.includes(actorId);
  if (!isCreator && !isAssignee) {
    throw forbidden('You can only modify tasks you created or are assigned to.');
  }
}

/**
 * D6 assignment scope. Managers may assign anyone. Contributors may only add or remove
 * THEMSELVES — so the submitted assignee set may differ from the current one by their own
 * actor id alone.
 */
export function assertCanApplyAssignments(
  role: UserRole,
  actorId: string,
  currentAssignees: string[],
  nextAssignees: string[]
): void {
  if (isManager(role)) return;
  if (!isContributor(role)) {
    throw forbidden('You do not have permission to change assignments.');
  }
  const added = nextAssignees.filter(id => !currentAssignees.includes(id));
  const removed = currentAssignees.filter(id => !nextAssignees.includes(id));
  const touchesOthers = [...added, ...removed].some(id => id !== actorId);
  if (touchesOthers) {
    throw forbidden('You can only assign or unassign yourself.');
  }
}

/** Managers may edit/delete anyone's time. Contributors may manage only their own. */
export function assertCanMutateTimeEntry(
  role: UserRole,
  actorId: string,
  entry: { actor_id: string }
): void {
  if (isManager(role)) return;
  if (!isContributor(role)) {
    throw forbidden('You do not have permission to record time.');
  }
  if (entry.actor_id !== actorId) {
    throw forbidden('You can only manage your own time entries.');
  }
}

/** Only managers and contributors may run a timer at all. */
export function assertCanTrackTime(role: UserRole): void {
  if (!isManager(role) && !isContributor(role)) {
    throw forbidden('Your role cannot record time.');
  }
}

/**
 * D7 time visibility.
 *   manager     -> team totals and every individual entry
 *   contributor -> their own entries only
 *   read_only   -> task-level AGGREGATE tracked time only; no per-person rows, identities,
 *                  descriptions or notes are ever returned to them
 */
export type TimeVisibility = 'team' | 'own' | 'aggregate_only';

export function timeVisibilityFor(role: UserRole): TimeVisibility {
  if (isManager(role)) return 'team';
  if (isContributor(role)) return 'own';
  return 'aggregate_only';
}

/** Guards the per-member breakdown so READ_ONLY can never see employee-level detail. */
export function assertCanViewMemberBreakdown(role: UserRole): void {
  if (timeVisibilityFor(role) !== 'team') {
    throw forbidden('Only workspace administrators can view team time totals.');
  }
}

// ── Channels ───────────────────────────────────────────────────────────────────────────

/** Creating, renaming, reordering, archiving and setting membership on a Channel. */
export function assertCanManageChannels(role: UserRole): void {
  if (!isManager(role)) {
    throw forbidden('Only workspace administrators can manage channels.');
  }
}

/** Managers and contributors may post. READ_ONLY may read a channel but never write to it. */
export function assertCanPostMessage(role: UserRole): void {
  if (!isManager(role) && !isContributor(role)) {
    throw forbidden('Your role cannot post messages.');
  }
}

/**
 * Editing a message is an AUTHOR-ONLY right, deliberately not extended to managers.
 *
 * A manager moderating a channel can remove a message (see assertCanDeleteMessage) but can
 * never rewrite one: altering someone's words while they still appear under that person's
 * name is a strictly worse power than removing the message outright, and nothing in this
 * product needs it. The time-bound is applied by the caller, which owns the clock.
 */
export function assertCanEditMessage(
  role: UserRole,
  actorId: string,
  message: { author_actor_id: string }
): void {
  if (message.author_actor_id !== actorId) {
    throw forbidden('You can only edit your own messages.');
  }
  // An author whose role has since been reduced to read-only loses write access entirely.
  assertCanPostMessage(role);
}

/**
 * Soft-deleting a message: the author may remove their own, and a manager may moderate any.
 * There is no hard delete anywhere in this subsystem.
 */
export function assertCanDeleteMessage(
  role: UserRole,
  actorId: string,
  message: { author_actor_id: string }
): void {
  if (isManager(role)) return;
  if (message.author_actor_id !== actorId) {
    throw forbidden('You can only delete your own messages.');
  }
  assertCanPostMessage(role);
}

/**
 * Read access to a channel.
 *
 * A 'workspace' channel is readable by every role, READ_ONLY included. A 'restricted' channel
 * is readable only by an actor with a membership row — except for managers, who administer
 * the workspace and would otherwise be unable to moderate a channel they had not added
 * themselves to. `isMember` must be resolved from the database, never from the request.
 */
export function assertCanReadChannel(
  role: UserRole,
  channel: { visibility: string },
  isMember: boolean
): void {
  if (channel.visibility !== 'restricted') return;
  if (isManager(role)) return;
  if (!isMember) {
    // Deliberately the same message and code whether the channel is missing or merely
    // invisible: distinguishing them would confirm the existence of a channel the caller
    // is not allowed to know about.
    throw forbidden('You do not have access to this channel.');
  }
}
