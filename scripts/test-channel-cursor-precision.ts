/**
 * Regression tests for the microsecond cursor-precision defect found by the Production canary.
 *
 * THE DEFECT: PostgreSQL stores created_at with MICROSECOND precision. The previous cursor path
 * converted it through a JavaScript Date (millisecond), so two messages inside the same
 * millisecond collapsed to one cursor timestamp. The (created_at, id) tie-break was then
 * evaluated against the wrong boundary and a message that SQL ordered AFTER the cursor could
 * compare as before it — never delivered, while the cursor advanced past it.
 *
 * Every case below is deterministic: fixed timestamp literals, no clocks, no sleeps, no
 * database. Each one fails against the millisecond implementation and passes against the
 * microsecond-exact one.
 *
 *   npx tsx scripts/test-channel-cursor-precision.ts
 */

import {
  encodeCursor, decodeCursor, compareCursor, cursorOf, parseInstant, isOrderableTimestamp,
  trimToStrictlyAfter, trimToStrictlyBefore, countUnread,
  CURSOR_VERSION, CURSOR_MAX_ENCODED_LENGTH
} from '../src/tasks/channels.js';

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
function throwsCode(label: string, fn: () => unknown, code = 'TASK_VALIDATION_FAILED'): void {
  try { fn(); failures.push(`${label} — expected a throw, got a value`); }
  catch (err: any) {
    check(label, err?.code === code, `expected ${code}, got ${err?.code} (${err?.message})`);
  }
}

/** UUIDs chosen so B sorts LEXICALLY BEFORE A — that is what exposes a wrong tie-break. */
const ID_A = 'ffffffff-1111-4111-8111-111111111111';
const ID_B = '00000000-2222-4222-8222-222222222222';
const ID_C = '77777777-3333-4333-8333-333333333333';

// The timestamps named in the brief, in the exact form PostgREST emits them.
const T_123456 = '2026-08-31T14:12:37.123456+00:00';
const T_123455 = '2026-08-31T14:12:37.123455+00:00';
const T_123000 = '2026-08-31T14:12:37.123000+00:00';
/** Postgres trims trailing zeros, so the SAME instant as T_123000 also arrives like this. */
const T_123    = '2026-08-31T14:12:37.123+00:00';

const msg = (id: string, created_at: string, author = 'author-1', deleted: string | null = null) =>
  ({ id, created_at, author_actor_id: author, deleted_at: deleted });

// ── 1. Microsecond parsing ─────────────────────────────────────────────────────────────

check('a 6-digit fraction keeps every microsecond',
  parseInstant(T_123456)!.micros === 123456);
check('a 1-microsecond difference is visible',
  parseInstant(T_123456)!.micros - parseInstant(T_123455)!.micros === 1);
check('a trimmed fraction is right-padded, not left-padded',
  parseInstant(T_123)!.micros === 123000);
eq('".123" and ".123000" are the SAME instant',
  compareCursor({ createdAt: T_123, id: ID_A }, { createdAt: T_123000, id: ID_A }), 0);
check('a missing fraction is zero microseconds',
  parseInstant('2026-08-31T14:12:37+00:00')!.micros === 0);
check('a space separator is accepted (Postgres ::text form)',
  parseInstant('2026-08-31 14:12:37.123456+00')!.micros === 123456);
check('Z is accepted as UTC',
  parseInstant('2026-08-31T14:12:37.123456Z')!.seconds ===
  parseInstant(T_123456)!.seconds);
check('a non-UTC offset is normalised to the same instant',
  parseInstant('2026-08-31T16:12:37.123456+02:00')!.seconds ===
  parseInstant(T_123456)!.seconds);
check('a +HHMM offset is accepted',
  parseInstant('2026-08-31T16:12:37.123456+0200')!.seconds ===
  parseInstant(T_123456)!.seconds);
check('garbage is not orderable', !isOrderableTimestamp('not-a-timestamp'));
check('an impossible month is not orderable', !isOrderableTimestamp('2026-13-31T14:12:37Z'));
check('a non-string is not orderable', !isOrderableTimestamp(12345));

// ── 2. THE DEFECT: same millisecond, different microseconds ────────────────────────────
// Under the millisecond implementation both sides truncated to ...123Z, the comparison tied,
// and the uuid tie-break ordered B before A — the opposite of the SQL order.
{
  const a = { createdAt: T_123455, id: ID_A };   // SQL: earlier
  const b = { createdAt: T_123456, id: ID_B };   // SQL: later, but uuid sorts first
  check('the earlier microsecond compares as earlier', compareCursor(a, b) < 0);
  check('the later microsecond compares as later', compareCursor(b, a) > 0);
  check('the uuid tie-break does NOT override the microsecond',
    compareCursor(a, b) < 0 && ID_B < ID_A);
}

// The end-to-end consequence: polling from A must still deliver B.
{
  const rows = [msg(ID_A, T_123455), msg(ID_B, T_123456)];
  const after = trimToStrictlyAfter(rows, cursorOf(rows[0]));
  eq('polling from the earlier message delivers the later one',
    after.map(r => r.id), [ID_B]);
  check('and never re-delivers the cursor row itself', !after.some(r => r.id === ID_A));
}

// ── 3. Identical timestamps, different uuids: uuid IS the tie-break ────────────────────
{
  const rows = [msg(ID_B, T_123456), msg(ID_C, T_123456), msg(ID_A, T_123456)]
    .sort((x, y) => compareCursor(cursorOf(x), cursorOf(y)));
  eq('rows with one timestamp order by uuid ascending',
    rows.map(r => r.id), [ID_B, ID_C, ID_A]);
  const after = trimToStrictlyAfter(rows, cursorOf(rows[0]));
  eq('paging from the first delivers exactly the other two',
    after.map(r => r.id), [ID_C, ID_A]);
  eq('paging from the last delivers nothing',
    trimToStrictlyAfter(rows, cursorOf(rows[2])).length, 0);
}

// ── 4. Full traversal at page sizes 1, 2 and 3: no skips, no duplicates ────────────────
{
  // Five messages: two pairs inside one millisecond, one distinct. Deliberately built so the
  // uuid order fights the microsecond order on every colliding pair.
  const stream = [
    msg(ID_A, '2026-08-31T14:12:37.123455+00:00'),
    msg(ID_B, '2026-08-31T14:12:37.123456+00:00'),
    msg(ID_C, '2026-08-31T14:12:37.124000+00:00'),
    msg('11111111-4444-4444-8444-444444444444', '2026-08-31T14:12:38.000001+00:00'),
    msg('00000000-5555-4555-8555-555555555555', '2026-08-31T14:12:38.000002+00:00')
  ];
  // The SQL order: created_at asc, id asc.
  const sqlOrder = [...stream].sort((x, y) => compareCursor(cursorOf(x), cursorOf(y)));

  for (const pageSize of [1, 2, 3]) {
    const seen: string[] = [];
    let cursor = null as ReturnType<typeof cursorOf> | null;
    let guard = 0;

    while (guard++ < 50) {
      // Mirrors the router: an inclusive server-side bound, then the exact in-memory trim.
      const fromServer = cursor
        ? sqlOrder.filter(r => {
            const i = parseInstant(r.created_at)!, c = parseInstant(cursor!.createdAt)!;
            return i.seconds > c.seconds ||
              (i.seconds === c.seconds && i.micros >= c.micros);
          })
        : sqlOrder;
      const page = trimToStrictlyAfter(fromServer, cursor).slice(0, pageSize);
      if (page.length === 0) break;
      seen.push(...page.map(r => r.id));
      cursor = cursorOf(page[page.length - 1]);
    }

    eq(`page size ${pageSize}: every message delivered exactly once, in SQL order`,
      seen, sqlOrder.map(r => r.id));
    eq(`page size ${pageSize}: no duplicates`, new Set(seen).size, seen.length);
    eq(`page size ${pageSize}: nothing skipped`, seen.length, stream.length);
  }
}

// ── 5. Polling from the latest cursor, with new arrivals at the boundary ───────────────
{
  const initial = [msg(ID_A, T_123455), msg(ID_B, T_123456)];
  const latest = cursorOf(initial[1]);
  eq('an idle poll from the newest cursor returns nothing',
    trimToStrictlyAfter(initial, latest).length, 0);

  // A new message arrives one microsecond later, with a uuid that sorts first.
  const arrived = msg('00000000-6666-4666-8666-666666666666', '2026-08-31T14:12:37.123457+00:00');
  const next = trimToStrictlyAfter([...initial, arrived], latest);
  eq('a message one microsecond after the cursor IS delivered',
    next.map(r => r.id), [arrived.id]);

  // A message that arrives with an EARLIER timestamp than the cursor is not re-delivered.
  const late = msg('99999999-7777-4777-8777-777777777777', T_123455);
  eq('a straggler older than the cursor is not delivered again',
    trimToStrictlyAfter([...initial, late], latest).length, 0);
}

// ── 6. Backward paging is the exact mirror ────────────────────────────────────────────
{
  const rows = [msg(ID_A, T_123455), msg(ID_B, T_123456), msg(ID_C, '2026-08-31T14:12:37.123457+00:00')];
  const before = trimToStrictlyBefore(rows, cursorOf(rows[2]));
  eq('paging before a cursor excludes it and returns the earlier rows',
    before.map(r => r.id), [ID_A, ID_B]);
  eq('paging before the first row returns nothing',
    trimToStrictlyBefore(rows, cursorOf(rows[0])).length, 0);
}

// ── 7. Read-cursor advancement at a microsecond boundary ──────────────────────────────
{
  const reader = 'reader-actor';
  const stream = [
    msg(ID_A, T_123455, 'someone-else'),
    msg(ID_B, T_123456, 'someone-else'),
    msg(ID_C, '2026-08-31T14:12:37.123457+00:00', 'someone-else')
  ];
  eq('with no read cursor everything is unread', countUnread(stream, null, reader), 3);
  // Reading up to the FIRST message must leave exactly two unread. Under the millisecond
  // implementation all three shared ...123 and the count collapsed to zero.
  eq('reading to .123455 leaves the .123456 and .123457 messages unread',
    countUnread(stream, T_123455, reader), 2);
  eq('reading to .123456 leaves one unread', countUnread(stream, T_123456, reader), 1);
  eq('reading to the newest clears the count',
    countUnread(stream, '2026-08-31T14:12:37.123457+00:00', reader), 0);
  eq('a trimmed-zero read cursor is the same instant as its padded form',
    countUnread([msg(ID_A, T_123000, 'x')], T_123, reader), 0);
  eq('own messages are never unread regardless of precision',
    countUnread([msg(ID_A, T_123456, reader)], null, reader), 0);
  eq('a deleted message is never unread',
    countUnread([msg(ID_A, T_123456, 'x', T_123456)], null, reader), 0);
}

// ── 8. Encode / decode round-trip preserves the EXACT text ────────────────────────────
{
  const c = { createdAt: T_123456, id: ID_A };
  const enc = encodeCursor(c);
  const dec = decodeCursor(enc)!;
  eq('the timestamp survives byte-for-byte', dec.createdAt, T_123456);
  check('microseconds are not truncated by the round trip', dec.createdAt.includes('123456'));
  eq('the id survives', dec.id, ID_A);
  check('the encoding is URL-safe', /^[A-Za-z0-9_-]+$/.test(enc));
  check('the encoding is opaque', !enc.includes('2026') && !enc.includes(ID_A));
  eq('the cursor is versioned',
    Buffer.from(enc, 'base64url').toString('utf8').split('|')[0], CURSOR_VERSION);

  // Two cursors one microsecond apart must encode differently — the property the old format
  // lost, and the direct cause of the skipped message.
  const encA = encodeCursor({ createdAt: T_123455, id: ID_A });
  const encB = encodeCursor({ createdAt: T_123456, id: ID_A });
  check('cursors one microsecond apart are distinct', encA !== encB);

  eq('an absent cursor decodes to null', decodeCursor(undefined), null);
  eq('an empty cursor decodes to null', decodeCursor(''), null);
}

// ── 9. Validation: version, format, fields, size ──────────────────────────────────────
{
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

  // The OLD, lossy format is rejected outright rather than reinterpreted as exact.
  throwsCode('an unversioned (legacy) cursor is rejected',
    () => decodeCursor(b64(`${T_123456}|${ID_A}`)));
  throwsCode('an unsupported version is rejected',
    () => decodeCursor(b64(`v2|${T_123456}|${ID_A}`)));
  throwsCode('an empty version is rejected',
    () => decodeCursor(b64(`|${T_123456}|${ID_A}`)));

  throwsCode('a malformed timestamp is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|not-a-timestamp|${ID_A}`)));
  throwsCode('a timestamp with 7 fractional digits is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|2026-08-31T14:12:37.1234567+00:00|${ID_A}`)));
  throwsCode('an impossible date is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|2026-13-31T14:12:37.123456+00:00|${ID_A}`)));

  throwsCode('a malformed uuid is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|${T_123456}|not-a-uuid`)));
  throwsCode('a truncated uuid is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|${T_123456}|ffffffff-1111-4111-8111`)));

  throwsCode('a missing field is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|${T_123456}`)));
  throwsCode('an extra field is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|${T_123456}|${ID_A}|extra`)));
  throwsCode('an empty timestamp field is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}||${ID_A}`)));
  throwsCode('an empty id field is rejected',
    () => decodeCursor(b64(`${CURSOR_VERSION}|${T_123456}|`)));

  throwsCode('an oversized cursor is rejected before decoding',
    () => decodeCursor('A'.repeat(CURSOR_MAX_ENCODED_LENGTH + 1)));
  check('a legitimate cursor is comfortably inside the size bound',
    encodeCursor({ createdAt: T_123456, id: ID_A }).length < CURSOR_MAX_ENCODED_LENGTH);
  throwsCode('a non-string cursor is rejected', () => decodeCursor(12345));
  throwsCode('non-base64 junk is rejected', () => decodeCursor('!!!!not-base64!!!!'));
}

// ── 10. A Date can never become a cursor ──────────────────────────────────────────────
{
  // node-postgres returns Dates where PostgREST returns strings. A Date has already lost the
  // microseconds, so accepting one would silently reintroduce the defect through another
  // client. cursorOf must refuse it rather than truncate.
  throwsCode('cursorOf refuses a Date',
    () => cursorOf({ created_at: new Date(T_123456) as any, id: ID_A }));
  throwsCode('cursorOf refuses a null timestamp',
    () => cursorOf({ created_at: null as any, id: ID_A }));
  throwsCode('cursorOf refuses a numeric epoch',
    () => cursorOf({ created_at: 1788876757123 as any, id: ID_A }));

  const fromString = cursorOf({ created_at: T_123456, id: ID_A });
  eq('cursorOf keeps the raw text verbatim', fromString.createdAt, T_123456);
}

// ── 11. Cursor reuse across a channel or workspace is still the router's job ──────────
{
  // The cursor deliberately carries NO channel or workspace id: scoping is enforced by the
  // router's own .eq('workspace_id')/.eq('channel_id') filters, which a cursor cannot widen.
  // This pins that the cursor stays free of tenant identifiers, so it can never be the thing
  // that grants cross-tenant reach.
  const enc = encodeCursor({ createdAt: T_123456, id: ID_A });
  const decoded = Buffer.from(enc, 'base64url').toString('utf8');
  eq('the cursor carries exactly version, timestamp and message id',
    decoded.split('|').length, 3);
  check('the cursor carries no workspace id',
    !/ws_/.test(decoded) && !/workspace/i.test(decoded));
  check('the cursor carries no channel id',
    Object.keys(decodeCursor(enc)!).sort().join(',') === 'createdAt,id');
}

// ── 12. Differential proof: the OLD algorithm really did skip a message ───────────────
//
// The previous implementation is pinned here verbatim (as it stood at commit d8c8d95) and run
// against the same fixture as the fixed one. Without this, "the tests pass" only shows the new
// code is self-consistent — it does not show the bug was real or that these tests would have
// caught it. Keeping the old algorithm next to the new one makes the regression permanent:
// anyone reintroducing a Date into the cursor path fails this block immediately.
{
  interface OldCursor { createdAt: string; id: string; }
  const oldCursorOf = (row: { created_at: string; id: string }): OldCursor =>
    ({ createdAt: new Date(Date.parse(row.created_at)).toISOString(), id: row.id });
  const oldCompare = (a: OldCursor, b: OldCursor): number => {
    const at = Date.parse(a.createdAt), bt = Date.parse(b.createdAt);
    if (at !== bt) return at < bt ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  };
  const oldTrimAfter = <T extends { created_at: string; id: string }>(
    rows: T[], cursor: OldCursor
  ): T[] => rows.filter(r => oldCompare(oldCursorOf(r), cursor) > 0);

  // A: .123455 (SQL first). B: .123456 (SQL second) but its uuid sorts FIRST.
  const rows = [msg(ID_A, T_123455), msg(ID_B, T_123456)];

  // OLD: both truncate to ...123Z, so the comparison ties and the uuid tie-break puts B
  // before A. Polling from A therefore delivers NOTHING and B is skipped forever.
  const oldDelivered = oldTrimAfter(rows, oldCursorOf(rows[0])).map(r => r.id);
  eq('OLD algorithm truncates both timestamps to the same millisecond',
    oldCursorOf(rows[0]).createdAt, oldCursorOf(rows[1]).createdAt);
  eq('OLD algorithm skips the later message (this is the defect)', oldDelivered, []);

  // NEW: the microsecond is preserved, so B is delivered.
  const newDelivered = trimToStrictlyAfter(rows, cursorOf(rows[0])).map(r => r.id);
  eq('NEW algorithm delivers the later message', newDelivered, [ID_B]);

  check('the two algorithms genuinely disagree on this fixture',
    JSON.stringify(oldDelivered) !== JSON.stringify(newDelivered));

  // The same divergence in the unread count: OLD reports 0 unread, NEW reports 1.
  const reader = 'reader-actor';
  const oldUnread = rows.filter(m =>
    !m.deleted_at && m.author_actor_id !== reader &&
    Date.parse(m.created_at) > Date.parse(T_123455)).length;
  eq('OLD unread count loses the same-millisecond message', oldUnread, 0);
  eq('NEW unread count keeps it', countUnread(rows, T_123455, reader), 1);
}

console.log(
  `\nChannel cursor precision: ${passed} assertion(s) passed, ${failures.length} failed.`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
