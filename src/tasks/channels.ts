/**
 * Pure logic for the Channels subsystem: slugs, message sanitisation, keyset cursors and
 * rate limiting.
 *
 * Everything here is deliberately free of I/O and of any Supabase or Express dependency, so
 * the security-critical decisions (what text is stored, what a cursor means, how many sends
 * are allowed) can be tested exhaustively without a database — and so the same functions run
 * identically in the router and in the tests.
 *
 * Nothing in this file ever reads an environment variable or a credential.
 */

import { invalid } from './http.js';

// ── Limits ─────────────────────────────────────────────────────────────────────────────

export const CHANNEL_NAME_MAX = 80;
export const CHANNEL_SLUG_MAX = 80;
export const CHANNEL_DESCRIPTION_MAX = 2000;
/** Mirrors the CHECK on task_channel_messages.body, so a long body fails as 422, not 500. */
export const MESSAGE_BODY_MAX = 4000;
export const MESSAGE_PAGE_DEFAULT = 50;
export const MESSAGE_PAGE_MAX = 100;
/** Client idempotency token bounds, mirroring the column CHECK. */
export const CLIENT_TOKEN_MIN = 8;
export const CLIENT_TOKEN_MAX = 100;

/**
 * How long an author may edit their own message.
 *
 * A bounded window, not unlimited: an unbounded edit right lets someone silently rewrite what
 * a conversation was built on long after others replied to it. Moderation is deliberately
 * NOT an edit right — a manager can soft-delete a message but can never rewrite it, because
 * altering someone's words under their own name is a worse power than removing them.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Sliding-window send limit, per actor per workspace. */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_SENDS = 20;

export const CHANNEL_VISIBILITIES = ['workspace', 'restricted'] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITIES)[number];

export const CHANNEL_MEMBER_ROLES = ['member', 'moderator'] as const;
export type ChannelMemberRole = (typeof CHANNEL_MEMBER_ROLES)[number];

// ── Slugs ──────────────────────────────────────────────────────────────────────────────

/** Matches the CHECK constraint on task_channels.slug exactly. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/**
 * Derives the normalised slug from a display name.
 *
 * Always derived, never accepted from a client: a caller-supplied slug is an opportunity to
 * smuggle a value the display name does not match, and the slug is what uniqueness is
 * enforced on. Diacritics are folded so "Café" and "Cafe" cannot both exist as live channels
 * and be mistaken for each other.
 */
export function slugifyChannelName(name: string): string {
  const folded = name
    .normalize('NFKD')
    // Strip the combining marks NFKD leaves behind, so "é" folds to "e" rather than to
    // "e" + U+0301. \p{Mn} rather than a literal U+0300-U+036F range: it covers every
    // non-spacing mark instead of only the Latin block, and it keeps this line pure ASCII —
    // a literal combining-mark range is invisible in most editors and is silently destroyed
    // by anything that re-normalises the file.
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();

  const slug = folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CHANNEL_SLUG_MAX)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, '');

  if (!slug || !SLUG_RE.test(slug)) {
    throw invalid(
      'Channel name must contain at least one letter or number.'
    );
  }
  return slug;
}

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

// ── Message sanitisation ───────────────────────────────────────────────────────────────

/**
 * Characters removed from every stored message body.
 *
 *   * C0/C1 controls except \n and \t — these are invisible and can corrupt logs and
 *     terminals, and NUL cannot be stored in a Postgres text column at all.
 *   * U+200B–U+200F, U+2028/2029, U+202A–U+202E, U+2066–U+2069, U+FEFF — zero-width and
 *     bidirectional-override characters. These are a genuine spoofing vector: a bidi override
 *     can make displayed text read in a different order than the characters it is made of,
 *     so a message can be made to *look* like it says something other than what it stores.
 */
const DISALLOWED_CHARS = new RegExp(
  '[' +
  '\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F' +  // C0 controls and DEL (newline and tab kept)
  '\u0080-\u009F' +                                  // C1 controls
  '\u200B-\u200F' +                                  // zero-width, LRM, RLM
  '\u2028\u2029' +                                    // line/paragraph separators
  '\u202A-\u202E' +                                  // bidi embedding and override
  '\u2066-\u2069' +                                  // bidi isolates
  '\uFEFF' +                                          // BOM / zero-width no-break space
  ']',
  'g'
);

/**
 * Normalises and bounds a plain-text message body.
 *
 * This is NOT HTML sanitisation, because a message body is never HTML: it is stored as text,
 * returned inside a JSON payload, and rendered by React, which escapes it. Deliberately does
 * NOT escape or strip `<`, `>` or `&` — "a < b" is ordinary prose, and rewriting it on the way
 * in would corrupt real messages while providing no protection that the escaping at the actual
 * rendering boundary does not already provide. See escapeHtml() for the boundary helper, which
 * every non-React consumer must use.
 */
export function sanitizeMessageBody(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw invalid('Message body is required.');
  }
  const cleaned = raw
    .replace(/\r\n?/g, '\n')
    .replace(DISALLOWED_CHARS, '')
    // Cap runs of blank lines so a message cannot be used to push a channel off screen.
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

  if (cleaned.length === 0) {
    throw invalid('Message body cannot be empty.');
  }
  if (cleaned.length > MESSAGE_BODY_MAX) {
    throw invalid(`Message body must be at most ${MESSAGE_BODY_MAX} characters.`);
  }
  return cleaned;
}

/**
 * Escapes text for safe interpolation into HTML.
 *
 * Provided for any consumer that builds markup itself (an email digest, an export, a
 * server-rendered page). React escapes automatically and must NOT double-escape by calling
 * this first. Escapes quotes and the forward slash too, so the result is safe in an attribute
 * value and cannot close an enclosing tag.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#47;');
}

/** Validates a client idempotency token. Returns null when the caller supplied none. */
export function optionalClientToken(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid('clientToken must be text.');
  const t = value.trim();
  if (t.length < CLIENT_TOKEN_MIN || t.length > CLIENT_TOKEN_MAX) {
    throw invalid(
      `clientToken must be between ${CLIENT_TOKEN_MIN} and ${CLIENT_TOKEN_MAX} characters.`
    );
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(t)) {
    throw invalid('clientToken may contain only letters, numbers and . _ : -');
  }
  return t;
}

// ── Keyset cursors ─────────────────────────────────────────────────────────────────────

/**
 * PRECISION CONTRACT — the reason this section does not use `Date` anywhere.
 *
 * PostgreSQL stores timestamptz with MICROSECOND resolution. A JavaScript `Date` holds only
 * MILLISECONDS, so `new Date(Date.parse(ts)).toISOString()` silently discards the low three
 * digits. Two messages 300µs apart then collapse to the same cursor timestamp, the (created_at,
 * id) tie-break is evaluated against the WRONG boundary, and a message that SQL ordered after
 * the cursor can compare as before it — so it is never delivered while the cursor advances past
 * it. That was observed in the Production canary and reproduced deterministically.
 *
 * The fix is to never let an ordering timestamp touch `Date`:
 *   * The router reads through supabase-js/PostgREST, which returns timestamptz as a JSON
 *     STRING with microseconds intact (e.g. "2026-08-31T14:12:37.123456+00:00"). That exact
 *     text is the canonical cursor timestamp.
 *   * The cursor carries that text VERBATIM. It is never parsed and reserialised.
 *   * Comparison converts to integer (seconds, microseconds) purely for ordering, and never
 *     emits a timestamp.
 *   * The same verbatim text goes back to PostgreSQL, which parses it exactly.
 *
 * `isWithinEditWindow` below still uses Date deliberately: it measures a 15-minute policy
 * window, not an ordering position, where sub-millisecond precision is meaningless.
 */

/** Bumped only when the encoded shape changes. v1 is the microsecond-exact format. */
export const CURSOR_VERSION = 'v1';
/** Hard bound on an encoded cursor, so a caller cannot post an unbounded string. */
export const CURSOR_MAX_ENCODED_LENGTH = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Accepts what PostgreSQL/PostgREST actually emit for timestamptz:
 * `YYYY-MM-DD` then `T` or a space, `HH:MM:SS`, an OPTIONAL 1-6 digit fraction (Postgres trims
 * trailing zeros, so ".123000" arrives as ".123"), then `Z`, `+HH:MM`, `+HHMM` or `+HH`.
 */
const PG_TIMESTAMP_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

export interface MessageCursor {
  /**
   * The message's created_at EXACTLY as PostgreSQL rendered it, microseconds included.
   * Never normalised, never round-tripped through Date. Treated as opaque text.
   */
  createdAt: string;
  /** Message id, breaking ties between messages sharing a timestamp. */
  id: string;
}

/** Integer instant, for ordering only. Never converted back into a timestamp. */
interface Instant { seconds: number; micros: number; }

/**
 * Parses a PostgreSQL timestamp into whole seconds plus microseconds.
 *
 * `Date.UTC` is used ONLY for the whole-second calendar arithmetic, where it is exact; every
 * sub-second digit is handled as an integer and never passes through a Date. Returns null for
 * anything that does not match the expected shape, so validation and comparison share one
 * definition of "a timestamp we understand".
 */
export function parseInstant(ts: unknown): Instant | null {
  if (typeof ts !== 'string') return null;
  const m = PG_TIMESTAMP_RE.exec(ts.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, frac, zone] = m;

  const utcMs = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
  if (!Number.isFinite(utcMs)) return null;
  // Guard against Date.UTC silently normalising an impossible date (e.g. month 13).
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || +hh > 23 || +mm > 59 || +ss > 60) return null;

  let offsetSeconds = 0;
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    offsetSeconds = sign * (oh * 3600 + om * 60);
  }

  // Right-pad the fraction so ".123" and ".123000" are the same number of microseconds.
  const micros = frac ? Number(frac.padEnd(6, '0')) : 0;
  return { seconds: utcMs / 1000 - offsetSeconds, micros };
}

/** True when the text is a timestamp this module can order. */
export const isOrderableTimestamp = (ts: unknown): boolean => parseInstant(ts) !== null;

/**
 * Encodes a cursor as an opaque, URL-safe, VERSIONED base64url string.
 *
 * Opaque, and deliberately NOT a sequence number. A monotonic per-table counter would be a
 * simpler cursor, but its gaps leak how many messages were written in OTHER workspaces
 * between two of your own — a cross-tenant volume oracle. A (created_at, id) keyset leaks
 * nothing a caller cannot already see, because both components belong to a message it just
 * read.
 */
export function encodeCursor(c: MessageCursor): string {
  return Buffer.from(`${CURSOR_VERSION}|${c.createdAt}|${c.id}`, 'utf8').toString('base64url');
}

/**
 * Decodes and fully validates a cursor.
 *
 * An unversioned cursor — the old, millisecond-lossy format — is REJECTED rather than
 * reinterpreted. Treating a lossy timestamp as if it were exact is precisely the bug this
 * change exists to remove, so the only safe response is to make the caller start again.
 */
export function decodeCursor(raw: unknown, field = 'cursor'): MessageCursor | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw invalid(`${field} must be text.`);
  if (raw.length > CURSOR_MAX_ENCODED_LENGTH) {
    throw invalid(`${field} is not a valid cursor.`);
  }

  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw invalid(`${field} is not a valid cursor.`);
  }

  // Exactly three fields. The timestamp itself contains no '|', so splitting is unambiguous.
  const parts = decoded.split('|');
  if (parts.length !== 3) throw invalid(`${field} is not a valid cursor.`);
  const [version, createdAt, id] = parts;

  if (version !== CURSOR_VERSION) throw invalid(`${field} is not a valid cursor.`);
  if (!createdAt || !id) throw invalid(`${field} is not a valid cursor.`);
  if (!isOrderableTimestamp(createdAt)) throw invalid(`${field} is not a valid cursor.`);
  if (!UUID_RE.test(id)) throw invalid(`${field} is not a valid cursor.`);

  // createdAt is returned VERBATIM — not reserialised — so the microseconds survive the round
  // trip and the exact text can go straight back to PostgreSQL.
  return { createdAt, id };
}

/**
 * Total order on the cursor pair, exact to the microsecond. Negative when `a` precedes `b`.
 *
 * Matches the SQL ordering `order by created_at asc, id asc` so the trimming below can never
 * disagree with the order the database returned rows in.
 */
export function compareCursor(a: MessageCursor, b: MessageCursor): number {
  const ia = parseInstant(a.createdAt);
  const ib = parseInstant(b.createdAt);
  // An unparseable timestamp must never silently compare as equal; fall back to the raw text
  // so the ordering stays total and deterministic rather than collapsing to a tie.
  if (!ia || !ib) {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
  }
  if (ia.seconds !== ib.seconds) return ia.seconds < ib.seconds ? -1 : 1;
  if (ia.micros !== ib.micros) return ia.micros < ib.micros ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/**
 * Builds a cursor from a database row, keeping created_at EXACTLY as it arrived.
 *
 * Throws on a Date. A Date has already lost the microseconds by the time it reaches here, and
 * `Date.parse(dateObject)` is worse still — it stringifies to second precision. Failing loudly
 * is the only safe response: silently accepting it would reintroduce the skipped-message bug
 * through a different client (node-postgres returns Dates where PostgREST returns strings).
 */
export function cursorOf(row: { created_at: unknown; id: string }): MessageCursor {
  if (typeof row.created_at !== 'string') {
    throw invalid(
      'An ordering cursor requires the raw PostgreSQL timestamp text. A Date has already ' +
      'lost microsecond precision and cannot be used as a cursor.'
    );
  }
  return { createdAt: row.created_at, id: row.id };
}

/**
 * Trims a timestamp-bounded result set down to strictly-after (or strictly-before) the cursor.
 *
 * The database query uses a single inclusive `>=` / `<=` bound on created_at rather than a
 * row-value comparison, because a composite `(created_at, id) > (t, i)` predicate through
 * PostgREST has to be spelled as a nested or(...)/and(...) filter string — fragile to build
 * and easy to get subtly wrong. Fetching the inclusive boundary and discarding the already-seen
 * rows here is exact, cheap (only messages sharing the cursor's exact timestamp are refetched)
 * and, unlike the filter-string approach, is covered by tests that do not need a database.
 *
 * This is also what guarantees polling never yields a duplicate: a row equal to the cursor is
 * dropped, so the caller can append the result to what it already has without de-duplicating.
 */
export function trimToStrictlyAfter<T extends { created_at: string; id: string }>(
  rows: T[], cursor: MessageCursor | null
): T[] {
  if (!cursor) return rows;
  return rows.filter(r => compareCursor(cursorOf(r), cursor) > 0);
}

export function trimToStrictlyBefore<T extends { created_at: string; id: string }>(
  rows: T[], cursor: MessageCursor | null
): T[] {
  if (!cursor) return rows;
  return rows.filter(r => compareCursor(cursorOf(r), cursor) < 0);
}

/** Bounded page size for message listing. A caller cannot request an unbounded page. */
export function parseMessageLimit(value: unknown): number {
  const n = Number(value ?? MESSAGE_PAGE_DEFAULT);
  if (!Number.isInteger(n) || n <= 0) return MESSAGE_PAGE_DEFAULT;
  return Math.min(n, MESSAGE_PAGE_MAX);
}

// ── Rate limiting ──────────────────────────────────────────────────────────────────────

export interface RateLimitVerdict {
  allowed: boolean;
  /** Sends remaining in the current window after this one. */
  remaining: number;
  /** Milliseconds until the window frees up. 0 when allowed. */
  retryAfterMs: number;
}

/**
 * Sliding-window limiter keyed by (workspace, actor).
 *
 * IMPORTANT AND DELIBERATE LIMITATION: this is per-process. On Vercel each serverless instance
 * holds its own map, so a caller spread across N warm instances can exceed the nominal limit by
 * up to a factor of N. It is therefore the CHEAP first line only — it rejects the common
 * runaway-client case without touching the database. The authoritative check is the
 * database-backed count in the send route, which counts the author's real recent messages and
 * is unaffected by which instance served them. Neither is presented as the other.
 */
export class SlidingWindowRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs = RATE_LIMIT_WINDOW_MS,
    private readonly max = RATE_LIMIT_MAX_SENDS
  ) {}

  /** Records an attempt and reports whether it is permitted. */
  check(key: string, now = Date.now()): RateLimitVerdict {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter(t => t > cutoff);

    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      const oldest = recent[0];
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, oldest + this.windowMs - now)
      };
    }

    recent.push(now);
    this.hits.set(key, recent);

    // Opportunistic sweep so an idle process does not retain keys forever. Bounded work:
    // only runs once the map is large enough for the retention to matter.
    if (this.hits.size > 500) {
      for (const [k, v] of this.hits) {
        const live = v.filter(t => t > cutoff);
        if (live.length === 0) this.hits.delete(k);
        else this.hits.set(k, live);
      }
    }

    return { allowed: true, remaining: this.max - recent.length, retryAfterMs: 0 };
  }

  /** Test/diagnostic helper. Never called by a route. */
  reset(): void {
    this.hits.clear();
  }
}

export const rateLimitKey = (workspaceId: string, actorId: string): string =>
  `${workspaceId}:${actorId}`;

// ── Edit window ────────────────────────────────────────────────────────────────────────

export function isWithinEditWindow(createdAtIso: string, now = Date.now()): boolean {
  const t = Date.parse(createdAtIso);
  if (!Number.isFinite(t)) return false;
  return now - t <= EDIT_WINDOW_MS;
}

// ── Unread counting ────────────────────────────────────────────────────────────────────

/**
 * Unread count for one channel given a read cursor.
 *
 * A caller's OWN messages never count as unread — sending a message is reading it — and
 * deleted messages never count, so moderating a message reduces the badge rather than
 * leaving an unread the reader can never clear.
 */
export function countUnread(
  messages: { created_at: string; author_actor_id: string; deleted_at: string | null }[],
  lastReadAt: string | null,
  actorId: string
): number {
  // Microsecond-exact, for the same reason the cursor is: a read position and a message can
  // fall in the same millisecond, and Date.parse would then report an unread message as read.
  const since = lastReadAt ? parseInstant(lastReadAt) : null;
  const after = (createdAt: string): boolean => {
    if (!since) return true;                       // no read cursor: everything is unread
    const at = parseInstant(createdAt);
    if (!at) return false;                         // unparseable: never counted, never guessed
    if (at.seconds !== since.seconds) return at.seconds > since.seconds;
    return at.micros > since.micros;
  };
  return messages.filter(m =>
    !m.deleted_at &&
    m.author_actor_id !== actorId &&
    after(m.created_at)
  ).length;
}
