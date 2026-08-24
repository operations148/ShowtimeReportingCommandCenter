/**
 * Task Management DATABASE tests — identity, timer concurrency, tenant isolation and
 * schema-level constraints.
 *
 *   TASK_DB_TEST_URL=<preview-connection-string> npx tsx scripts/test-task-database.ts
 *
 * DELIBERATELY REFUSES TO RUN AGAINST PRODUCTION. It requires TASK_DB_TEST_URL and will not
 * fall back to DATABASE_URL, because this suite writes rows and exercises constraint
 * violations. Run it only after migrations 0005-0008 are applied to a NON-production project.
 *
 * Everything it creates is namespaced and removed in a finally block.
 */

import pg from 'pg';
import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true } as any);

const CONN = process.env.TASK_DB_TEST_URL;
if (!CONN) {
  console.error(
    '\n  TASK_DB_TEST_URL is required.\n' +
    '  This suite writes data and must never target production.\n' +
    '  Point it at a preview/staging Supabase project with 0005-0008 applied.\n'
  );
  process.exit(1);
}

let passed = 0;
const failures: string[] = [];
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
/** Runs a query and returns the SQLSTATE, or 'OK'. Used to assert constraints actually fire. */
async function sqlstate(c: pg.Client, sql: string, params: any[] = []): Promise<string> {
  try { await c.query(sql, params); return 'OK'; } catch (e: any) { return e?.code ?? 'UNKNOWN'; }
}

const SUFFIX = Date.now().toString(36);
const WS_A = `ws_tasktest_a_${SUFFIX}`;
const WS_B = `ws_tasktest_b_${SUFFIX}`;

async function main() {
const c = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
await c.connect();

try {
  // ── Fixtures: two tenants ───────────────────────────────────────────────────────────
  for (const ws of [WS_A, WS_B]) {
    await c.query(
      `insert into public.workspaces (id, name, slug, ghl_location_id, suspended)
       values ($1, $1, $1, 'loc_test', false)`, [ws]);
  }

  console.log('\n--- Identity: global principal, per-workspace actor ---');
  const { rows: [principal] } = await c.query(
    `insert into public.task_principals (source, issuer, external_id)
     values ('supabase','test.supabase.co',$1) returning id`, [`user_${SUFFIX}`]);

  // The SAME principal projected into BOTH workspaces.
  const { rows: [actorA] } = await c.query(
    `insert into public.task_workspace_actors (workspace_id, principal_id)
     values ($1,$2) returning id`, [WS_A, principal.id]);
  const { rows: [actorB] } = await c.query(
    `insert into public.task_workspace_actors (workspace_id, principal_id)
     values ($1,$2) returning id`, [WS_B, principal.id]);
  check('same principal yields two distinct workspace actors', actorA.id !== actorB.id, true);

  check('duplicate principal identity rejected',
    await sqlstate(c, `insert into public.task_principals (source, issuer, external_id)
                       values ('supabase','test.supabase.co',$1)`, [`user_${SUFFIX}`]), '23505');
  check('empty external_id rejected (no anonymous ghl_sso identity)',
    await sqlstate(c, `insert into public.task_principals (source, issuer, external_id)
                       values ('ghl_sso','gohighlevel','')`), '23514');
  check('whitespace-only external_id rejected',
    await sqlstate(c, `insert into public.task_principals (source, issuer, external_id)
                       values ('ghl_sso','gohighlevel','   ')`), '23514');
  check('duplicate actor per workspace rejected',
    await sqlstate(c, `insert into public.task_workspace_actors (workspace_id, principal_id)
                       values ($1,$2)`, [WS_A, principal.id]), '23505');

  console.log('\n--- Hierarchy: atomic space creation ---');
  const { rows: [created] } = await c.query(
    `select * from public.task_create_space($1,$2,$3)`, [WS_A, 'Delivery', actorA.id]);
  const { rows: [listCount] } = await c.query(
    `select count(*)::int n, bool_or(is_default) dflt, min(name) name
       from public.task_lists where space_id=$1`, [created.space_id]);
  check('default "General" list created', [listCount.n, listCount.dflt, listCount.name], [1, true, 'General']);
  const { rows: [statusCount] } = await c.query(
    `select count(*)::int n from public.task_statuses where space_id=$1`, [created.space_id]);
  check('three default statuses created', statusCount.n, 3);

  const listA = created.list_id;
  const { rows: [statusA] } = await c.query(
    `select id from public.task_statuses where space_id=$1 and is_default limit 1`, [created.space_id]);

  console.log('\n--- Tenant isolation via composite foreign keys ---');
  const { rows: [spaceB] } = await c.query(
    `select * from public.task_create_space($1,$2,$3)`, [WS_B, 'Other Tenant', actorB.id]);
  check("workspace A task cannot use workspace B's list",
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title)
                       values ($1,$2,$3,'x')`, [WS_A, spaceB.list_id, statusA.id]), '23503');
  check("workspace A task cannot use workspace B's status",
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title)
                       values ($1,$2,(select id from public.task_statuses where space_id=$3 limit 1),'x')`,
      [WS_A, listA, spaceB.space_id]), '23503');

  const { rows: [taskA] } = await c.query(
    `insert into public.task_items (workspace_id, list_id, status_id, title, created_by)
     values ($1,$2,$3,'Parent task',$4) returning id`, [WS_A, listA, statusA.id, actorA.id]);

  check("workspace B actor cannot be assigned to workspace A task",
    await sqlstate(c, `insert into public.task_assignments (workspace_id, task_id, actor_id)
                       values ($1,$2,$3)`, [WS_A, taskA.id, actorB.id]), '23503');

  console.log('\n--- Subtask depth capped at one level (declarative) ---');
  const { rows: [subtask] } = await c.query(
    `insert into public.task_items (workspace_id, list_id, status_id, title, parent_task_id)
     values ($1,$2,$3,'Subtask',$4) returning id`, [WS_A, listA, statusA.id, taskA.id]);
  check('one level of subtask allowed', typeof subtask.id, 'string');
  check('subtask of a subtask REJECTED by the database',
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title, parent_task_id)
                       values ($1,$2,$3,'Too deep',$4)`, [WS_A, listA, statusA.id, subtask.id]), '23503');
  check('subtask cannot live in a different list from its parent',
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title, parent_task_id)
                       values ($1,(select id from public.task_lists where workspace_id=$1 and id<>$2 limit 1),$3,'x',$4)`,
      [WS_A, listA, statusA.id, taskA.id]), '23503');
  check('task cannot be its own parent',
    await sqlstate(c, `update public.task_items set parent_task_id=id where id=$1`, [taskA.id]), '23514');

  console.log('\n--- Field constraints ---');
  check('due_date before start_date rejected',
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title, start_date, due_date)
                       values ($1,$2,$3,'x', now(), now() - interval '1 day')`,
      [WS_A, listA, statusA.id]), '23514');
  check('blank title rejected',
    await sqlstate(c, `insert into public.task_items (workspace_id, list_id, status_id, title)
                       values ($1,$2,$3,'   ')`, [WS_A, listA, statusA.id]), '23514');

  console.log('\n--- Timer: ONE running timer per GLOBAL principal ---');
  const { rows: [t1] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,null)`,
    [WS_A, taskA.id, principal.id, actorA.id]);
  check('first start succeeds', t1.outcome, 'started');

  const { rows: [t2] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,null)`,
    [WS_A, taskA.id, principal.id, actorA.id]);
  check('restarting the SAME task returns the existing timer', t2.outcome, 'already_running_same_task');
  check('...and returns the same entry id', t2.entry_id, t1.entry_id);

  const { rows: [t3] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,null)`,
    [WS_A, subtask.id, principal.id, actorA.id]);
  check('starting a DIFFERENT task conflicts', t3.outcome, 'conflict_other_task');

  // THE key cross-workspace guarantee: same human, other tenant, still cannot double-run.
  const { rows: [taskB] } = await c.query(
    `insert into public.task_items (workspace_id, list_id, status_id, title)
     values ($1,$2,(select id from public.task_statuses where space_id=$3 limit 1),'B task')
     returning id`, [WS_B, spaceB.list_id, spaceB.space_id]);
  const { rows: [t4] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,null)`,
    [WS_B, taskB.id, principal.id, actorB.id]);
  check('SAME principal cannot run a second timer in ANOTHER workspace', t4.outcome, 'conflict_other_task');

  const { rows: [running] } = await c.query(
    `select count(*)::int n from public.task_time_entries
      where principal_id=$1 and ended_at is null`, [principal.id]);
  check('exactly one running entry exists globally', running.n, 1);

  console.log('\n--- Timer idempotency and stop ---');
  const { rows: [stopped] } = await c.query(
    `select * from public.task_timer_stop($1,$2,null)`, [WS_A, principal.id]);
  check('stop returns stopped', stopped.outcome, 'stopped');
  check('duration is a non-negative number', Number(stopped.duration_seconds) >= 0, true);

  const { rows: [restop] } = await c.query(
    `select * from public.task_timer_stop($1,$2,$3)`, [WS_A, principal.id, stopped.entry_id]);
  check('stopping an already-stopped entry is idempotent', restop.outcome, 'already_stopped');
  check('...and returns the same entry', restop.entry_id, stopped.entry_id);

  const token = '11111111-2222-4333-8444-555555555555';
  const { rows: [i1] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,$5)`,
    [WS_A, taskA.id, principal.id, actorA.id, token]);
  const { rows: [i2] } = await c.query(
    `select * from public.task_timer_start($1,$2,$3,$4,$5)`,
    [WS_A, taskA.id, principal.id, actorA.id, token]);
  check('replayed client_token returns the original entry', i2.entry_id, i1.entry_id);
  check('...flagged as an idempotent replay', i2.outcome, 'idempotent_replay');

  console.log('\n--- Entitlement timer closure ---');
  const { rows: [closed] } = await c.query(
    `select public.task_close_active_timers($1,'test_reason') as n`, [WS_A]);
  check('auto-close closed the running timer', closed.n, 1);
  const { rows: [after] } = await c.query(
    `select count(*)::int n from public.task_time_entries
      where workspace_id=$1 and ended_at is null`, [WS_A]);
  check('no running timers remain', after.n, 0);
  const { rows: [again] } = await c.query(
    `select public.task_close_active_timers($1,'test_reason') as n`, [WS_A]);
  check('auto-close is idempotent (closes nothing the second time)', again.n, 0);

  console.log('\n--- Manual entries ---');
  check('manual entry without ended_at rejected',
    await sqlstate(c, `insert into public.task_time_entries
      (workspace_id, task_id, principal_id, actor_id, source) values ($1,$2,$3,$4,'manual')`,
      [WS_A, taskA.id, principal.id, actorA.id]), '23514');
  check('entry ending before it starts rejected',
    await sqlstate(c, `insert into public.task_time_entries
      (workspace_id, task_id, principal_id, actor_id, source, started_at, ended_at)
      values ($1,$2,$3,$4,'manual', now(), now() - interval '1 hour')`,
      [WS_A, taskA.id, principal.id, actorA.id]), '23514');

  console.log('\n--- Security posture ---');
  const { rows: rls } = await c.query(
    `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname like 'task\\_%'`);
  check('RLS enabled on every task table', rls.every((r: any) => r.relrowsecurity), true);
  const { rows: pol } = await c.query(
    `select count(*)::int n from pg_policies where schemaname='public' and tablename like 'task\\_%'`);
  check('no permissive policies exist (deny-all to browser roles)', pol[0].n, 0);
  const { rows: grants } = await c.query(
    `select count(*)::int n from information_schema.role_table_grants
      where table_schema='public' and table_name like 'task\\_%'
        and grantee in ('anon','authenticated')`);
  check('anon/authenticated hold NO privileges on task tables', grants[0].n, 0);

} finally {
  // Remove everything this run created. Workspaces cascade to all task tables.
  await c.query(`delete from public.workspaces where id in ($1,$2)`, [WS_A, WS_B]);
  await c.query(`delete from public.task_principals where external_id = $1`, [`user_${SUFFIX}`]);
  const { rows } = await c.query(
    `select count(*)::int n from public.workspaces where id in ($1,$2)`, [WS_A, WS_B]);
  console.log(`\n  [cleanup] test workspaces remaining: ${rows[0].n} (expect 0)`);
  await c.end();
}

console.log('');
if (!failures.length) console.log(`  All ${passed} task database assertions passed.\n`);
else { console.log(`  ${passed} passed, ${failures.length} FAILED:`); failures.forEach(f => console.log('   x ' + f)); console.log(''); process.exitCode = 1; }
}

// tsx compiles to CJS here, which rejects top-level await, so the suite runs inside main().
main().catch(err => { console.error(err?.message || err); process.exitCode = 1; });
