/**
 * Task Management frontend pure-logic tests.
 * Run: npx tsx scripts/test-task-frontend.ts
 *
 * No DOM, no network. Covers the client helpers whose correctness is easy to get subtly
 * wrong and hard to notice: duration formatting, idempotency-token shape, error
 * classification, and the contributor edit-scope predicate that decides which controls the
 * UI offers. (The server re-checks that rule on every mutation; this only pins the
 * affordance so the UI does not offer actions the server will reject.)
 */

import { TaskApiError, formatDuration, formatTracked, newClientToken } from '../src/tasks/apiClient.js';
import { UserRole } from '../src/types.js';

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log('\n--- formatDuration (running timer display) ---');
check('zero', formatDuration(0), '0:00:00');
check('seconds only', formatDuration(45), '0:00:45');
check('minutes pad', formatDuration(65), '0:01:05');
check('one hour', formatDuration(3600), '1:00:00');
check('multi-hour', formatDuration(3725), '1:02:05');
check('long shift', formatDuration(36000), '10:00:00');
check('negative clamps to zero (clock skew must not show a negative timer)', formatDuration(-10), '0:00:00');
check('fractional truncates', formatDuration(59.9), '0:00:59');

console.log('\n--- formatTracked (summaries) ---');
check('under a minute', formatTracked(30), '30s');
check('exact minute', formatTracked(60), '1m');
check('minutes', formatTracked(605), '10m');
check('hours and minutes', formatTracked(3900), '1h 5m');
check('whole hours', formatTracked(7200), '2h 0m');
check('negative clamps', formatTracked(-5), '0s');

console.log('\n--- newClientToken (timer idempotency) ---');
const t1 = newClientToken(), t2 = newClientToken();
check('is a v4 uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t1), true);
check('tokens are distinct', t1 !== t2, true);

console.log('\n--- TaskApiError classification ---');
const terminal = ['TASK_MODULE_DISABLED', 'TASK_WORKSPACE_SUSPENDED', 'TASK_ACTOR_UNRESOLVED',
                  'TASK_FORBIDDEN', 'TASK_NOT_FOUND'] as const;
for (const code of terminal) {
  check(`${code} is terminal (retrying cannot help)`,
    new TaskApiError(403, code as any, 'x').isTerminal, true);
}
for (const code of ['TASK_TIMER_CONFLICT', 'TASK_VERSION_CONFLICT', 'TASK_NETWORK',
                    'TASK_VALIDATION_FAILED', 'TASK_ENTITLEMENT_EXPIRED'] as const) {
  check(`${code} is NOT terminal`, new TaskApiError(409, code as any, 'x').isTerminal, false);
}
check('409 conflict carries the running timer payload',
  new TaskApiError(409, 'TASK_TIMER_CONFLICT', 'busy',
    { data: { entryId: 'e1', taskId: 't1', startedAt: 'now' } }).payload.data.taskId, 't1');

console.log('\n--- Contributor edit scope (D6 affordance mirror) ---');
const MANAGERS = [UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN];
const CONTRIBUTORS = [UserRole.SALES_REP, UserRole.TEAM_MEMBER];
/** Mirrors canMutate() in TaskManagementView. */
function canMutate(role: UserRole, myActorId: string | undefined,
                   task: { created_by: string | null; assigneeActorIds: string[] }): boolean {
  if (MANAGERS.includes(role)) return true;
  if (!CONTRIBUTORS.includes(role) || !myActorId) return false;
  return task.created_by === myActorId || task.assigneeActorIds.includes(myActorId);
}
const ME = 'a-me', OTHER = 'a-other';
const foreign = { created_by: OTHER, assigneeActorIds: [OTHER] };
const mine = { created_by: ME, assigneeActorIds: [] };
const assignedToMe = { created_by: OTHER, assigneeActorIds: [ME] };

for (const r of MANAGERS) check(`${r} may edit any task`, canMutate(r, ME, foreign), true);
for (const r of CONTRIBUTORS) {
  check(`${r} may edit a task they created`, canMutate(r, ME, mine), true);
  check(`${r} may edit a task assigned to them`, canMutate(r, ME, assignedToMe), true);
  check(`${r} may NOT edit an unrelated task`, canMutate(r, ME, foreign), false);
}
check('READ_ONLY may never edit', canMutate(UserRole.READ_ONLY, ME, mine), false);
check('unresolved actor (no SSO userId) cannot edit even own-looking tasks',
  canMutate(UserRole.TEAM_MEMBER, undefined, mine), false);

console.log('');
if (!failures.length) console.log(`  All ${passed} frontend assertions passed.\n`);
else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
