/**
 * Near-real-time message delivery by secure cursor polling.
 *
 * WHY POLLING AND NOT SUPABASE REALTIME
 * -------------------------------------
 * Realtime authorises a subscription as the `anon` or `authenticated` Postgres role and
 * evaluates RLS policies on the publication to decide what a socket may receive. This
 * application has no Supabase client in the browser and no Supabase session: identity is an
 * application-issued token verified server-side, and every database read goes through
 * `service_role` from the server. Every task_* table has RLS enabled with ZERO policies —
 * deny-all — plus explicit grants to service_role only.
 *
 * Adopting Realtime for messages would therefore require all three of:
 *   1. shipping a Supabase key to the browser,
 *   2. minting Supabase JWTs that mirror application identity, and
 *   3. adding SELECT policies on task_channel_messages for `authenticated`.
 * (3) directly dismantles the deny-all posture that currently makes a leaked client-side key
 * useless, and (1) hands out the key that would then matter. The audit therefore rejects
 * Realtime for this subsystem; the cost is latency measured in seconds, and the benefit is
 * that the browser gains no database access at all.
 *
 * This controller is deliberately transport-agnostic and DOM-free: it is driven by injected
 * `fetchAfter`, `isVisible` and timer functions, so every rule below is testable without a
 * browser or a network.
 */

export interface PolledMessage {
  id: string;
  cursor: string;
  [key: string]: unknown;
}

export interface PollResult {
  messages: PolledMessage[];
  nextAfter: string | null;
}

export interface ChannelPollerOptions {
  /** Performs one request for everything strictly after `cursor`. */
  fetchAfter: (cursor: string | null, signal: AbortSignal) => Promise<PollResult>;
  /** New messages, in order, already de-duplicated. Never called with an empty array. */
  onMessages: (messages: PolledMessage[]) => void;
  /** Reports the current transport state so the UI can show a reconnecting hint. */
  onStateChange?: (state: PollerState) => void;
  /** Tab visibility. Injected so the rule is testable without a document. */
  isVisible: () => boolean;
  /** Base interval between successful polls, in ms. */
  intervalMs?: number;
  /** Ceiling for exponential backoff, in ms. */
  maxBackoffMs?: number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (handle: any) => void;
  now?: () => number;
}

export type PollerState = 'idle' | 'polling' | 'backoff';

const DEFAULT_INTERVAL_MS = 4000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

/**
 * Exponential backoff with full jitter.
 *
 * Jitter is not decoration: without it every open client that saw the same outage retries in
 * the same millisecond, and the recovering server is hit by the entire fleet at once. `rand`
 * is injected so tests can pin it.
 */
export function backoffDelay(
  attempt: number, baseMs = DEFAULT_INTERVAL_MS, maxMs = DEFAULT_MAX_BACKOFF_MS,
  rand: () => number = Math.random
): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  return Math.round(exponential * (0.5 + rand() * 0.5));
}

/**
 * Drives one channel's message polling.
 *
 * Guarantees, each of which is a stated requirement:
 *   * Polls only between start() and stop() — that is, only while a channel is open.
 *   * Never polls while the tab is hidden; resumes immediately when it becomes visible again,
 *     rather than waiting out the interval it slept through.
 *   * Only ever one request in flight; a new cycle aborts the previous one, and a response
 *     from an aborted or superseded request is discarded rather than applied.
 *   * Sends the latest cursor, so a poll asks only for what it has not already seen.
 *   * De-duplicates by message id as well as by cursor, so a message can never be delivered
 *     twice even if a cursor were ever replayed.
 *   * Backs off exponentially on failure and resets to the base interval on the first success.
 */
export class ChannelPoller {
  private cursor: string | null = null;
  private readonly seen = new Set<string>();
  private timer: any = null;
  private controller: AbortController | null = null;
  private running = false;
  private failures = 0;
  private cycle = 0;
  private state: PollerState = 'idle';

  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => any;
  private readonly clearTimer: (handle: any) => void;

  constructor(private readonly opts: ChannelPollerOptions) {
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? (h => clearTimeout(h));
  }

  /** Seeds the cursor and the de-duplication set from an already-loaded page of history. */
  seed(messages: PolledMessage[], cursor: string | null): void {
    for (const m of messages) this.seen.add(m.id);
    if (cursor) this.cursor = cursor;
  }

  get currentCursor(): string | null { return this.cursor; }
  get isRunning(): boolean { return this.running; }
  get currentState(): PollerState { return this.state; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    void this.tick();
  }

  /**
   * Stops polling and aborts anything in flight.
   *
   * Bumping `cycle` is what makes a stale response harmless: a request that returns after
   * stop() (or after another start()) no longer matches and its result is dropped, so a
   * closed channel can never write messages into a reopened one.
   */
  stop(): void {
    this.running = false;
    this.cycle++;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    if (this.controller) { this.controller.abort(); this.controller = null; }
    this.setState('idle');
  }

  /**
   * Call when tab visibility changes. Resumes immediately rather than after the interval.
   *
   * The pending timer is CANCELLED first. While hidden, each tick reschedules without issuing
   * a request, so there is essentially always a timer outstanding — treating that as "already
   * scheduled, nothing to do" would make foregrounding a tab wait out a full interval before
   * showing anything, which is exactly the delay this method exists to remove. A request
   * genuinely in flight is left alone; its completion schedules the next cycle.
   */
  notifyVisibilityChange(): void {
    if (!this.running) return;
    if (!this.opts.isVisible()) return;
    if (this.controller) return;
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    void this.tick();
  }

  private setState(next: PollerState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    this.timer = this.setTimer(() => { this.timer = null; void this.tick(); }, ms);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    // Hidden tab: skip the request entirely and re-check later. A background tab costs the
    // server nothing, and notifyVisibilityChange() wakes it the instant it is foregrounded.
    if (!this.opts.isVisible()) {
      this.setState('idle');
      this.schedule(this.intervalMs);
      return;
    }

    const myCycle = ++this.cycle;
    const controller = new AbortController();
    this.controller = controller;
    this.setState('polling');

    try {
      const result = await this.opts.fetchAfter(this.cursor, controller.signal);

      // Superseded or stopped while in flight: discard rather than apply.
      if (myCycle !== this.cycle || !this.running) return;

      this.failures = 0;

      const fresh = result.messages.filter(m => !this.seen.has(m.id));
      for (const m of fresh) this.seen.add(m.id);

      // The cursor only ever moves forward, and only to something the server returned.
      if (result.nextAfter) this.cursor = result.nextAfter;

      if (fresh.length) this.opts.onMessages(fresh);

      this.setState('idle');
      this.schedule(this.intervalMs);
    } catch (err: any) {
      if (myCycle !== this.cycle || !this.running) return;
      // An abort is control flow, not a failure, and must not count toward backoff.
      if (err?.name === 'AbortError') return;

      this.failures++;
      this.setState('backoff');
      this.schedule(backoffDelay(this.failures, this.intervalMs, this.maxBackoffMs));
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
