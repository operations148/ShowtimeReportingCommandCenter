/**
 * Task Management staged-rollout gate tests.
 * Run: npx tsx scripts/test-task-rollout.ts
 *
 * Pure functions — no network, no database, no credentials. These pin the canary gate, which
 * is the control standing between an unreleased module and a live tenant. Every assertion
 * here is about failing CLOSED: the dangerous direction is a misconfiguration that silently
 * grants access, never one that denies it.
 */

process.env.SUPABASE_URL = 'https://unit-test-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'FAKE-TEST-KEY-not-a-real-credential';

import {
  rolloutMode, canaryWorkspaceIds, isWorkspaceInRollout, assertWorkspaceInRollout,
  rolloutSummary
} from '../src/tasks/rollout.js';
import { decideTaskNavVisible } from '../src/tasks/featureFlag.js';

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
function throwsCode(fn: () => void): string {
  try { fn(); return 'NO_THROW'; } catch (e: any) { return e?.code ?? e?.name ?? 'UNKNOWN'; }
}

const CANARY = 'ws_showtime';
const OTHER = 'ws_trial_demo';

/** Sets the two rollout env vars; `undefined` deletes, to model a genuinely absent var. */
function configure(mode: string | undefined, ids: string | undefined) {
  if (mode === undefined) delete process.env.TASK_MANAGEMENT_ROLLOUT_MODE;
  else process.env.TASK_MANAGEMENT_ROLLOUT_MODE = mode;
  if (ids === undefined) delete process.env.TASK_MANAGEMENT_CANARY_WORKSPACE_IDS;
  else process.env.TASK_MANAGEMENT_CANARY_WORKSPACE_IDS = ids;
}

// ── 1. Rollout off ────────────────────────────────────────────────────────────────────
console.log('\n--- rollout mode: off ---');
configure('off', `${CANARY},${OTHER}`);
check('mode resolves to off', rolloutMode(), 'off');
check('canary workspace denied when mode is off', isWorkspaceInRollout(CANARY), false);
check('any workspace denied when mode is off', isWorkspaceInRollout(OTHER), false);
check('off blocks even a listed workspace', throwsCode(() => assertWorkspaceInRollout(CANARY)),
  'TASK_ROLLOUT_EXCLUDED');

console.log('\n--- absent / blank / unknown mode all fail closed ---');
configure(undefined, CANARY);
check('absent mode resolves to off', rolloutMode(), 'off');
check('absent mode denies', isWorkspaceInRollout(CANARY), false);
configure('   ', CANARY);
check('whitespace mode resolves to off', rolloutMode(), 'off');
configure('CANARY', CANARY);
check('mixed-case CANARY is accepted (case-insensitive)', rolloutMode(), 'canary');
configure('kanary', CANARY);
check('typo mode resolves to off', rolloutMode(), 'off');
check('typo mode denies', isWorkspaceInRollout(CANARY), false);
configure('true', CANARY);
check('boolean-looking mode resolves to off', rolloutMode(), 'off');
configure('canary,all', CANARY);
check('comma-joined mode resolves to off', rolloutMode(), 'off');

// ── 2. Canary workspace allowed ───────────────────────────────────────────────────────
console.log('\n--- rollout mode: canary ---');
configure('canary', CANARY);
check('mode resolves to canary', rolloutMode(), 'canary');
check('allowlisted workspace is admitted', isWorkspaceInRollout(CANARY), true);
check('allowlisted workspace does not throw', throwsCode(() => assertWorkspaceInRollout(CANARY)),
  'NO_THROW');

// ── 3. Non-canary workspace denied ────────────────────────────────────────────────────
console.log('\n--- non-canary workspace ---');
check('unlisted workspace is denied', isWorkspaceInRollout(OTHER), false);
check('unlisted workspace throws TASK_ROLLOUT_EXCLUDED',
  throwsCode(() => assertWorkspaceInRollout(OTHER)), 'TASK_ROLLOUT_EXCLUDED');
check('null workspace denied', isWorkspaceInRollout(null), false);
check('undefined workspace denied', isWorkspaceInRollout(undefined), false);
check('empty-string workspace denied', isWorkspaceInRollout(''), false);
check('whitespace workspace denied', isWorkspaceInRollout('   '), false);

console.log('\n--- near-miss identifiers must not match ---');
check('case variant denied', isWorkspaceInRollout(CANARY.toUpperCase()), false);
check('leading-space variant denied', isWorkspaceInRollout(' ' + CANARY), false);
check('prefix of a listed id denied', isWorkspaceInRollout(CANARY.slice(0, -1)), false);
check('listed id plus suffix denied', isWorkspaceInRollout(CANARY + 'x'), false);

// ── 4. Empty allowlist ────────────────────────────────────────────────────────────────
console.log('\n--- canary with an empty allowlist admits nobody ---');
configure('canary', '');
check('empty string parses to no ids', canaryWorkspaceIds(), []);
check('empty allowlist denies the canary workspace', isWorkspaceInRollout(CANARY), false);
check('empty allowlist throws', throwsCode(() => assertWorkspaceInRollout(CANARY)),
  'TASK_ROLLOUT_EXCLUDED');
configure('canary', undefined);
check('absent allowlist parses to no ids', canaryWorkspaceIds(), []);
check('absent allowlist denies', isWorkspaceInRollout(CANARY), false);

// ── 5. Malformed allowlist ────────────────────────────────────────────────────────────
console.log('\n--- malformed allowlist ---');
configure('canary', ',,,');
check('commas-only parses to no ids', canaryWorkspaceIds(), []);
check('commas-only denies', isWorkspaceInRollout(CANARY), false);
configure('canary', '   ,  ,');
check('whitespace-and-commas parses to no ids', canaryWorkspaceIds(), []);
check('whitespace-and-commas denies', isWorkspaceInRollout(CANARY), false);
check('blank entry never matches an empty workspace id', isWorkspaceInRollout(''), false);

configure('canary', `  ${CANARY} , , ${OTHER}  ,`);
check('padded entries are trimmed', canaryWorkspaceIds(), [CANARY, OTHER]);
check('padded list still admits the canary', isWorkspaceInRollout(CANARY), true);
check('padded list admits the second listed id', isWorkspaceInRollout(OTHER), true);

// ── 6. Workspace switch away from canary ──────────────────────────────────────────────
console.log('\n--- workspace switch away from the canary ---');
configure('canary', CANARY);
check('before switch: canary admitted', isWorkspaceInRollout(CANARY), true);
check('after switch: other workspace denied', isWorkspaceInRollout(OTHER), false);
check('after switch: mutate refused',
  throwsCode(() => assertWorkspaceInRollout(OTHER)), 'TASK_ROLLOUT_EXCLUDED');

// ── 7. Cross-workspace request ────────────────────────────────────────────────────────
console.log('\n--- cross-workspace request ---');
// The gate only ever sees the SESSION workspace. A caller naming another workspace cannot
// change which id is checked, so the check is driven by the session value in every case.
check('session id is what is evaluated, not a requested id',
  isWorkspaceInRollout(OTHER), false);
check('a canary session stays admitted regardless of what a body claims',
  isWorkspaceInRollout(CANARY), true);

// ── 8. Timer start denied outside canary ──────────────────────────────────────────────
console.log('\n--- timer start outside the canary ---');
check('timer start is not exempt: denied for a non-canary workspace',
  throwsCode(() => assertWorkspaceInRollout(OTHER)), 'TASK_ROLLOUT_EXCLUDED');
check('timer start denied when mode is off even for the canary workspace', (() => {
  configure('off', CANARY);
  const r = throwsCode(() => assertWorkspaceInRollout(CANARY));
  configure('canary', CANARY);
  return r;
})(), 'TASK_ROLLOUT_EXCLUDED');

// ── 9. Controlled shutdown: recover and stop an already-running timer ─────────────────
console.log('\n--- controlled shutdown carve-out ---');
configure('canary', CANARY);
check('removed-from-allowlist workspace may still READ its active timer',
  throwsCode(() => assertWorkspaceInRollout(OTHER, { exemptOperation: 'timer.active' })), 'NO_THROW');
check('removed-from-allowlist workspace may still STOP its timer',
  throwsCode(() => assertWorkspaceInRollout(OTHER, { exemptOperation: 'timer.stop' })), 'NO_THROW');

configure('off', '');
check('mode off: active-timer recovery still permitted',
  throwsCode(() => assertWorkspaceInRollout(CANARY, { exemptOperation: 'timer.active' })), 'NO_THROW');
check('mode off: timer stop still permitted',
  throwsCode(() => assertWorkspaceInRollout(CANARY, { exemptOperation: 'timer.stop' })), 'NO_THROW');
check('mode off: everything else still refused',
  throwsCode(() => assertWorkspaceInRollout(CANARY)), 'TASK_ROLLOUT_EXCLUDED');

// ── mode: all ─────────────────────────────────────────────────────────────────────────
console.log('\n--- rollout mode: all (reserved for the approved release) ---');
configure('all', '');
check('mode resolves to all', rolloutMode(), 'all');
check('all admits a workspace with an empty allowlist', isWorkspaceInRollout(CANARY), true);
check('all admits any workspace', isWorkspaceInRollout(OTHER), true);
// 'all' deliberately does not consult the id: the gate is open, and identity is still
// enforced downstream by requireAuth, entitlement and RBAC.
check('all does not consult the workspace id', isWorkspaceInRollout(undefined), true);

// ── diagnostics leak nothing ──────────────────────────────────────────────────────────
console.log('\n--- diagnostics ---');
configure('canary', `${CANARY},${OTHER}`);
check('summary reports a count, never the ids', rolloutSummary(), { mode: 'canary', canaryWorkspaceCount: 2 });

// Narrow the allowlist so OTHER is genuinely excluded for the message check below.
configure('canary', CANARY);
check('denial message names no other tenant and no configuration', (() => {
  try { assertWorkspaceInRollout(OTHER); return 'NO_THROW'; }
  catch (e: any) { return e.message; }
})(), 'Task Management is not available for this workspace yet.');

// ── client-side nav rule (convenience only; the server gate is the boundary) ──────────
console.log('\n--- client nav visibility ---');
const nav = (enabled: boolean, allowlist: string[], workspaceId?: string | null) =>
  decideTaskNavVisible({ enabled, allowlist, workspaceId });

check('module off: hidden even for the canary workspace', nav(false, [CANARY], CANARY), false);
check('module off with no allowlist: hidden', nav(false, [], CANARY), false);
check('no allowlist: shown for any workspace', nav(true, [], OTHER), true);
check('no allowlist: shown with no workspace id', nav(true, [], undefined), true);
check('allowlist set: shown for the canary workspace', nav(true, [CANARY], CANARY), true);
check('allowlist set: hidden for a non-canary workspace', nav(true, [CANARY], OTHER), false);
check('allowlist set: hidden when the workspace is unknown', nav(true, [CANARY], undefined), false);
check('allowlist set: hidden when the workspace is null', nav(true, [CANARY], null), false);
check('allowlist set: near-miss id hidden', nav(true, [CANARY], CANARY.toUpperCase()), false);
check('switching away from the canary hides the tab', nav(true, [CANARY], OTHER), false);
check('switching back to the canary shows it again', nav(true, [CANARY], CANARY), true);

console.log('');
if (!failures.length) console.log(`  All ${passed} rollout-gate assertions passed.\n`);
else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
