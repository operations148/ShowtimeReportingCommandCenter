/**
 * Task Management RBAC + entitlement + feature-flag tests.
 * Run: npx tsx scripts/test-task-permissions.ts
 *
 * Pure functions — no network, no database, no credentials. These pin decisions D4, D6 and
 * D7, which are the rules an attacker or a bug is most likely to erode.
 */

process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'FAKE-TEST-KEY-not-a-real-credential';

import { UserRole } from '../src/types.js';
import * as perm from '../src/tasks/permissions.js';
import { assertTaskEntitlement } from '../src/tasks/entitlement.js';
import * as v from '../src/tasks/validation.js';
import { isTaskManagementEnabled, isTaskTimeTrackingEnabled } from '../src/tasks/config.js';

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
/** Returns the thrown error's code, or 'NO_THROW'. */
function throwsCode(fn: () => void): string {
  try { fn(); return 'NO_THROW'; } catch (e: any) { return e?.code ?? e?.name ?? 'UNKNOWN'; }
}

const MANAGERS = [UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN];
const CONTRIBUTORS = [UserRole.SALES_REP, UserRole.TEAM_MEMBER];
const ME = 'actor-me';
const OTHER = 'actor-other';

console.log('\n--- D6: hierarchy management is manager-only ---');
for (const r of MANAGERS) check(`${r} may manage hierarchy`, throwsCode(() => perm.assertCanManageHierarchy(r)), 'NO_THROW');
for (const r of [...CONTRIBUTORS, UserRole.READ_ONLY]) {
  check(`${r} may NOT manage hierarchy`, throwsCode(() => perm.assertCanManageHierarchy(r)), 'TASK_FORBIDDEN');
}

console.log('\n--- D6: task creation ---');
for (const r of [...MANAGERS, ...CONTRIBUTORS]) check(`${r} may create tasks`, throwsCode(() => perm.assertCanCreateTask(r)), 'NO_THROW');
check('READ_ONLY may NOT create tasks', throwsCode(() => perm.assertCanCreateTask(UserRole.READ_ONLY)), 'TASK_FORBIDDEN');

console.log('\n--- D6: contributor edit scope (creator OR assignee only) ---');
const foreignTask = { created_by: OTHER };
const myTask = { created_by: ME };
for (const r of MANAGERS) {
  check(`${r} may edit a task they neither created nor are assigned to`,
    throwsCode(() => perm.assertCanMutateTask(r, ME, foreignTask, [])), 'NO_THROW');
}
for (const r of CONTRIBUTORS) {
  check(`${r} may edit a task they CREATED`,
    throwsCode(() => perm.assertCanMutateTask(r, ME, myTask, [])), 'NO_THROW');
  check(`${r} may edit a task they are ASSIGNED to`,
    throwsCode(() => perm.assertCanMutateTask(r, ME, foreignTask, [ME])), 'NO_THROW');
  check(`${r} may NOT edit an unrelated task`,
    throwsCode(() => perm.assertCanMutateTask(r, ME, foreignTask, [OTHER])), 'TASK_FORBIDDEN');
}
check('READ_ONLY may NOT edit even a task naming them',
  throwsCode(() => perm.assertCanMutateTask(UserRole.READ_ONLY, ME, myTask, [ME])), 'TASK_FORBIDDEN');

console.log('\n--- D6: self-assignment only for contributors ---');
for (const r of CONTRIBUTORS) {
  check(`${r} may assign THEMSELVES`,
    throwsCode(() => perm.assertCanApplyAssignments(r, ME, [], [ME])), 'NO_THROW');
  check(`${r} may unassign THEMSELVES`,
    throwsCode(() => perm.assertCanApplyAssignments(r, ME, [ME], [])), 'NO_THROW');
  check(`${r} may NOT assign someone else`,
    throwsCode(() => perm.assertCanApplyAssignments(r, ME, [], [OTHER])), 'TASK_FORBIDDEN');
  check(`${r} may NOT unassign someone else`,
    throwsCode(() => perm.assertCanApplyAssignments(r, ME, [OTHER], [])), 'TASK_FORBIDDEN');
}
check('ADMIN may assign someone else',
  throwsCode(() => perm.assertCanApplyAssignments(UserRole.ADMIN, ME, [], [OTHER])), 'NO_THROW');

console.log('\n--- D7: time entry mutation scope ---');
for (const r of MANAGERS) {
  check(`${r} may edit ANOTHER member's time entry`,
    throwsCode(() => perm.assertCanMutateTimeEntry(r, ME, { actor_id: OTHER })), 'NO_THROW');
}
for (const r of CONTRIBUTORS) {
  check(`${r} may edit their OWN time entry`,
    throwsCode(() => perm.assertCanMutateTimeEntry(r, ME, { actor_id: ME })), 'NO_THROW');
  check(`${r} may NOT edit another member's time entry`,
    throwsCode(() => perm.assertCanMutateTimeEntry(r, ME, { actor_id: OTHER })), 'TASK_FORBIDDEN');
}
check('READ_ONLY may NOT track time',
  throwsCode(() => perm.assertCanTrackTime(UserRole.READ_ONLY)), 'TASK_FORBIDDEN');

console.log('\n--- D7: time visibility tiers ---');
for (const r of MANAGERS) check(`${r} visibility = team`, perm.timeVisibilityFor(r), 'team');
for (const r of CONTRIBUTORS) check(`${r} visibility = own`, perm.timeVisibilityFor(r), 'own');
check('READ_ONLY visibility = aggregate_only', perm.timeVisibilityFor(UserRole.READ_ONLY), 'aggregate_only');
check('READ_ONLY blocked from member breakdown',
  throwsCode(() => perm.assertCanViewMemberBreakdown(UserRole.READ_ONLY)), 'TASK_FORBIDDEN');
check('SALES_REP blocked from member breakdown',
  throwsCode(() => perm.assertCanViewMemberBreakdown(UserRole.SALES_REP)), 'TASK_FORBIDDEN');
check('ADMIN allowed member breakdown',
  throwsCode(() => perm.assertCanViewMemberBreakdown(UserRole.ADMIN)), 'NO_THROW');

console.log('\n--- D4: entitlement policy ---');
const ACTIVE = { accessStatus: 'LICENSED', hasAccess: true };
const EXPIRED = { accessStatus: 'EXPIRED', hasAccess: false, denialReason: 'trial ended' };
const SUSPENDED = { accessStatus: 'SUSPENDED', hasAccess: false, denialReason: 'suspended' };

check('active tenant may mutate',
  throwsCode(() => assertTaskEntitlement(ACTIVE, UserRole.ADMIN, 'mutate')), 'NO_THROW');
check('EXPIRED tenant may READ',
  throwsCode(() => assertTaskEntitlement(EXPIRED, UserRole.ADMIN, 'read')), 'NO_THROW');
check('EXPIRED tenant may STOP a running timer',
  throwsCode(() => assertTaskEntitlement(EXPIRED, UserRole.ADMIN, 'timer.stop')), 'NO_THROW');
check('EXPIRED tenant may NOT mutate',
  throwsCode(() => assertTaskEntitlement(EXPIRED, UserRole.ADMIN, 'mutate')), 'TASK_ENTITLEMENT_EXPIRED');
check('SUSPENDED tenant blocked even from READ',
  throwsCode(() => assertTaskEntitlement(SUSPENDED, UserRole.ADMIN, 'read')), 'TASK_WORKSPACE_SUSPENDED');
check('SUSPENDED tenant blocked from timer.stop',
  throwsCode(() => assertTaskEntitlement(SUSPENDED, UserRole.ADMIN, 'timer.stop')), 'TASK_WORKSPACE_SUSPENDED');
check('SUPER_ADMIN retains recovery access on EXPIRED',
  throwsCode(() => assertTaskEntitlement(EXPIRED, UserRole.SUPER_ADMIN, 'mutate')), 'NO_THROW');
check('SUPER_ADMIN retains recovery access on SUSPENDED',
  throwsCode(() => assertTaskEntitlement(SUSPENDED, UserRole.SUPER_ADMIN, 'mutate')), 'NO_THROW');
check('missing entitlement fails closed',
  throwsCode(() => assertTaskEntitlement(null, UserRole.ADMIN, 'read')), 'TASK_ENTITLEMENT_EXPIRED');

console.log('\n--- Feature flags default to DISABLED ---');
delete process.env.TASK_MANAGEMENT_ENABLED;
delete process.env.TASK_TIME_TRACKING_ENABLED;
check('module disabled when unset', isTaskManagementEnabled(), false);
check('time tracking disabled when unset', isTaskTimeTrackingEnabled(), false);
process.env.TASK_MANAGEMENT_ENABLED = 'false';
check('explicit "false" is disabled', isTaskManagementEnabled(), false);
process.env.TASK_MANAGEMENT_ENABLED = 'maybe';
check('garbage value is disabled (fails closed)', isTaskManagementEnabled(), false);
process.env.TASK_MANAGEMENT_ENABLED = 'true';
check('explicit "true" enables module', isTaskManagementEnabled(), true);
process.env.TASK_TIME_TRACKING_ENABLED = 'true';
check('time tracking on when both true', isTaskTimeTrackingEnabled(), true);
process.env.TASK_MANAGEMENT_ENABLED = 'false';
check('time tracking CANNOT be on while module is off', isTaskTimeTrackingEnabled(), false);

console.log('\n--- Validation guards ---');
check('client-supplied workspace_id in body is rejected',
  throwsCode(() => v.rejectClientWorkspaceId({ workspace_id: 'ws_other' }, {})), 'TASK_VALIDATION_FAILED');
check('client-supplied workspaceId (camel) in query is rejected',
  throwsCode(() => v.rejectClientWorkspaceId({}, { workspaceId: 'ws_other' })), 'TASK_VALIDATION_FAILED');
check('clean body passes', throwsCode(() => v.rejectClientWorkspaceId({ title: 'x' }, {})), 'NO_THROW');
check('pageSize is capped at MAX', v.parsePagination({ pageSize: 100000 }).pageSize, 200);
check('negative page falls back to 1', v.parsePagination({ page: -5 }).page, 1);
check('unsortable column rejected', throwsCode(() => v.parseSort({ sort: 'password' })), 'TASK_VALIDATION_FAILED');
check('descending sort parsed', v.parseSort({ sort: '-due_date' }), { column: 'due_date', ascending: false });
check('version required for PATCH', throwsCode(() => v.requireVersion(undefined)), 'TASK_VALIDATION_FAILED');
check('version must be >= 1', throwsCode(() => v.requireVersion(0)), 'TASK_VALIDATION_FAILED');
check('bad uuid rejected', throwsCode(() => v.requireUuid('not-a-uuid', 'id')), 'TASK_VALIDATION_FAILED');
check('overlong title rejected', throwsCode(() => v.requireString('x'.repeat(501), 'title', 1, 500)), 'TASK_VALIDATION_FAILED');
check('blank title rejected', throwsCode(() => v.requireString('   ', 'title', 1, 500)), 'TASK_VALIDATION_FAILED');

console.log('');
if (!failures.length) console.log(`  All ${passed} task permission/entitlement assertions passed.\n`);
else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
