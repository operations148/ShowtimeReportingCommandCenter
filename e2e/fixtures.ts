/**
 * TEST-ONLY deterministic fixtures for browser QA.
 *
 * Nothing here is real: no production credentials, no real workspace ids, no live data.
 * This file lives under e2e/ which is excluded from the production build — Vite only bundles
 * what is reachable from src/, so none of this can ship.
 *
 * Every /api/** call in a browser test is intercepted and answered from here, so no browser
 * test can ever reach the production Task API.
 */

export const FAKE_TOKEN = 'e2e-fake-session-token-not-a-real-credential';

export type Role = 'SUPER_ADMIN' | 'WORKSPACE_OWNER' | 'ADMIN' | 'SALES_REP' | 'TEAM_MEMBER' | 'READ_ONLY';

export const ACTOR_ME = '11111111-1111-4111-8111-111111111111';
export const ACTOR_OTHER = '22222222-2222-4222-8222-222222222222';

export const SPACE_A = '33333333-3333-4333-8333-333333333333';
export const SPACE_B = '33333333-3333-4333-8333-333333333334';
export const LIST_A = '44444444-4444-4444-8444-444444444444';
export const LIST_B = '44444444-4444-4444-8444-444444444445';
export const LIST_C = '44444444-4444-4444-8444-444444444446';
export const LIST_D = '44444444-4444-4444-8444-444444444447';
export const LIST_E = '44444444-4444-4444-8444-444444444448';

export const STATUS_TODO = '55555555-5555-4555-8555-555555555551';
export const STATUS_DOING = '55555555-5555-4555-8555-555555555552';
export const STATUS_DONE = '55555555-5555-4555-8555-555555555553';

export const TASK_1 = '66666666-6666-4666-8666-666666666661';
export const TASK_2 = '66666666-6666-4666-8666-666666666662';
export const TASK_MINE = '66666666-6666-4666-8666-666666666663';
export const SUBTASK_1 = '77777777-7777-4777-8777-777777777771';

export const FOLDER_1 = '88888888-8888-4888-8888-888888888881';
export const FOLDER_EMPTY = '88888888-8888-4888-8888-888888888882';
export const FOLDER_ARCHIVED = '88888888-8888-4888-8888-888888888883';

export const spaces = [
  { id: SPACE_A, name: 'Delivery', position: 1000, version: 1, archived_at: null },
  // A second Space, with its own default List, so "multiple Spaces" scenarios don't hit the
  // unrelated pre-existing edge case of a Space with zero Lists (loadTasks omits listId
  // entirely when null, which is a Task Management concern that predates Folders).
  { id: SPACE_B, name: 'Marketing Ops', position: 2000, version: 1, archived_at: null }
];

export const folders = [
  // Matches the target hierarchy's own example naming, so a test reading "Operations HQ"
  // maps directly onto the PROMPT's own worked example.
  { id: FOLDER_1, space_id: SPACE_A, name: 'Operations HQ', description: null, position: 1000, version: 1, archived_at: null },
  { id: FOLDER_EMPTY, space_id: SPACE_A, name: 'Empty Folder', description: null, position: 2000, version: 1, archived_at: null },
  { id: FOLDER_ARCHIVED, space_id: SPACE_A, name: 'Retired Folder', description: null, position: 3000, version: 1, archived_at: '2026-07-01T00:00:00.000Z' }
];

export const lists = [
  { id: LIST_A, space_id: SPACE_A, folder_id: null, name: 'General', position: 1000, is_default: true, version: 1, archived_at: null },
  { id: LIST_B, space_id: SPACE_A, folder_id: null, name: 'Backlog', position: 2000, is_default: false, version: 1, archived_at: null },
  { id: LIST_C, space_id: SPACE_A, folder_id: FOLDER_1, name: 'Ann - GHL', position: 1000, is_default: false, version: 1, archived_at: null },
  { id: LIST_D, space_id: SPACE_A, folder_id: FOLDER_1, name: 'Rome - Ads', position: 2000, is_default: false, version: 1, archived_at: null },
  { id: LIST_E, space_id: SPACE_B, folder_id: null, name: 'General', position: 1000, is_default: true, version: 1, archived_at: null }
];

export const statuses = [
  { id: STATUS_TODO, space_id: SPACE_A, name: 'To Do', category: 'todo', color: '#94A3B8', position: 1000, is_default: true, version: 1, archived_at: null },
  { id: STATUS_DOING, space_id: SPACE_A, name: 'In Progress', category: 'in_progress', color: '#2563EB', position: 2000, is_default: false, version: 1, archived_at: null },
  { id: STATUS_DONE, space_id: SPACE_A, name: 'Done', category: 'done', color: '#059669', position: 3000, is_default: false, version: 1, archived_at: null }
];

/**
 * The seven Operations Status Template statuses, as a Space that has already had the template
 * applied. Ids are stable so a test can address a specific group.
 *
 * Deliberately a SEPARATE fixture rather than a replacement for `statuses` above: the default
 * three-status Space is what every pre-existing test is written against, and the template is
 * an opt-in operation, never something a Space acquires implicitly.
 */
export const OPS_STATUS_IDS = {
  todo: '5a555555-5555-4555-8555-555555555551',
  inProgress: '5a555555-5555-4555-8555-555555555552',
  waiting: '5a555555-5555-4555-8555-555555555553',
  review: '5a555555-5555-4555-8555-555555555554',
  done: '5a555555-5555-4555-8555-555555555555',
  blocked: '5a555555-5555-4555-8555-555555555556',
  toSchedule: '5a555555-5555-4555-8555-555555555557'
};

export const operationsStatuses = [
  { id: OPS_STATUS_IDS.todo, space_id: SPACE_A, name: 'TO DO', category: 'todo', color: '#94A3B8', position: 1000, is_default: true, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.inProgress, space_id: SPACE_A, name: 'IN PROGRESS', category: 'in_progress', color: '#2563EB', position: 2000, is_default: false, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.waiting, space_id: SPACE_A, name: 'WAITING', category: 'in_progress', color: '#D97706', position: 3000, is_default: false, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.review, space_id: SPACE_A, name: 'REVIEW', category: 'in_progress', color: '#7C3AED', position: 4000, is_default: false, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.done, space_id: SPACE_A, name: 'DONE', category: 'done', color: '#059669', position: 5000, is_default: false, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.blocked, space_id: SPACE_A, name: 'BLOCKED', category: 'in_progress', color: '#DC2626', position: 6000, is_default: false, version: 1, archived_at: null },
  { id: OPS_STATUS_IDS.toSchedule, space_id: SPACE_A, name: 'TO SCHEDULE', category: 'todo', color: '#0891B2', position: 7000, is_default: false, version: 1, archived_at: null }
];

export const actors = [
  { actorId: ACTOR_ME, displayName: 'Dana Tester', email: 'dana@example.test', archived: false, isSelf: true },
  { actorId: ACTOR_OTHER, displayName: 'Sam Colleague', email: 'sam@example.test', archived: false, isSelf: false }
];

function task(over: Partial<any> = {}) {
  return {
    id: TASK_1, list_id: LIST_A, status_id: STATUS_TODO, parent_task_id: null,
    title: 'Prepare pool inspection report', description: 'Compile Q3 findings.',
    priority: 'high', start_date: null, due_date: '2026-09-01T00:00:00.000Z',
    time_estimate_seconds: 7200, position: 1000, version: 1, archived_at: null,
    created_by: ACTOR_OTHER, updated_by: ACTOR_OTHER,
    created_at: '2026-08-01T10:00:00.000Z', updated_at: '2026-08-01T10:00:00.000Z',
    assigneeActorIds: [ACTOR_OTHER], subtaskCount: 1,
    ...over
  };
}

export const tasks = [
  task(),
  task({ id: TASK_2, title: 'Schedule filter replacement', status_id: STATUS_DOING,
         priority: 'normal', assigneeActorIds: [], subtaskCount: 0, due_date: null }),
  // Created by "me" so contributor edit-scope can be exercised.
  task({ id: TASK_MINE, title: 'My own task', status_id: STATUS_DONE, priority: 'low',
         created_by: ACTOR_ME, assigneeActorIds: [ACTOR_ME], subtaskCount: 0, due_date: null })
];

export const subtask = task({
  id: SUBTASK_1, parent_task_id: TASK_1, title: 'Collect chlorine readings',
  subtaskCount: 0, assigneeActorIds: []
});

export function capabilitiesFor(role: Role) {
  const manager = ['SUPER_ADMIN', 'WORKSPACE_OWNER', 'ADMIN'].includes(role);
  const contributor = ['SALES_REP', 'TEAM_MEMBER'].includes(role);
  return {
    canManageHierarchy: manager,
    canCreateTask: manager || contributor,
    canAssignOthers: manager,
    timeVisibility: manager ? 'team' : contributor ? 'own' : 'aggregate_only',
    timeTrackingEnabled: true,
    actorResolved: true
  };
}

export function bootstrapFor(role: Role, over: Partial<any> = {}) {
  return {
    spaces, folders, lists, statuses,
    activeTimer: null,
    capabilities: capabilitiesFor(role),
    ...over
  };
}

export const okBody = (data: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'success', data, ...extra });

export const errBody = (code: string, error: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'error', code, error, ...extra });
