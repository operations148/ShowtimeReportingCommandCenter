/**
 * Task Management Folder backend — pure-logic tests.
 * Run: npx tsx scripts/test-task-folders.ts
 *
 * No DOM, no network, NO DATABASE. This suite exists because no non-production database
 * target is available in this environment (checked: no TASK_DB_TEST_URL, no Docker, no local
 * Postgres) — per PROMPT 3's explicit instruction, the live-database-integration portion
 * (applying migration 0009 to a real copy of the schema and exercising real inserts/updates/
 * constraint violations) is BLOCKED and stops here rather than running against Production or
 * being silently skipped. See PROMPT 3 REPORT section "Database integration status" for the
 * exact requirement to unblock it.
 *
 * What IS verified here, without a database: the permission gate Folder routes reuse
 * (assertCanManageHierarchy, unchanged), the validation contract Folder fields go through
 * (the same v.* functions Spaces/Lists already use), and the shape of the two new error
 * constructors (folderNotEmpty, folderCrossSpace) added for this feature.
 */

import { UserRole } from '../src/types.js';
import * as perm from '../src/tasks/permissions.js';
import * as v from '../src/tasks/validation.js';
import { folderNotEmpty, folderCrossSpace } from '../src/tasks/http.js';
import { TaskApiError } from '../src/tasks/apiClient.js';

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function checkThrows(name: string, fn: () => unknown, matchMessage?: RegExp) {
  try {
    fn();
    failures.push(name); console.log(`  FAIL  ${name} — expected a throw, none occurred`);
  } catch (err: any) {
    if (matchMessage && !matchMessage.test(err.message ?? '')) {
      failures.push(name);
      console.log(`  FAIL  ${name} — threw, but message didn't match ${matchMessage}: "${err.message}"`);
    } else { passed++; console.log(`  PASS  ${name}`); }
  }
}

const ALL_ROLES = Object.values(UserRole);
const MANAGERS = [UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN];
const NON_MANAGERS = ALL_ROLES.filter(r => !MANAGERS.includes(r));

console.log('\n--- Folder mutation gate (Recommended matrix: SUPER_ADMIN/MANAGER manage, CONTRIBUTOR/READ_ONLY view-only) ---');
console.log('    Folder routes call perm.assertCanManageHierarchy — the SAME gate Spaces/Lists/');
console.log('    statuses already use, unchanged by this feature. These assertions pin that the');
console.log('    function itself still implements exactly the requested matrix.');
for (const r of MANAGERS) {
  let threw = false;
  try { perm.assertCanManageHierarchy(r); } catch { threw = true; }
  check(`${r} may manage Folders (create/rename/move/reorder/archive)`, threw, false);
}
for (const r of NON_MANAGERS) {
  let threw = false;
  try { perm.assertCanManageHierarchy(r); } catch { threw = true; }
  check(`${r} may NOT manage Folders (view-only)`, threw, true);
}
check('CONTRIBUTOR roles are exactly SALES_REP and TEAM_MEMBER (both non-managers above)',
  NON_MANAGERS.filter(r => perm.isContributor(r)).sort(),
  [UserRole.SALES_REP, UserRole.TEAM_MEMBER].sort());
check('READ_ONLY is a non-manager, non-contributor (view-only, same as every other hierarchy object)',
  perm.isManager(UserRole.READ_ONLY) || perm.isContributor(UserRole.READ_ONLY), false);

console.log('\n--- Folder field validation contract (same v.* functions Spaces/Lists already use) ---');
check('name: trims and accepts 1-120 chars', v.requireString('  Ops HQ  ', 'name', 1, 120), 'Ops HQ');
checkThrows('name: rejects empty/whitespace-only', () => v.requireString('   ', 'name', 1, 120));
checkThrows('name: rejects over 120 chars', () => v.requireString('x'.repeat(121), 'name', 1, 120));
check('description: optional, null when omitted', v.optionalString(undefined, 'description', 2000), null);
check('description: optional, null when empty string', v.optionalString('   ', 'description', 2000), null);
check('description: trims and accepts up to 2000 chars', v.optionalString('  notes  ', 'description', 2000), 'notes');
checkThrows('description: rejects over 2000 chars', () => v.optionalString('x'.repeat(2001), 'description', 2000));
check('spaceId/folderId: a well-formed v4 uuid passes',
  v.requireUuid('33333333-3333-4333-8333-333333333333', 'spaceId'),
  '33333333-3333-4333-8333-333333333333');
checkThrows('spaceId/folderId: rejects a non-uuid', () => v.requireUuid('not-a-uuid', 'spaceId'));
check('folderId (move to root): omitted/null/empty all normalise to null via optionalUuid',
  [v.optionalUuid(undefined, 'folderId'), v.optionalUuid(null, 'folderId'), v.optionalUuid('', 'folderId')],
  [null, null, null]);
check('version: requires a positive integer, same as Space/List updates', v.requireVersion(3), 3);
checkThrows('version: rejects 0 or negative', () => v.requireVersion(0));

console.log('\n--- New error shapes (folderNotEmpty, folderCrossSpace) ---');
const notEmpty1 = folderNotEmpty(1);
check('folderNotEmpty: code', notEmpty1.code, 'TASK_FOLDER_NOT_EMPTY');
check('folderNotEmpty: HTTP 409 (conflict with current state, not a malformed request)', notEmpty1.httpStatus, 409);
check('folderNotEmpty: singular message for count=1', notEmpty1.message, 'This folder still has 1 list in it. Move or archive them first.');
check('folderNotEmpty: extra payload carries the count for the UI', notEmpty1.extra, { listCount: 1 });
const notEmpty3 = folderNotEmpty(3);
check('folderNotEmpty: plural message for count>1', notEmpty3.message, 'This folder still has 3 lists in it. Move or archive them first.');

const crossSpace = folderCrossSpace();
check('folderCrossSpace: code', crossSpace.code, 'TASK_FOLDER_CROSS_SPACE');
check('folderCrossSpace: HTTP 422 (the request itself references a mismatched pair)', crossSpace.httpStatus, 422);

console.log('\n--- Client-side error classification (apiClient.ts mirrors the server contract exactly) ---');
check('TASK_FOLDER_NOT_EMPTY is terminal (retrying verbatim cannot succeed — must move/archive first)',
  new TaskApiError(409, 'TASK_FOLDER_NOT_EMPTY', 'x').isTerminal, true);
check('TASK_FOLDER_CROSS_SPACE is terminal (retrying verbatim cannot succeed — must pick a different Folder)',
  new TaskApiError(422, 'TASK_FOLDER_CROSS_SPACE', 'x').isTerminal, true);

console.log('\n--- Notes on what this suite CANNOT verify without a database ---');
console.log('  * The composite FK (task_lists_folder_fk) actually rejecting a cross-Space or');
console.log('    cross-workspace folder_id at the database layer — proven by migration design');
console.log('    and by a read-only production check confirming the exact CHECK-constraint name');
console.log('    this migration widens already exists as assumed, but NOT by a live INSERT/UPDATE.');
console.log('  * Migration 0009 actually applying idempotently end-to-end (every statement uses');
console.log('    IF [NOT] EXISTS or an equivalent guard — verified by static reading, not by run).');
console.log('  * The archive-non-empty COUNT query returning correct results against real rows.');
console.log('  * Bootstrap returning real folders/lists rows with correct folder_id values.');

console.log('');
if (!failures.length) console.log(`  All ${passed} folder-backend assertions passed.\n`);
else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
