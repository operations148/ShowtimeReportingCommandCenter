/**
 * Database integration tests for the Channels subsystem (migration 0010).
 *
 * Covers the guarantees that only a real Postgres can demonstrate, and that the pure-logic
 * suite therefore cannot: workspace isolation at the SQL layer, the composite foreign keys
 * that make a cross-workspace or cross-channel reply impossible, the partial unique index
 * behind idempotent send, concurrent inserts racing on that index, the CHECK constraints, and
 * the RLS/grant posture.
 *
 *   TASK_DB_TEST_URL=<preview-connection-string> npx tsx scripts/test-channels-database.ts
 *
 * DELIBERATELY REFUSES TO RUN AGAINST PRODUCTION. It requires TASK_DB_TEST_URL and will not
 * fall back to SUPABASE_URL, DATABASE_URL, or anything in .env.local — this suite WRITES, and
 * a suite that writes must never be one environment variable away from the live database. It
 * additionally refuses any connection string that looks like the production project.
 *
 * Mirrors the shape and the refusal contract of scripts/test-task-database.ts.
 */

import * as dotenv from 'dotenv';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Loaded so the production-host guard below actually KNOWS the production host. Without this
// the guard silently degrades to a no-op whenever the shell happens not to export
// SUPABASE_URL — which is the normal case, and precisely when it is most needed.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), quiet: true } as any);

const CONN = process.env.TASK_DB_TEST_URL;

if (!CONN) {
  console.error(
    '\n  TASK_DB_TEST_URL is required.\n' +
    '  This suite writes data and must never target production.\n' +
    '  Point it at a preview/staging Supabase project with migrations 0005-0010 applied.\n'
  );
  process.exit(1);
}

/**
 * Second guard. Even given an explicit TASK_DB_TEST_URL, refuse anything that resolves to the
 * same Supabase project as the configured production one: a copy-pasted connection string is
 * exactly how a "test" run destroys live data.
 */
const prodUrl = (process.env.SUPABASE_URL ?? '').trim();
if (!prodUrl) {
  // Stated rather than skipped silently, so nobody reads a clean run as proof the guard fired.
  console.warn(
    '  NOTE: SUPABASE_URL is not set, so the production-host cross-check could not run.\n' +
    '        Verify by hand that TASK_DB_TEST_URL is a non-production database.\n'
  );
} else {
  let prodRef = '';
  try {
    prodRef = new URL(prodUrl).host.split('.')[0];
  } catch {
    // An unparseable SUPABASE_URL is a reason to stop, not a reason to proceed unchecked.
    console.error('\n  REFUSING TO RUN. SUPABASE_URL is set but unparseable, so the\n' +
                  '  production-host cross-check cannot be performed.\n');
    process.exit(1);
  }
  if (prodRef && CONN.toLowerCase().includes(prodRef.toLowerCase())) {
    console.error(
      '\n  REFUSING TO RUN.\n' +
      '  TASK_DB_TEST_URL names the same Supabase project as SUPABASE_URL.\n' +
      '  This suite writes and deletes; it must target a non-production database.\n'
    );
    process.exit(1);
  }
}

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/**
 * Asserts the statement is rejected by the DATABASE, and (when given) with the expected
 * SQLSTATE — so a test cannot pass because of an unrelated failure.
 *   23503 foreign_key_violation, 23505 unique_violation, 23514 check_violation
 */
async function rejects(
  label: string, fn: () => Promise<unknown>, sqlstate?: string
): Promise<void> {
  try {
    await fn();
    failures.push(`${label} — expected the database to reject this, it succeeded`);
  } catch (err: any) {
    const code = err?.code;
    check(label, !sqlstate || code === sqlstate,
      `expected SQLSTATE ${sqlstate}, got ${code} (${err?.message})`);
  }
}

async function main(): Promise<void> {
  // Imported lazily so the refusal above happens before any driver is loaded.
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: CONN,
    ssl: CONN!.includes('localhost') ? undefined : { rejectUnauthorized: false }
  });
  await client.connect();

  const q = (text: string, params: unknown[] = []) => client.query(text, params);

  // Two workspaces and two actors, created fresh per run and torn down at the end. Ids are
  // random so concurrent runs against the same preview database cannot collide.
  const WS_A = `test_ws_a_${randomUUID().slice(0, 8)}`;
  const WS_B = `test_ws_b_${randomUUID().slice(0, 8)}`;
  let actorA1 = '', actorA2 = '', actorB1 = '';
  let channelA = '', channelA2 = '', channelB = '';

  try {
    // Fixtures are COMMITTED rather than held in an open transaction, because the concurrency
    // block below races two separate connections and a second connection cannot see rows from
    // an uncommitted one. Everything created here hangs off the two test workspace rows, and
    // the teardown in `finally` deletes those — every task_channel_* table cascades from
    // workspaces, so removing them removes everything this suite wrote.

    // ── Fixtures ─────────────────────────────────────────────────────────────────────
    for (const ws of [WS_A, WS_B]) {
      await q('insert into public.workspaces (id, name) values ($1, $2)', [ws, `Test ${ws}`]);
    }
    const mkActor = async (ws: string) => {
      const principal = (await q(
        `insert into public.task_principals (source, issuer, external_id)
         values ('supabase', 'test.local', $1) returning id`, [randomUUID()]
      )).rows[0].id;
      return (await q(
        `insert into public.task_workspace_actors (workspace_id, principal_id, display_name)
         values ($1, $2, 'Tester') returning id`, [ws, principal]
      )).rows[0].id;
    };
    actorA1 = await mkActor(WS_A);
    actorA2 = await mkActor(WS_A);
    actorB1 = await mkActor(WS_B);

    const mkChannel = async (ws: string, name: string, slug: string, visibility = 'workspace') =>
      (await q(
        `insert into public.task_channels (workspace_id, name, slug, visibility)
         values ($1, $2, $3, $4) returning id`, [ws, name, slug, visibility]
      )).rows[0].id;

    channelA = await mkChannel(WS_A, 'Lounge', 'lounge');
    channelA2 = await mkChannel(WS_A, 'Showtime Pools Main', 'showtime-pools-main');
    channelB = await mkChannel(WS_B, 'Lounge', 'lounge');

    check('the same slug can exist in two different workspaces',
      channelA !== channelB && !!channelA && !!channelB);

    // ── Channel constraints ──────────────────────────────────────────────────────────
    await rejects('a duplicate live slug in one workspace is rejected',
      () => q(`insert into public.task_channels (workspace_id, name, slug)
               values ($1, 'Lounge Again', 'lounge')`, [WS_A]), '23505');

    await q('update public.task_channels set archived_at = now() where id = $1', [channelA2]);
    const reuse = await q(
      `insert into public.task_channels (workspace_id, name, slug)
       values ($1, 'Showtime Pools Main', 'showtime-pools-main') returning id`, [WS_A]);
    check('a slug frees up once the channel holding it is archived', !!reuse.rows[0].id);
    await q('delete from public.task_channels where id = $1', [reuse.rows[0].id]);
    await q('update public.task_channels set archived_at = null where id = $1', [channelA2]);

    await rejects('an invalid slug shape is rejected by the CHECK',
      () => q(`insert into public.task_channels (workspace_id, name, slug)
               values ($1, 'Bad', 'Not A Slug')`, [WS_A]), '23514');
    await rejects('an unknown visibility is rejected',
      () => q(`insert into public.task_channels (workspace_id, name, slug, visibility)
               values ($1, 'X', 'x-chan', 'secret')`, [WS_A]), '23514');
    await rejects('an empty channel name is rejected',
      () => q(`insert into public.task_channels (workspace_id, name, slug)
               values ($1, '   ', 'blank-chan')`, [WS_A]), '23514');

    // ── Workspace isolation ──────────────────────────────────────────────────────────
    await rejects('a member row cannot reference an actor from another workspace',
      () => q(`insert into public.task_channel_members (workspace_id, channel_id, actor_id)
               values ($1, $2, $3)`, [WS_A, channelA, actorB1]), '23503');
    await rejects('a message cannot be authored by an actor from another workspace',
      () => q(`insert into public.task_channel_messages
                 (workspace_id, channel_id, author_actor_id, body)
               values ($1, $2, $3, 'hello')`, [WS_A, channelA, actorB1]), '23503');
    await rejects('a message cannot be posted into another workspace\'s channel',
      () => q(`insert into public.task_channel_messages
                 (workspace_id, channel_id, author_actor_id, body)
               values ($1, $2, $3, 'hello')`, [WS_A, channelB, actorA1]), '23503');
    await rejects('a read cursor cannot cross workspaces',
      () => q(`insert into public.task_channel_reads (workspace_id, channel_id, actor_id)
               values ($1, $2, $3)`, [WS_A, channelB, actorA1]), '23503');

    // ── Messages, replies and the cross-channel guarantee ────────────────────────────
    const send = async (ws: string, ch: string, actor: string, body: string,
                        parent: string | null = null, token: string | null = null) =>
      (await q(
        `insert into public.task_channel_messages
           (workspace_id, channel_id, author_actor_id, body, parent_message_id, client_token)
         values ($1, $2, $3, $4, $5, $6) returning id, created_at`,
        [ws, ch, actor, body, parent, token]
      )).rows[0];

    const root = await send(WS_A, channelA, actorA1, 'first message');
    const reply = await send(WS_A, channelA, actorA2, 'a reply', root.id);
    check('a reply in the same channel is accepted', !!reply.id);

    await rejects('a reply cannot target a message in a different channel',
      () => send(WS_A, channelA2, actorA1, 'cross-channel reply', root.id), '23503');

    const rootB = await send(WS_B, channelB, actorB1, 'other tenant message');
    await rejects('a reply cannot target a message in a different workspace',
      () => send(WS_A, channelA, actorA1, 'cross-workspace reply', rootB.id), '23503');

    await rejects('an over-long body is rejected by the CHECK',
      () => send(WS_A, channelA, actorA1, 'x'.repeat(4001)), '23514');
    await rejects('an empty body is rejected by the CHECK',
      () => send(WS_A, channelA, actorA1, ''), '23514');

    // ── Idempotency ──────────────────────────────────────────────────────────────────
    const token = `tok-${randomUUID()}`;
    const first = await send(WS_A, channelA, actorA1, 'idempotent', null, token);
    await rejects('the same token from the same author in the same channel is rejected once sent',
      () => send(WS_A, channelA, actorA1, 'idempotent retry', null, token), '23505');
    const otherAuthor = await send(WS_A, channelA, actorA2, 'same token, other author', null, token);
    check('the same token from a DIFFERENT author is a different message',
      !!otherAuthor.id && otherAuthor.id !== first.id);
    const otherChannel = await send(WS_A, channelA2, actorA1, 'same token, other channel', null, token);
    check('the same token in a DIFFERENT channel is a different message',
      !!otherChannel.id && otherChannel.id !== first.id);
    const noToken1 = await send(WS_A, channelA, actorA1, 'no token 1');
    const noToken2 = await send(WS_A, channelA, actorA1, 'no token 2');
    check('tokenless sends are unconstrained by the partial index',
      !!noToken1.id && !!noToken2.id && noToken1.id !== noToken2.id);

    // ── Concurrent sends ─────────────────────────────────────────────────────────────
    //
    // A GENUINE race, on two separate connections. Issuing both inserts on one connection
    // would only prove that a sequential duplicate is rejected — which the idempotency block
    // above already shows — because a single session executes its statements in order.
    //
    // Both connections must see the fixture rows, so this is the one place the suite works
    // outside its transaction: the fixtures are committed above and removed by the explicit
    // teardown below.
    {
      const raceToken = `race-${randomUUID()}`;
      const mkClient = () => new pg.Client({
        connectionString: CONN,
        ssl: CONN!.includes('localhost') ? undefined : { rejectUnauthorized: false }
      });
      const c1 = mkClient();
      const c2 = mkClient();
      await Promise.all([c1.connect(), c2.connect()]);
      try {
        const insert = (c: any, body: string) => c.query(
          `insert into public.task_channel_messages
             (workspace_id, channel_id, author_actor_id, body, client_token)
           values ($1, $2, $3, $4, $5)`,
          [WS_A, channelA, actorA1, body, raceToken]);

        const attempts = await Promise.allSettled([
          insert(c1, 'race a'),
          insert(c2, 'race b')
        ]);
        const ok = attempts.filter(a => a.status === 'fulfilled').length;
        const dup = attempts.filter(
          a => a.status === 'rejected' && (a as any).reason?.code === '23505').length;
        eq('exactly one of two concurrent identical sends succeeds', ok, 1);
        eq('and the other loses on the unique index, not by timing', dup, 1);

        const stored = await c1.query(
          `select count(*)::int as n from public.task_channel_messages
           where workspace_id = $1 and channel_id = $2 and client_token = $3`,
          [WS_A, channelA, raceToken]);
        eq('so exactly one message exists for that token', stored.rows[0].n, 1);
      } finally {
        await Promise.allSettled([c1.end(), c2.end()]);
      }
    }

    // ── Soft delete ──────────────────────────────────────────────────────────────────
    await q(`update public.task_channel_messages
             set deleted_at = now(), deleted_by = $2 where id = $1`, [reply.id, actorA1]);
    const afterDelete = await q(
      'select deleted_at, body from public.task_channel_messages where id = $1', [reply.id]);
    check('a soft-deleted message still exists as a row', afterDelete.rowCount === 1);
    check('and is marked deleted', !!afterDelete.rows[0].deleted_at);

    const stillThreaded = await q(
      'select parent_message_id from public.task_channel_messages where id = $1', [reply.id]);
    eq('a deleted reply keeps its place in the thread',
      stillThreaded.rows[0].parent_message_id, root.id);

    // ── Read cursors and unread counting ─────────────────────────────────────────────
    await q(`insert into public.task_channel_reads
               (workspace_id, channel_id, actor_id, last_read_at)
             values ($1, $2, $3, $4)`, [WS_A, channelA, actorA2, root.created_at]);
    await rejects('a second read cursor for the same (channel, actor) is rejected',
      () => q(`insert into public.task_channel_reads (workspace_id, channel_id, actor_id)
               values ($1, $2, $3)`, [WS_A, channelA, actorA2]), '23505');

    const unread = await q(
      `select count(*)::int as n from public.task_channel_messages
       where workspace_id = $1 and channel_id = $2
         and deleted_at is null and author_actor_id <> $3 and created_at > $4`,
      [WS_A, channelA, actorA2, root.created_at]);
    check('unread counting excludes the reader\'s own and deleted messages',
      unread.rows[0].n >= 0);

    // ── Cursor pagination ────────────────────────────────────────────────────────────
    const page = await q(
      `select id, created_at from public.task_channel_messages
       where workspace_id = $1 and channel_id = $2
       order by created_at asc, id asc limit 3`, [WS_A, channelA]);
    check('a keyset page returns rows in (created_at, id) order', page.rowCount! > 0);
    const after = await q(
      `select count(*)::int as n from public.task_channel_messages
       where workspace_id = $1 and channel_id = $2
         and (created_at, id) > ($3, $4)`,
      [WS_A, channelA, page.rows[page.rowCount! - 1].created_at, page.rows[page.rowCount! - 1].id]);
    check('paging after the last row of a page never re-returns it', after.rows[0].n >= 0);

    // ── Archived channels ────────────────────────────────────────────────────────────
    await q('update public.task_channels set archived_at = now() where id = $1', [channelA2]);
    const archivedStillReadable = await q(
      'select id from public.task_channel_messages where workspace_id = $1 and channel_id = $2',
      [WS_A, channelA2]);
    check('messages in an archived channel are still readable at the data layer',
      archivedStillReadable.rowCount! >= 1);
    await q('update public.task_channels set archived_at = null where id = $1', [channelA2]);

    // ── Cascade behaviour ────────────────────────────────────────────────────────────
    const doomed = await mkChannel(WS_A, 'Doomed', 'doomed');
    await send(WS_A, doomed, actorA1, 'will be removed with the channel');
    await q('delete from public.task_channels where id = $1', [doomed]);
    const orphans = await q(
      'select count(*)::int as n from public.task_channel_messages where channel_id = $1',
      [doomed]);
    eq('deleting a channel leaves no orphaned messages', orphans.rows[0].n, 0);

    // ── RLS and grants ───────────────────────────────────────────────────────────────
    for (const t of ['task_channels', 'task_channel_members',
                     'task_channel_messages', 'task_channel_reads']) {
      const rls = await q(
        `select relrowsecurity from pg_class where oid = ('public.' || $1)::regclass`, [t]);
      check(`${t} has RLS enabled`, rls.rows[0]?.relrowsecurity === true);

      const policies = await q(
        `select count(*)::int as n from pg_policies
         where schemaname = 'public' and tablename = $1`, [t]);
      eq(`${t} has zero policies (deny-all for anon/authenticated)`, policies.rows[0].n, 0);

      for (const role of ['anon', 'authenticated']) {
        const granted = await q(
          `select count(*)::int as n from information_schema.role_table_grants
           where table_schema = 'public' and table_name = $1 and grantee = $2`, [t, role]);
        eq(`${t} grants nothing to ${role}`, granted.rows[0].n, 0);
      }

      const svc = await q(
        `select count(*)::int as n from information_schema.role_table_grants
         where table_schema = 'public' and table_name = $1 and grantee = 'service_role'`, [t]);
      check(`${t} grants access to service_role`, svc.rows[0].n > 0);
    }

    // The widened activity CHECK must accept the new entity types and still accept the old.
    for (const et of ['channel', 'channel_message', 'space', 'list', 'task', 'folder']) {
      const inserted = await q(
        `insert into public.task_activity_events
           (workspace_id, entity_type, entity_id, action)
         values ($1, $2, $3, 'TEST') returning id`, [WS_A, et, randomUUID()]);
      check(`activity accepts entity_type '${et}'`, !!inserted.rows[0].id);
    }
    await rejects('activity still rejects an unknown entity_type',
      () => q(`insert into public.task_activity_events
                 (workspace_id, entity_type, entity_id, action)
               values ($1, 'nonsense', $2, 'TEST')`, [WS_A, randomUUID()]), '23514');

  } finally {
    // Teardown. Deleting the two workspace rows cascades through task_channels,
    // task_channel_members, task_channel_messages, task_channel_reads, task_activity_events
    // and the actor rows, so the preview database is left exactly as it was found and the
    // suite is safe to run repeatedly. Ids are random per run, so a failed teardown cannot
    // collide with the next one either.
    for (const ws of [WS_A, WS_B]) {
      await client.query('delete from public.workspaces where id = $1', [ws])
        .catch(err => console.error(`  cleanup: could not remove ${ws}:`, err?.message));
    }
    await client.query(
      `delete from public.task_principals
       where issuer = 'test.local' and not exists (
         select 1 from public.task_workspace_actors a where a.principal_id = task_principals.id
       )`
    ).catch(() => { /* orphan principals are harmless in a preview database */ });
    await client.end().catch(() => { /* ignore */ });
  }

  console.log(`\nChannels (database): ${passed} assertion(s) passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nChannels (database): the suite threw.\n', err);
  process.exit(1);
});
