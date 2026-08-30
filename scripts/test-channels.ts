/**
 * Pure-logic tests for the Channels subsystem.
 *
 * No database, no network, no credentials. Everything asserted here is a decision the router
 * delegates to a pure function — what text is stored, what a cursor means, who may edit or
 * delete, how many sends are allowed, and how the poller behaves — so the security-critical
 * behaviour is pinned without needing a Postgres instance.
 *
 * The parts that genuinely require a database (workspace isolation at the SQL layer, the FK
 * that blocks cross-workspace replies, the unique index behind idempotency, concurrent
 * inserts) are covered by scripts/test-channels-database.ts, which refuses to run without a
 * non-production target.
 *
 *   npx tsx scripts/test-channels.ts
 */

import {
  slugifyChannelName, isValidSlug, sanitizeMessageBody, escapeHtml, optionalClientToken,
  encodeCursor, decodeCursor, compareCursor, cursorOf,
  trimToStrictlyAfter, trimToStrictlyBefore, parseMessageLimit,
  SlidingWindowRateLimiter, rateLimitKey, isWithinEditWindow, countUnread,
  MESSAGE_BODY_MAX, MESSAGE_PAGE_MAX, MESSAGE_PAGE_DEFAULT,
  RATE_LIMIT_MAX_SENDS, RATE_LIMIT_WINDOW_MS, EDIT_WINDOW_MS
} from '../src/tasks/channels.js';
import { ChannelPoller, backoffDelay } from '../src/tasks/channelPolling.js';
import * as perm from '../src/tasks/permissions.js';
import { UserRole } from '../src/types.js';

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return; }
  failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  check(label,
    Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
/** Asserts the callable throws, and that the thrown error carries the expected code. */
function throwsCode(label: string, fn: () => unknown, code = 'TASK_VALIDATION_FAILED'): void {
  try {
    fn();
    failures.push(`${label} — expected a throw, got a value`);
  } catch (err: any) {
    check(label, err?.code === code, `expected code ${code}, got ${err?.code} (${err?.message})`);
  }
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

// ── Slugs ──────────────────────────────────────────────────────────────────────────────

eq('a simple name slugifies', slugifyChannelName('Lounge'), 'lounge');
eq('spaces become hyphens', slugifyChannelName('Showtime Pools Main'), 'showtime-pools-main');
eq('a leading # is dropped, not encoded', slugifyChannelName('# Lounge'), 'lounge');
eq('punctuation collapses to a single hyphen', slugifyChannelName('Ops -- Team!!  Chat'), 'ops-team-chat');
eq('diacritics fold so Cafe and Café cannot both exist live',
  slugifyChannelName('Café'), slugifyChannelName('Cafe'));
eq('case is normalised', slugifyChannelName('LOUNGE'), 'lounge');
eq('leading and trailing separators are trimmed', slugifyChannelName('--Lounge--'), 'lounge');
check('a long name is truncated within the column bound',
  slugifyChannelName('a'.repeat(200)).length <= 80);
check('a truncated slug never ends in a hyphen',
  !slugifyChannelName(`${'a'.repeat(78)} bcdef`).endsWith('-'));
check('every generated slug satisfies the column CHECK',
  ['Lounge', '# Showtime Pools Main', 'Café', '99 Problems', 'a-b_c d']
    .every(n => isValidSlug(slugifyChannelName(n))));
throwsCode('a name with no alphanumerics is rejected', () => slugifyChannelName('!!!'));
throwsCode('an emoji-only name is rejected', () => slugifyChannelName('🎉🎉'));
check('a slug starting with a hyphen is invalid', !isValidSlug('-lounge'));
check('an uppercase slug is invalid', !isValidSlug('Lounge'));

// ── Message sanitisation ───────────────────────────────────────────────────────────────

eq('ordinary text survives untouched', sanitizeMessageBody('Hello team'), 'Hello team');
eq('surrounding whitespace is trimmed', sanitizeMessageBody('  hi  '), 'hi');
eq('CRLF is normalised to LF', sanitizeMessageBody('a\r\nb'), 'a\nb');
eq('a lone CR is normalised too', sanitizeMessageBody('a\rb'), 'a\nb');
eq('newlines and tabs are preserved', sanitizeMessageBody('a\n\tb'), 'a\n\tb');
eq('long blank-line runs are capped', sanitizeMessageBody('a\n\n\n\n\n\n\nb'), 'a\n\n\nb');

// Script payloads are stored as INERT TEXT: not stripped (that would corrupt real prose),
// not escaped on the way in (that would double-escape at the React boundary), and never
// executable because nothing renders them as HTML.
eq('a script payload round-trips as literal text',
  sanitizeMessageBody('<script>alert(1)</script>'), '<script>alert(1)</script>');
eq('ordinary prose containing < and > is not mangled',
  sanitizeMessageBody('if a < b && b > c then'), 'if a < b && b > c then');
eq('an img onerror payload is stored verbatim as text',
  sanitizeMessageBody('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');

// Invisible and direction-controlling characters ARE removed: unlike `<`, they have no
// legitimate use in a chat message and can make text display differently from what it says.
//
// Built from escapes rather than pasted literally. A source file containing raw bidi
// overrides is itself unreadable, and any tool that re-normalises or re-encodes it would
// silently destroy the very cases under test.
const CH = (code: number) => String.fromCharCode(code);

const INVISIBLES: [string, number][] = [
  ['NUL', 0x0000],
  ['a C0 control (SOH)', 0x0001],
  ['a C0 control (VT)', 0x000b],
  ['DEL', 0x007f],
  ['a C1 control (NEL)', 0x0085],
  ['a zero-width space', 0x200b],
  ['a zero-width joiner', 0x200d],
  ['a left-to-right mark', 0x200e],
  ['a line separator', 0x2028],
  ['a paragraph separator', 0x2029],
  ['a right-to-left override', 0x202e],
  ['a bidi isolate', 0x2066],
  ['a byte-order mark', 0xfeff]
];

for (const [label, code] of INVISIBLES) {
  eq(`${label} is stripped from a message body`,
    sanitizeMessageBody(`a${CH(code)}b`), 'ab');
}

check('a message made only of invisibles is rejected as empty', (() => {
  try { sanitizeMessageBody(CH(0x200b) + CH(0xfeff)); return false; } catch { return true; }
})());

// The concrete attack: a right-to-left override makes displayed text read in a different
// order than the characters it is made of, so a message can be made to LOOK like it says
// something other than what it stores.
check('a bidi override cannot survive into a stored body',
  !new RegExp("[\\u202a-\\u202e\\u2066-\\u2069]").test(
    sanitizeMessageBody(`transfer ${CH(0x202e)}001${CH(0x202c)} usd`)));

check('newline and tab are the only control characters kept',
  sanitizeMessageBody(`a${CH(0x0009)}b${CH(0x000a)}c`) === `a\tb\nc`);

throwsCode('an empty body is rejected', () => sanitizeMessageBody(''));
throwsCode('a whitespace-only body is rejected', () => sanitizeMessageBody('   \n  '));
throwsCode('a non-string body is rejected', () => sanitizeMessageBody(42));
throwsCode('a null body is rejected', () => sanitizeMessageBody(null));
eq('a body exactly at the limit is accepted',
  sanitizeMessageBody('x'.repeat(MESSAGE_BODY_MAX)).length, MESSAGE_BODY_MAX);
throwsCode('a body one character over the limit is rejected',
  () => sanitizeMessageBody('x'.repeat(MESSAGE_BODY_MAX + 1)));

// ── HTML escaping at the rendering boundary ────────────────────────────────────────────

eq('escapeHtml neutralises a script tag',
  escapeHtml('<script>alert(1)</script>'),
  '&lt;script&gt;alert(1)&lt;&#47;script&gt;');
eq('escapeHtml escapes ampersands first, without double-escaping',
  escapeHtml('a & b'), 'a &amp; b');
eq('escapeHtml escapes both quote styles for attribute safety',
  escapeHtml(`a"b'c`), 'a&quot;b&#39;c');
check('escaped output contains no raw angle bracket',
  !/[<>]/.test(escapeHtml('<img src=x onerror=alert(1)>')));
eq('escapeHtml leaves ordinary text alone', escapeHtml('Hello team'), 'Hello team');

// ── Idempotency tokens ─────────────────────────────────────────────────────────────────

eq('a missing token is null', optionalClientToken(undefined), null);
eq('an empty token is null', optionalClientToken(''), null);
eq('a valid token is returned trimmed', optionalClientToken('  abc12345  '), 'abc12345');
eq('a uuid is a valid token',
  optionalClientToken('11111111-1111-4111-8111-111111111111'),
  '11111111-1111-4111-8111-111111111111');
throwsCode('a too-short token is rejected', () => optionalClientToken('abc'));
throwsCode('a too-long token is rejected', () => optionalClientToken('a'.repeat(101)));
throwsCode('a token with unsafe characters is rejected', () => optionalClientToken('abc/../def'));
throwsCode('a non-string token is rejected', () => optionalClientToken({}));

// ── Cursors ────────────────────────────────────────────────────────────────────────────

const T1 = '2026-08-01T10:00:00.000Z';
const T2 = '2026-08-01T10:00:01.000Z';

{
  const c = { createdAt: T1, id: UUID_A };
  const round = decodeCursor(encodeCursor(c))!;
  eq('a cursor round-trips', round, c);
  check('an encoded cursor is opaque (no raw timestamp)', !encodeCursor(c).includes('2026'));
}
eq('an absent cursor decodes to null', decodeCursor(undefined), null);
eq('an empty cursor decodes to null', decodeCursor(''), null);
throwsCode('a malformed cursor is rejected', () => decodeCursor('not-a-cursor'));
throwsCode('a cursor with a bad uuid is rejected',
  () => decodeCursor(Buffer.from(`${T1}|nope`, 'utf8').toString('base64url')));
throwsCode('a cursor with a bad timestamp is rejected',
  () => decodeCursor(Buffer.from(`nope|${UUID_A}`, 'utf8').toString('base64url')));
throwsCode('a non-string cursor is rejected', () => decodeCursor(123));

check('earlier timestamps sort first',
  compareCursor({ createdAt: T1, id: UUID_B }, { createdAt: T2, id: UUID_A }) < 0);
check('ties break on id',
  compareCursor({ createdAt: T1, id: UUID_A }, { createdAt: T1, id: UUID_B }) < 0);
eq('a cursor equals itself',
  compareCursor({ createdAt: T1, id: UUID_A }, { createdAt: T1, id: UUID_A }), 0);

// The boundary-trimming that makes "poll after cursor" exact, and therefore duplicate-free.
{
  const rows = [
    { created_at: T1, id: UUID_A },
    { created_at: T1, id: UUID_B },   // same timestamp, later id
    { created_at: T2, id: UUID_C }
  ];
  const at = cursorOf(rows[0]);
  eq('trimming drops the cursor row itself',
    trimToStrictlyAfter(rows, at).map(r => r.id), [UUID_B, UUID_C]);
  eq('trimming keeps same-timestamp rows that sort after the cursor',
    trimToStrictlyAfter(rows, cursorOf(rows[1])).map(r => r.id), [UUID_C]);
  eq('trimming with no cursor is a no-op', trimToStrictlyAfter(rows, null).length, 3);
  eq('before-trimming drops the cursor row and everything after',
    trimToStrictlyBefore(rows, cursorOf(rows[2])).map(r => r.id), [UUID_A, UUID_B]);
  eq('polling from the newest cursor yields nothing',
    trimToStrictlyAfter(rows, cursorOf(rows[2])).length, 0);
}

eq('the default page size applies when none is given',
  parseMessageLimit(undefined), MESSAGE_PAGE_DEFAULT);
eq('a requested limit is honoured', parseMessageLimit(10), 10);
eq('an over-large limit is capped', parseMessageLimit(100000), MESSAGE_PAGE_MAX);
eq('a negative limit falls back to the default', parseMessageLimit(-5), MESSAGE_PAGE_DEFAULT);
eq('a non-numeric limit falls back to the default', parseMessageLimit('abc'), MESSAGE_PAGE_DEFAULT);
eq('a fractional limit falls back to the default', parseMessageLimit(2.5), MESSAGE_PAGE_DEFAULT);

// ── Rate limiting ──────────────────────────────────────────────────────────────────────

{
  const rl = new SlidingWindowRateLimiter(RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_SENDS);
  const key = rateLimitKey('ws_a', UUID_A);
  const t0 = 1_000_000;

  let allowed = 0;
  for (let i = 0; i < RATE_LIMIT_MAX_SENDS; i++) {
    if (rl.check(key, t0 + i).allowed) allowed++;
  }
  eq('the full quota is allowed', allowed, RATE_LIMIT_MAX_SENDS);

  const over = rl.check(key, t0 + RATE_LIMIT_MAX_SENDS);
  check('the next send is refused', over.allowed === false);
  check('the refusal says how long to wait', over.retryAfterMs > 0);
  check('and no longer than the window', over.retryAfterMs <= RATE_LIMIT_WINDOW_MS);

  // A different actor in the same workspace is unaffected: the limit is per-actor.
  check('another actor is not limited by the first',
    rl.check(rateLimitKey('ws_a', UUID_B), t0 + RATE_LIMIT_MAX_SENDS).allowed);
  // The same actor id in a DIFFERENT workspace is a different bucket.
  check('the same actor in another workspace is a separate bucket',
    rl.check(rateLimitKey('ws_b', UUID_A), t0 + RATE_LIMIT_MAX_SENDS).allowed);

  check('the window slides: the quota frees up once it has passed',
    rl.check(key, t0 + RATE_LIMIT_WINDOW_MS + 1).allowed);

  eq('rateLimitKey is workspace-scoped', rateLimitKey('ws_a', UUID_A), `ws_a:${UUID_A}`);
  check('two workspaces never share a key',
    rateLimitKey('ws_a', UUID_A) !== rateLimitKey('ws_b', UUID_A));
}

// ── Edit window ────────────────────────────────────────────────────────────────────────

{
  const now = Date.parse('2026-08-01T12:00:00.000Z');
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  check('a message just sent is editable', isWithinEditWindow(at(0), now));
  check('a message inside the window is editable', isWithinEditWindow(at(EDIT_WINDOW_MS - 1000), now));
  check('a message exactly at the boundary is editable', isWithinEditWindow(at(EDIT_WINDOW_MS), now));
  check('a message past the window is not', !isWithinEditWindow(at(EDIT_WINDOW_MS + 1), now));
  check('an unparseable timestamp is never editable', !isWithinEditWindow('nonsense', now));
}

// ── Permissions ────────────────────────────────────────────────────────────────────────

const MANAGERS = [UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN];
const CONTRIBUTORS = [UserRole.SALES_REP, UserRole.TEAM_MEMBER];

function allows(fn: () => void): boolean {
  try { fn(); return true; } catch { return false; }
}

check('every manager role can manage channels',
  MANAGERS.every(r => allows(() => perm.assertCanManageChannels(r))));
check('no contributor can manage channels',
  CONTRIBUTORS.every(r => !allows(() => perm.assertCanManageChannels(r))));
check('read-only cannot manage channels',
  !allows(() => perm.assertCanManageChannels(UserRole.READ_ONLY)));

check('managers and contributors can post',
  [...MANAGERS, ...CONTRIBUTORS].every(r => allows(() => perm.assertCanPostMessage(r))));
check('read-only cannot post',
  !allows(() => perm.assertCanPostMessage(UserRole.READ_ONLY)));

{
  const mine = { author_actor_id: UUID_A };
  const theirs = { author_actor_id: UUID_B };

  check('an author can edit their own message',
    allows(() => perm.assertCanEditMessage(UserRole.TEAM_MEMBER, UUID_A, mine)));
  check('nobody can edit someone else\'s message',
    CONTRIBUTORS.every(r => !allows(() => perm.assertCanEditMessage(r, UUID_A, theirs))));
  // The moderation contract: a manager may REMOVE any message but may never REWRITE one.
  check('not even a manager can edit another author\'s message',
    MANAGERS.every(r => !allows(() => perm.assertCanEditMessage(r, UUID_A, theirs))));
  check('a read-only author cannot edit even their own message',
    !allows(() => perm.assertCanEditMessage(UserRole.READ_ONLY, UUID_A, mine)));

  check('an author can delete their own message',
    allows(() => perm.assertCanDeleteMessage(UserRole.TEAM_MEMBER, UUID_A, mine)));
  check('a contributor cannot delete another author\'s message',
    CONTRIBUTORS.every(r => !allows(() => perm.assertCanDeleteMessage(r, UUID_A, theirs))));
  check('a manager can moderate any message',
    MANAGERS.every(r => allows(() => perm.assertCanDeleteMessage(r, UUID_A, theirs))));
  check('read-only cannot delete anything',
    !allows(() => perm.assertCanDeleteMessage(UserRole.READ_ONLY, UUID_A, mine)));
}

{
  const open = { visibility: 'workspace' };
  const closed = { visibility: 'restricted' };

  check('a workspace channel is readable by every role, read-only included',
    [...MANAGERS, ...CONTRIBUTORS, UserRole.READ_ONLY]
      .every(r => allows(() => perm.assertCanReadChannel(r, open, false))));
  check('a restricted channel is closed to a non-member',
    CONTRIBUTORS.every(r => !allows(() => perm.assertCanReadChannel(r, closed, false))));
  check('a restricted channel is open to a member',
    CONTRIBUTORS.every(r => allows(() => perm.assertCanReadChannel(r, closed, true))));
  check('read-only members can read a restricted channel',
    allows(() => perm.assertCanReadChannel(UserRole.READ_ONLY, closed, true)));
  check('read-only non-members cannot',
    !allows(() => perm.assertCanReadChannel(UserRole.READ_ONLY, closed, false)));
  check('a manager can read a restricted channel without a membership row',
    MANAGERS.every(r => allows(() => perm.assertCanReadChannel(r, closed, false))));
}

// ── Unread counting ────────────────────────────────────────────────────────────────────

{
  const msg = (t: string, author: string, deleted: string | null = null) =>
    ({ created_at: t, author_actor_id: author, deleted_at: deleted });
  const stream = [
    msg('2026-08-01T10:00:00.000Z', UUID_B),
    msg('2026-08-01T11:00:00.000Z', UUID_B),
    msg('2026-08-01T12:00:00.000Z', UUID_A),                                  // mine
    msg('2026-08-01T13:00:00.000Z', UUID_B, '2026-08-01T13:05:00.000Z'),      // moderated
    msg('2026-08-01T14:00:00.000Z', UUID_B)
  ];

  eq('with no read cursor, every other author\'s live message is unread',
    countUnread(stream, null, UUID_A), 3);
  eq('a read cursor excludes everything at or before it',
    countUnread(stream, '2026-08-01T11:00:00.000Z', UUID_A), 1);
  eq('reading to the end clears the count',
    countUnread(stream, '2026-08-01T14:00:00.000Z', UUID_A), 0);
  eq('my own messages never count as unread',
    countUnread([msg('2026-08-01T15:00:00.000Z', UUID_A)], null, UUID_A), 0);
  eq('a deleted message never counts, so moderation clears its badge',
    countUnread([msg('2026-08-01T15:00:00.000Z', UUID_B, '2026-08-01T15:01:00.000Z')], null, UUID_A), 0);
  eq('an empty channel is zero', countUnread([], null, UUID_A), 0);
}

// ── Polling controller ─────────────────────────────────────────────────────────────────

check('backoff grows exponentially', (() => {
  const fixed = () => 1;   // no jitter, so the growth curve is exact
  const d1 = backoffDelay(1, 1000, 60000, fixed);
  const d2 = backoffDelay(2, 1000, 60000, fixed);
  const d3 = backoffDelay(3, 1000, 60000, fixed);
  return d1 === 1000 && d2 === 2000 && d3 === 4000;
})());
eq('backoff is capped', backoffDelay(30, 1000, 60000, () => 1), 60000);
check('backoff is jittered downward, never upward', (() => {
  const lo = backoffDelay(3, 1000, 60000, () => 0);
  const hi = backoffDelay(3, 1000, 60000, () => 1);
  return lo === 2000 && hi === 4000 && lo < hi;
})());

/** Drives a poller with a controllable clock, so no test ever waits on a real timer. */
function makeHarness(opts: { visible?: boolean } = {}) {
  // A sparse queue: clearTimer() blanks a slot rather than compacting, so indices stay
  // stable and a cancelled timer genuinely never fires — otherwise the harness would
  // model a clearTimeout that does nothing, and could hide a real scheduling bug.
  const pending: ({ fn: () => void; ms: number } | null)[] = [];
  let visible = opts.visible ?? true;
  const calls: (string | null)[] = [];
  const delivered: string[] = [];
  const aborted: boolean[] = [];
  let responder: (cursor: string | null) => Promise<{ messages: any[]; nextAfter: string | null }> =
    async () => ({ messages: [], nextAfter: null });

  const poller = new ChannelPoller({
    fetchAfter: (cursor, signal) => {
      calls.push(cursor);
      signal.addEventListener('abort', () => aborted.push(true));
      return responder(cursor);
    },
    onMessages: msgs => { for (const m of msgs) delivered.push(m.id); },
    isVisible: () => visible,
    intervalMs: 1000,
    setTimer: (fn, ms) => { pending.push({ fn, ms }); return pending.length - 1; },
    clearTimer: (h: number) => { pending[h] = null; }
  });

  return {
    poller, calls, delivered, aborted,
    setVisible(v: boolean) { visible = v; },
    respondWith(fn: typeof responder) { responder = fn; },
    /** Runs every timer queued so far, once. */
    async drain() {
      const due = pending.splice(0, pending.length);
      for (const t of due) if (t) t.fn();
      await Promise.resolve();
      await Promise.resolve();
    },
    lastDelay() {
      const live = pending.filter(Boolean);
      return live.length ? live[live.length - 1]!.ms : null;
    }
  };
}

/**
 * The poller scenarios. Wrapped in a function because the transform this project uses
 * emits CommonJS, where top-level await is not available.
 */
async function pollerTests(): Promise<void> {

  {
    const h = makeHarness();
    h.respondWith(async () => ({
      messages: [{ id: 'm1', cursor: 'c1' }, { id: 'm2', cursor: 'c2' }],
      nextAfter: 'c2'
    }));

    h.poller.start();
    await Promise.resolve(); await Promise.resolve();

    eq('the first poll sends no cursor', h.calls[0], null);
    eq('new messages are delivered', h.delivered, ['m1', 'm2']);
    eq('the cursor advances to the last message', h.poller.currentCursor, 'c2');

    // A redelivery of the same ids (a replayed cursor, a retried request) must not duplicate.
    h.respondWith(async () => ({
      messages: [{ id: 'm2', cursor: 'c2' }, { id: 'm3', cursor: 'c3' }],
      nextAfter: 'c3'
    }));
    await h.drain();
    eq('an already-seen message is never delivered twice', h.delivered, ['m1', 'm2', 'm3']);
    eq('the next poll sends the latest cursor', h.calls[1], 'c2');

    h.poller.stop();
    check('stopping ends the run', !h.poller.isRunning);
  }

  {
    const h = makeHarness({ visible: false });
    h.poller.start();
    await Promise.resolve(); await Promise.resolve();
    eq('a hidden tab issues no request at all', h.calls.length, 0);

    h.setVisible(true);
    h.poller.notifyVisibilityChange();
    await Promise.resolve(); await Promise.resolve();
    eq('becoming visible polls immediately rather than waiting out the interval', h.calls.length, 1);
  }

  {
    const h = makeHarness();
    let fail = true;
    h.respondWith(async () => {
      if (fail) throw new Error('network down');
      return { messages: [{ id: 'ok1', cursor: 'k1' }], nextAfter: 'k1' };
    });

    h.poller.start();
    await Promise.resolve(); await Promise.resolve();
    eq('a failure puts the poller into backoff', h.poller.currentState, 'backoff');
    const first = h.lastDelay()!;

    await h.drain();
    const second = h.lastDelay()!;
    check('consecutive failures back off further', second >= first, `${first} -> ${second}`);

    fail = false;
    await h.drain();
    eq('a success delivers again', h.delivered, ['ok1']);
    eq('and returns to the base interval', h.lastDelay(), 1000);
    h.poller.stop();
  }

  {
    // A response that lands after stop() must not be applied — the guarantee that closing a
    // channel cannot leak its messages into whatever the user opens next.
    const h = makeHarness();
    let release!: (v: any) => void;
    h.respondWith(() => new Promise(res => { release = res; }));

    h.poller.start();
    await Promise.resolve();
    h.poller.stop();
    check('stopping aborts the request in flight', h.aborted.length === 1);

    release({ messages: [{ id: 'late', cursor: 'cl' }], nextAfter: 'cl' });
    await Promise.resolve(); await Promise.resolve();
    eq('a response arriving after stop is discarded', h.delivered, []);
    eq('and the cursor is not advanced by it', h.poller.currentCursor, null);
  }

  {
    const h = makeHarness();
    h.poller.seed([{ id: 'seen1', cursor: 'cs1' }], 'cs1');
    h.respondWith(async () => ({
      messages: [{ id: 'seen1', cursor: 'cs1' }, { id: 'new1', cursor: 'cs2' }],
      nextAfter: 'cs2'
    }));
    h.poller.start();
    await Promise.resolve(); await Promise.resolve();
    eq('seeding sends the seeded cursor', h.calls[0], 'cs1');
    eq('a seeded message is not re-delivered', h.delivered, ['new1']);
    h.poller.stop();
  }

  {
    const h = makeHarness();
    h.respondWith(async () => ({ messages: [], nextAfter: null }));
    h.poller.start();
    await Promise.resolve(); await Promise.resolve();
    eq('an empty poll delivers nothing', h.delivered, []);
    eq('and does not move the cursor past unseen messages', h.poller.currentCursor, null);
    h.poller.stop();
  }


}

pollerTests().then(() => {
  console.log(`\nChannels (pure logic): ${passed} assertion(s) passed, ${failures.length} failed.`);
  if (failures.length) {
    for (const f of failures) console.error(`  FAIL  ${f}`);
    process.exit(1);
  }
}).catch(err => {
  console.error('Channels (pure logic): the poller suite threw.', err);
  process.exit(1);
});
