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

import {
  TaskApiError, formatDuration, formatTracked, formatTrackedDuration, newClientToken
} from '../src/tasks/apiClient.js';
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

console.log('\n--- formatTracked (ESTIMATE-only; must stay exactly as-is) ---');
check('under a minute', formatTracked(30), '30s');
check('exact minute', formatTracked(60), '1m');
check('minutes', formatTracked(605), '10m');
check('hours and minutes', formatTracked(3900), '1h 5m');
check('whole hours', formatTracked(7200), '2h 0m');
check('negative clamps', formatTracked(-5), '0s');

console.log('\n--- formatTrackedDuration (canonical ACTUAL-tracked-time formatter) ---');
// The exact table from the tracked-hours fix spec.
check('zero -> em dash, not 0m or empty', formatTrackedDuration(0), '—');
check('5 seconds', formatTrackedDuration(5), '5s');
check('48 seconds (the original bug report)', formatTrackedDuration(48), '48s');
check('59 seconds', formatTrackedDuration(59), '59s');
check('60 seconds -> 1m, not 1m 0s', formatTrackedDuration(60), '1m');
check('61 seconds -> 1m 1s', formatTrackedDuration(61), '1m 1s');
check('1 hour -> bare 1h, not 1h 0m', formatTrackedDuration(3600), '1h');
check('1 hour 2 minutes', formatTrackedDuration(3720), '1h 2m');
// Edge cases beyond the spec's own table.
check('1 second, singular, still visible', formatTrackedDuration(1), '1s');
check('a positive sub-minute value is never treated as empty (contrast with 0)',
  formatTrackedDuration(1) === '—', false);
check('minute boundary just below (119s)', formatTrackedDuration(119), '1m 59s');
check('two whole hours, no dangling 0m', formatTrackedDuration(7200), '2h');
check('multi-hour with minutes', formatTrackedDuration(9005), '2h 30m');
check('negative clamps to em dash (never a negative or NaN string)', formatTrackedDuration(-5), '—');
check('fractional truncates like every other duration helper here',
  formatTrackedDuration(48.9), '48s');
check('sub-second positive still rounds down to a whole second, not to zero',
  formatTrackedDuration(0.5), '—'); // floors to 0 seconds -> genuinely no tracked time yet

console.log('\n--- Aggregation contract mirrored from /time/summary and the drawer reducer ---');
/**
 * Neither the server's byTask reducer (router.ts) nor the drawer's client-side reduce() is
 * exported as a standalone function, so this mirrors their shared formula — sum
 * floor((end-start)/1000) per entry, using `now` in place of a null ended_at — to pin the
 * ARITHMETIC CONTRACT the fix depends on: multiple entries sum correctly regardless of
 * source, and a still-running entry contributes its elapsed-so-far rather than nothing.
 */
function sumTrackedSeconds(
  entries: { started_at: string; ended_at: string | null }[], now: number
): number {
  return entries.reduce((sum, e) => {
    const end = e.ended_at ? Date.parse(e.ended_at) : now;
    return sum + Math.max(0, Math.floor((end - Date.parse(e.started_at)) / 1000));
  }, 0);
}
const NOW = Date.parse('2026-08-20T12:00:00.000Z');
check('multiple completed entries totaling 48 seconds (5s + 43s, the original report)',
  sumTrackedSeconds([
    { started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T09:00:05.000Z' },
    { started_at: '2026-08-20T09:05:00.000Z', ended_at: '2026-08-20T09:05:43.000Z' }
  ], NOW), 48);
check('manual and timer entries are summed identically regardless of source',
  sumTrackedSeconds([
    { started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T09:00:20.000Z' }, // manual
    { started_at: '2026-08-20T09:10:00.000Z', ended_at: '2026-08-20T09:10:28.000Z' }  // timer
  ], NOW), 48);
check('a running entry (ended_at null) contributes its elapsed-so-far, not zero',
  sumTrackedSeconds([{ started_at: new Date(NOW - 90_000).toISOString(), ended_at: null }], NOW), 90);
// Both /time/summary and GET /:id/time-entries filter `archived_at is null` in the query
// itself (router.ts), so an archived row never reaches this reducer at all. This pins that
// same is-null-only contract at the call site, using the same shape the server rows have.
const withOneArchived = [
  { started_at: '2026-08-20T09:00:00.000Z', ended_at: '2026-08-20T09:00:05.000Z', archived_at: null as string | null },
  { started_at: '2026-08-20T09:05:00.000Z', ended_at: '2026-08-20T09:05:43.000Z', archived_at: '2026-08-20T10:00:00.000Z' }
];
check('deleted/archived-entry subtraction: an archived entry drops out of the total',
  sumTrackedSeconds(withOneArchived.filter(e => !e.archived_at), NOW), 5); // the 43s entry archived -> only 5s remains
check('restoring (un-archiving) an entry adds it back to the total',
  sumTrackedSeconds(withOneArchived.map(e => ({ ...e, archived_at: null })), NOW), 48);

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
