import { useState, useEffect, useRef, useCallback } from 'react';
import { ChannelPoller } from '../tasks/channelPolling';
import {
  TaskApi, ChannelMessage, ChannelMessagePage, TaskApiError, newClientToken
} from '../tasks/apiClient';

/**
 * Message state and live delivery for ONE open channel.
 *
 * CURSOR SAFETY — the contract this hook exists to hold:
 *   * A cursor is an OPAQUE string. It is never parsed, never compared, never turned into a
 *     Date. The microsecond-exact format from src/tasks/channels.ts passes through untouched.
 *   * Ordering is the server's. Messages are appended/prepended in the order they arrive and
 *     are never re-sorted client-side, because a client-side sort would need to parse the
 *     timestamp and would reintroduce exactly the millisecond-truncation bug that was fixed.
 *   * De-duplication is by message id, so a message that arrives twice (a retried poll, a
 *     send reconciled against a poll) can never appear twice.
 *   * Every request carries an AbortSignal tied to the channel it was issued for. A response
 *     for a channel the user has left is discarded rather than applied.
 */

export interface PendingMessage {
  /** Local-only id. Never sent; never confused with a server id. */
  localId: string;
  body: string;
  parentMessageId: string | null;
  /** Stable across retries of THIS message — the server dedupes on it. */
  clientToken: string;
  state: 'sending' | 'failed';
  error?: string;
}

export interface ChannelMessagesState {
  messages: ChannelMessage[];
  pending: PendingMessage[];
  loading: boolean;
  error: string | null;
  loadingOlder: boolean;
  hasMoreBefore: boolean;
  /** Live-delivery state, surfaced so the UI can show a reconnecting hint. */
  pollState: 'idle' | 'polling' | 'backoff';
  send: (body: string, parentMessageId?: string | null) => Promise<boolean>;
  retry: (localId: string) => Promise<boolean>;
  discardPending: (localId: string) => void;
  loadOlder: () => Promise<void>;
  reload: () => void;
  /** The newest delivered message, for advancing the read cursor by id. */
  newest: ChannelMessage | null;
}

const PAGE_SIZE = 50;

export function useChannelMessages(
  api: TaskApi,
  channelId: string | null,
  enabled: boolean
): ChannelMessagesState {
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [page, setPage] = useState<ChannelMessagePage | null>(null);
  const [pollState, setPollState] = useState<'idle' | 'polling' | 'backoff'>('idle');
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * The channel every in-flight request belongs to. Compared on arrival so a response for a
   * channel the user has already left is dropped instead of rendering into the new one.
   */
  const activeChannel = useRef<string | null>(null);
  const pollerRef = useRef<ChannelPoller | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  /** Merge helper: append-only by id, preserving the server's order. Never re-sorts. */
  const mergeAppend = useCallback((incoming: ChannelMessage[]) => {
    if (!incoming.length) return;
    setMessages(prev => {
      const known = new Set(prev.map(m => m.id));
      const fresh = incoming.filter(m => !known.has(m.id));
      // An edit or a soft-delete arrives as the same id with new fields; apply it in place
      // rather than appending a duplicate.
      const updated = prev.map(m => incoming.find(i => i.id === m.id) ?? m);
      return fresh.length ? [...updated, ...fresh] : updated;
    });
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !channelId) {
      setMessages([]); setPending([]); setPage(null); setError(null);
      seenIds.current = new Set();
      activeChannel.current = null;
      return;
    }

    const forChannel = channelId;
    activeChannel.current = forChannel;
    const ac = new AbortController();
    setLoading(true); setError(null); setMessages([]); setPage(null);
    seenIds.current = new Set();

    (async () => {
      try {
        const res = await api.listChannelMessages(forChannel, { limit: PAGE_SIZE }, ac.signal);
        if (activeChannel.current !== forChannel) return;   // user switched away
        for (const m of res.messages) seenIds.current.add(m.id);
        setMessages(res.messages);
        setPage(res.page ?? null);
      } catch (err: any) {
        if (err?.name === 'AbortError' || activeChannel.current !== forChannel) return;
        setError(err?.message ?? 'Could not load messages.');
      } finally {
        if (activeChannel.current === forChannel) setLoading(false);
      }
    })();

    return () => { ac.abort(); };
  }, [api, channelId, enabled, reloadKey]);

  // ── Live delivery ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !channelId) return;

    const forChannel = channelId;
    const poller = new ChannelPoller({
      // The cursor is handed back exactly as received. It is never inspected here.
      fetchAfter: async (cursor, signal) => {
        const res = await api.listChannelMessages(
          forChannel, { after: cursor, limit: PAGE_SIZE }, signal);
        return {
          messages: res.messages as any,
          nextAfter: res.page?.nextAfter ?? null
        };
      },
      onMessages: incoming => {
        // Second guard, after the poller's own cycle check: never apply another channel's
        // messages, even if a response somehow outlived the switch.
        if (activeChannel.current !== forChannel) return;
        for (const m of incoming as any as ChannelMessage[]) seenIds.current.add(m.id);
        mergeAppend(incoming as any as ChannelMessage[]);
      },
      onStateChange: s => {
        if (activeChannel.current === forChannel) setPollState(s);
      },
      isVisible: () =>
        typeof document === 'undefined' || document.visibilityState !== 'hidden'
    });

    pollerRef.current = poller;

    const onVisibility = () => poller.notifyVisibilityChange();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [api, channelId, enabled, mergeAppend]);

  /**
   * Seeds the poller from the loaded history and starts it.
   *
   * Separate from creation so the poller never starts before the first page is in: starting
   * with a null cursor would refetch the whole history as if it were new.
   */
  useEffect(() => {
    const poller = pollerRef.current;
    if (!poller || loading || !page) return;
    poller.seed(messages as any, page.nextAfter);
    poller.start();
    return () => { poller.stop(); };
    // Deliberately keyed on the page identity, not on `messages`: re-seeding on every new
    // message would restart the poller continuously.
  }, [page, loading]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── Older history ──────────────────────────────────────────────────────────────────
  const loadOlder = useCallback(async () => {
    if (!channelId || !page?.nextBefore || loadingOlder || !page.hasMoreBefore) return;
    const forChannel = channelId;
    setLoadingOlder(true);
    try {
      const res = await api.listChannelMessages(
        forChannel, { before: page.nextBefore, limit: PAGE_SIZE });
      if (activeChannel.current !== forChannel) return;
      const older = res.messages.filter(m => !seenIds.current.has(m.id));
      for (const m of older) seenIds.current.add(m.id);
      // Prepended, never merged-and-sorted: the server already returned them in order.
      setMessages(prev => [...older, ...prev]);
      setPage(prev => prev ? {
        ...prev,
        nextBefore: res.page?.nextBefore ?? prev.nextBefore,
        hasMoreBefore: res.page?.hasMoreBefore ?? false
      } : res.page ?? null);
    } catch (err: any) {
      if (activeChannel.current === forChannel) {
        setError(err?.message ?? 'Could not load older messages.');
      }
    } finally {
      if (activeChannel.current === forChannel) setLoadingOlder(false);
    }
  }, [api, channelId, page, loadingOlder]);

  // ── Sending ────────────────────────────────────────────────────────────────────────
  /**
   * Sends with a PENDING row rather than an optimistic message.
   *
   * A pending row cannot be mistaken for a delivered one: it has no server id, no cursor and
   * no author identity, so it can never be replied to, edited, or fed to the poller's
   * de-duplication set. That is the safe half of "reconcile or show pending" — the server's
   * response replaces it, and a failure leaves the text recoverable.
   */
  const performSend = useCallback(async (p: PendingMessage): Promise<boolean> => {
    const forChannel = activeChannel.current;
    if (!forChannel) return false;
    setPending(prev => prev.map(x =>
      x.localId === p.localId ? { ...x, state: 'sending', error: undefined } : x));
    try {
      const { message } = await api.sendChannelMessage(forChannel, {
        body: p.body,
        clientToken: p.clientToken,          // stable across retries: the server dedupes
        parentMessageId: p.parentMessageId ?? undefined
      });
      if (activeChannel.current !== forChannel) return false;
      // Reconcile: drop the pending row and merge the authoritative message. `outcome` may be
      // 'duplicate' when a retry raced a success — the same message comes back either way, so
      // merging by id is correct in both cases.
      setPending(prev => prev.filter(x => x.localId !== p.localId));
      seenIds.current.add(message.id);
      mergeAppend([message]);
      return true;
    } catch (err: any) {
      if (activeChannel.current !== forChannel) return false;
      const code = err instanceof TaskApiError ? err.code : undefined;
      const retryAfter = err instanceof TaskApiError
        ? Number(err.payload?.retryAfterMs ?? 0) : 0;
      const msg = code === 'TASK_RATE_LIMITED' && retryAfter
        ? `Sending too quickly. Try again in ${Math.ceil(retryAfter / 1000)}s.`
        : err?.message ?? 'Could not send the message.';
      // The text is kept in the pending row, so nothing the user typed is lost.
      setPending(prev => prev.map(x =>
        x.localId === p.localId ? { ...x, state: 'failed', error: msg } : x));
      return false;
    }
  }, [api, mergeAppend]);

  const send = useCallback(async (body: string, parentMessageId: string | null = null) => {
    if (!channelId) return false;
    const p: PendingMessage = {
      localId: `local-${newClientToken()}`,
      body,
      parentMessageId,
      // ONE token per user intent. Retries reuse it; a genuinely new message gets a new one.
      clientToken: newClientToken(),
      state: 'sending'
    };
    setPending(prev => [...prev, p]);
    return performSend(p);
  }, [channelId, performSend]);

  const retry = useCallback(async (localId: string) => {
    const p = pending.find(x => x.localId === localId);
    if (!p || p.state === 'sending') return false;
    return performSend(p);          // same clientToken — never a second message
  }, [pending, performSend]);

  const discardPending = useCallback((localId: string) => {
    setPending(prev => prev.filter(x => x.localId !== localId));
  }, []);

  const reload = useCallback(() => setReloadKey(k => k + 1), []);

  return {
    messages, pending, loading, error, loadingOlder,
    hasMoreBefore: !!page?.hasMoreBefore,
    pollState,
    send, retry, discardPending, loadOlder, reload,
    newest: messages.length ? messages[messages.length - 1] : null
  };
}
