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
export const LIST_A = '44444444-4444-4444-8444-444444444444';
export const LIST_B = '44444444-4444-4444-8444-444444444445';

export const STATUS_TODO = '55555555-5555-4555-8555-555555555551';
export const STATUS_DOING = '55555555-5555-4555-8555-555555555552';
export const STATUS_DONE = '55555555-5555-4555-8555-555555555553';

export const TASK_1 = '66666666-6666-4666-8666-666666666661';
export const TASK_2 = '66666666-6666-4666-8666-666666666662';
export const TASK_MINE = '66666666-6666-4666-8666-666666666663';
export const SUBTASK_1 = '77777777-7777-4777-8777-777777777771';

export const spaces = [
  { id: SPACE_A, name: 'Delivery', position: 1000, version: 1, archived_at: null }
];

export const lists = [
  { id: LIST_A, space_id: SPACE_A, name: 'General', position: 1000, is_default: true, version: 1, archived_at: null },
  { id: LIST_B, space_id: SPACE_A, name: 'Backlog', position: 2000, is_default: false, version: 1, archived_at: null }
];

export const statuses = [
  { id: STATUS_TODO, space_id: SPACE_A, name: 'To Do', category: 'todo', color: '#94A3B8', position: 1000, is_default: true, version: 1, archived_at: null },
  { id: STATUS_DOING, space_id: SPACE_A, name: 'In Progress', category: 'in_progress', color: '#2563EB', position: 2000, is_default: false, version: 1, archived_at: null },
  { id: STATUS_DONE, space_id: SPACE_A, name: 'Done', category: 'done', color: '#059669', position: 3000, is_default: false, version: 1, archived_at: null }
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
    spaces, lists, statuses,
    activeTimer: null,
    capabilities: capabilitiesFor(role),
    ...over
  };
}

export const okBody = (data: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'success', data, ...extra });

export const errBody = (code: string, error: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'error', code, error, ...extra });
