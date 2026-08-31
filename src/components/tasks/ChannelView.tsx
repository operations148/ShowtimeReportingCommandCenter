import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import {
  Hash, Lock, Users, Settings, Loader2, AlertTriangle, ArrowDown, CornerUpLeft,
  Pencil, Trash2, Send, X, RotateCcw, MessageSquare
} from 'lucide-react';
import {
  TaskChannel, ChannelMessage, WorkspaceActor, TaskSpace
} from '../../tasks/apiClient';
import { PendingMessage } from '../../hooks/useChannelMessages';

interface Props {
  channel: TaskChannel;
  space?: TaskSpace | null;
  memberCount: number | null;
  actors: WorkspaceActor[];
  myActorId: string | null;
  messages: ChannelMessage[];
  pending: PendingMessage[];
  loading: boolean;
  error: string | null;
  loadingOlder: boolean;
  hasMoreBefore: boolean;
  pollState: 'idle' | 'polling' | 'backoff';
  canPost: boolean;
  canManage: boolean;
  /** Server-supplied edit window, never hard-coded in the client. */
  editWindowMs: number;
  /** The server's clock at bootstrap, so eligibility is not judged by the browser's. */
  serverNowMs: number | null;
  /** Ids of the newest messages the reader has actually SEEN (bottom reached). */
  onMessagesSeen: (newestMessageId: string) => void;
  onSend: (body: string, parentMessageId: string | null) => Promise<boolean>;
  onRetryPending: (localId: string) => void;
  onDiscardPending: (localId: string) => void;
  onEdit: (message: ChannelMessage, body: string) => Promise<boolean>;
  onDelete: (message: ChannelMessage) => Promise<boolean>;
  onLoadOlder: () => void;
  onRetry: () => void;
  onManage: () => void;
}

const dayKey = (iso: string) => iso.slice(0, 10);

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today.getTime() - 86400000);
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * The conversation view for one channel.
 *
 * Message bodies are rendered as TEXT, always. There is no dangerouslySetInnerHTML anywhere in
 * this file: React escapes by default, so `<script>` and any other markup a sender types is
 * displayed literally and is inert. `whitespace-pre-wrap` preserves the line breaks the server
 * kept, without interpreting anything.
 *
 * Display timestamps use Date deliberately and safely — they are for HUMAN reading, never for
 * ordering. Ordering is entirely the server's, carried by opaque cursors this component never
 * touches.
 */
export default function ChannelView(p: Props) {
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [announce, setAnnounce] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  /** Scroll metrics captured before a prepend, so the viewport can be restored after it. */
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const lastSeenId = useRef<string | null>(null);

  const actorName = useCallback((id: string | null) => {
    if (!id) return 'Unknown';
    const a = p.actors.find(x => x.actorId === id);
    return a?.displayName || a?.email || 'Unknown';
  }, [p.actors]);

  const newest = p.messages.length ? p.messages[p.messages.length - 1] : null;

  // ── Scroll handling ────────────────────────────────────────────────────────────────
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 40px of slack, so "near the bottom" counts as being at it.
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(bottom);
  }, []);

  /**
   * Restores the reader's position after older messages are prepended.
   *
   * useLayoutEffect, not useEffect: it must run before the browser paints, otherwise the
   * content visibly jumps before being corrected.
   */
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = prependAnchor.current;
    if (!el || !anchor) return;
    // Keep the same content under the reader's eyes by absorbing the height the prepend added.
    el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
    prependAnchor.current = null;
  }, [p.messages.length]);

  /** Auto-scroll ONLY when the reader is already at the bottom. Never yanks them down. */
  useEffect(() => {
    if (!atBottom) return;
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [p.messages.length, p.pending.length, atBottom]);

  /**
   * Read state. A channel is marked read only once its newest message has actually been
   * presented — the reader is at the bottom AND the list is not still loading. The message ID
   * is what advances the cursor; the browser clock is never submitted as a read position.
   */
  useEffect(() => {
    if (!atBottom || p.loading || !newest) return;
    if (lastSeenId.current === newest.id) return;
    lastSeenId.current = newest.id;
    p.onMessagesSeen(newest.id);
  }, [atBottom, p.loading, newest, p]);

  // Reset per-channel view state when the channel changes.
  useEffect(() => {
    setDraft(''); setReplyTo(null); setEditing(null); setAtBottom(true);
    lastSeenId.current = null;
    prependAnchor.current = null;
  }, [p.channel.id]);

  const handleLoadOlder = () => {
    const el = scrollRef.current;
    if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    p.onLoadOlder();
  };

  // ── Composer ───────────────────────────────────────────────────────────────────────
  const submit = async () => {
    const body = draft.trim();
    if (!body || busyId === 'composer') return;
    setBusyId('composer');
    // Cleared optimistically only because a failure keeps the text in the pending row, from
    // which it can be retried or copied — nothing the user typed is lost either way.
    setDraft('');
    const parent = replyTo?.id ?? null;
    setReplyTo(null);
    const ok = await p.onSend(body, parent);
    setBusyId(null);
    setAnnounce(ok ? 'Message sent.' : 'Message could not be sent. It is kept below to retry.');
    setAtBottom(true);
    composerRef.current?.focus();
  };

  const saveEdit = async () => {
    if (!editing) return;
    const target = p.messages.find(m => m.id === editing.id);
    if (!target) return;
    const body = editing.body.trim();
    if (!body) return;
    setBusyId(editing.id);
    const ok = await p.onEdit(target, body);
    setBusyId(null);
    if (ok) { setEditing(null); setAnnounce('Message updated.'); }
    else setAnnounce('The edit was rejected.');
  };

  const doDelete = async (m: ChannelMessage) => {
    if (!window.confirm('Delete this message? Its text will be removed for everyone.')) return;
    setBusyId(m.id);
    const ok = await p.onDelete(m);
    setBusyId(null);
    setAnnounce(ok ? 'Message deleted.' : 'The message could not be deleted.');
  };

  /**
   * Edit eligibility, judged against the SERVER's clock.
   *
   * `serverNowMs` is the server time observed at bootstrap, advanced by elapsed local time.
   * Using the raw browser clock would let a skewed machine offer an Edit button for a message
   * the server will refuse — the UI must never imply an expired edit will succeed. The server
   * remains the final authority: a rejection is surfaced rather than swallowed.
   */
  const canEdit = useCallback((m: ChannelMessage): boolean => {
    if (!p.canPost || m.deletedAt) return false;
    if (!p.myActorId || m.authorActorId !== p.myActorId) return false;
    const now = p.serverNowMs ?? Date.now();
    const age = now - Date.parse(m.createdAt);
    return age >= 0 && age <= p.editWindowMs;
  }, [p.canPost, p.myActorId, p.serverNowMs, p.editWindowMs]);

  const canDelete = useCallback((m: ChannelMessage): boolean => {
    if (m.deletedAt) return false;
    if (p.canManage) return true;                       // moderation: delete, never rewrite
    return p.canPost && !!p.myActorId && m.authorActorId === p.myActorId;
  }, [p.canManage, p.canPost, p.myActorId]);

  const messageById = useMemo(
    () => new Map(p.messages.map(m => [m.id, m])), [p.messages]);

  // ── Render ─────────────────────────────────────────────────────────────────────────
  const restricted = p.channel.visibility === 'restricted';

  return (
    <div className="bg-white border border-slate-200 rounded-xl flex flex-col h-[70vh] min-h-[420px] overflow-hidden">
      {/* Header */}
      <header className="px-4 py-3 border-b border-slate-200 bg-[#f8fafc] flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-black text-slate-900 flex items-center gap-1.5 min-w-0">
            <Hash className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
            <span className="truncate">{p.channel.name}</span>
            {restricted && (
              <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
                <Lock className="w-2.5 h-2.5" aria-hidden="true" /> Private
              </span>
            )}
            {p.channel.archived_at && (
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-700 bg-white border border-slate-200 px-1.5 py-0.5 rounded-full shrink-0">
                Archived
              </span>
            )}
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {p.channel.description && (
              <p className="text-[11px] text-slate-700 font-medium truncate max-w-md">
                {p.channel.description}
              </p>
            )}
            {p.space && (
              <span className="text-[10px] font-bold text-slate-600">
                Space: {p.space.name}
              </span>
            )}
            {p.memberCount !== null && (
              <span className="text-[10px] font-bold text-slate-600 inline-flex items-center gap-1">
                <Users className="w-3 h-3" aria-hidden="true" />
                {p.memberCount} member{p.memberCount === 1 ? '' : 's'}
              </span>
            )}
            {p.pollState === 'backoff' && (
              <span role="status" className="text-[10px] font-bold text-amber-700">
                Reconnecting…
              </span>
            )}
          </div>
        </div>
        {p.canManage && (
          <button
            onClick={p.onManage}
            aria-label={`Manage ${p.channel.name}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
          >
            <Settings className="w-3.5 h-3.5" aria-hidden="true" /> Manage
          </button>
        )}
      </header>

      {/* Polite announcements for send/edit/delete outcomes. */}
      <div role="status" aria-live="polite" className="sr-only">{announce}</div>

      {/* Message history */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto px-4 py-3"
      >
        {p.loading && (
          <div className="py-12 text-center space-y-2" role="status" aria-live="polite">
            <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" aria-hidden="true" />
            <p className="text-xs text-slate-600 font-semibold">Loading messages…</p>
          </div>
        )}

        {!p.loading && p.error && (
          <div role="alert" className="py-10 text-center space-y-3">
            <AlertTriangle className="w-7 h-7 text-rose-500 mx-auto" aria-hidden="true" />
            <p className="text-sm font-bold text-slate-800">Could not load this channel</p>
            <p className="text-xs text-slate-600 max-w-md mx-auto">{p.error}</p>
            <button
              onClick={p.onRetry}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {!p.loading && !p.error && (
          <>
            {p.hasMoreBefore && (
              <div className="text-center pb-3">
                <button
                  onClick={handleLoadOlder}
                  disabled={p.loadingOlder}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
                >
                  {p.loadingOlder
                    ? <><Loader2 className="w-3 h-3 inline animate-spin mr-1" aria-hidden="true" />Loading…</>
                    : 'Load older messages'}
                </button>
              </div>
            )}

            {p.messages.length === 0 && p.pending.length === 0 && (
              <div className="py-12 text-center">
                <MessageSquare className="w-8 h-8 text-slate-400 mx-auto mb-2" aria-hidden="true" />
                <p className="text-sm font-bold text-slate-700">
                  This is the start of #{p.channel.name}
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  {p.canPost
                    ? 'Send the first message to get the conversation going.'
                    : 'You have read-only access to this channel.'}
                </p>
              </div>
            )}

            <ol className="space-y-0.5" aria-label={`Messages in ${p.channel.name}`}>
              {p.messages.map((m, i) => {
                const prev = i > 0 ? p.messages[i - 1] : null;
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                const mine = !!p.myActorId && m.authorActorId === p.myActorId;
                const parent = m.parentMessageId ? messageById.get(m.parentMessageId) : null;
                const isEditing = editing?.id === m.id;

                return (
                  <li key={m.id}>
                    {newDay && (
                      <div className="flex items-center gap-2 my-3" role="separator"
                           aria-label={fmtDay(m.createdAt)}>
                        <span className="h-px bg-slate-200 flex-1" aria-hidden="true" />
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600">
                          {fmtDay(m.createdAt)}
                        </span>
                        <span className="h-px bg-slate-200 flex-1" aria-hidden="true" />
                      </div>
                    )}

                    <div className={`group/msg rounded-lg px-2.5 py-1.5 -mx-1 ${
                      mine ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                    }`}>
                      {/* Reply context: the quoted parent, rendered as text. */}
                      {m.parentMessageId && (
                        <div className="flex items-start gap-1 mb-1 pl-1 border-l-2 border-slate-300">
                          <CornerUpLeft className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
                          <p className="text-[10px] text-slate-600 font-medium truncate">
                            {parent
                              ? (parent.deletedAt
                                  ? 'Replying to a deleted message'
                                  : `${actorName(parent.authorActorId)}: ${parent.body ?? ''}`)
                              : 'Replying to an earlier message'}
                          </p>
                        </div>
                      )}

                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className={`text-[11px] font-black ${mine ? 'text-blue-800' : 'text-slate-900'}`}>
                          {m.deletedAt ? 'Deleted' : actorName(m.authorActorId)}
                        </span>
                        <time
                          dateTime={m.createdAt}
                          className="text-[10px] text-slate-600 font-semibold"
                        >
                          {fmtTime(m.createdAt)}
                        </time>
                        {m.editedAt && !m.deletedAt && (
                          <span className="text-[9px] font-bold uppercase tracking-wider text-slate-600">
                            edited
                          </span>
                        )}
                      </div>

                      {m.deletedAt ? (
                        <p className="text-xs text-slate-600 italic font-medium mt-0.5">
                          This message was deleted.
                        </p>
                      ) : isEditing ? (
                        <div className="mt-1 space-y-1.5">
                          <label className="sr-only" htmlFor={`edit-${m.id}`}>Edit message</label>
                          <textarea
                            id={`edit-${m.id}`}
                            autoFocus
                            value={editing.body}
                            onChange={e => setEditing({ id: m.id, body: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                            }}
                            rows={2}
                            className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={saveEdit}
                              disabled={busyId === m.id || !editing.body.trim()}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none cursor-pointer"
                            >
                              {busyId === m.id ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditing(null)}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Rendered as TEXT. React escapes it; whitespace-pre-wrap keeps the
                        // line breaks without interpreting any markup the sender typed.
                        <p className="text-xs text-slate-800 font-medium whitespace-pre-wrap break-words mt-0.5">
                          {m.body}
                        </p>
                      )}

                      {!m.deletedAt && !isEditing && (
                        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100 transition-opacity">
                          {p.canPost && (
                            <button
                              onClick={() => { setReplyTo(m); composerRef.current?.focus(); }}
                              aria-label={`Reply to ${actorName(m.authorActorId)}`}
                              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                            >
                              <CornerUpLeft className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                          {canEdit(m) && (
                            <button
                              onClick={() => setEditing({ id: m.id, body: m.body ?? '' })}
                              aria-label="Edit your message"
                              className="p-1 rounded text-slate-600 hover:text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                          {canDelete(m) && (
                            <button
                              onClick={() => doDelete(m)}
                              disabled={busyId === m.id}
                              aria-label={mine ? 'Delete your message' : 'Delete this message'}
                              className="p-1 rounded text-slate-600 hover:text-rose-700 hover:bg-slate-100 disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}

              {/* Pending sends: visibly not-yet-delivered, never mistaken for real messages. */}
              {p.pending.map(pm => (
                <li key={pm.localId}>
                  <div className={`rounded-lg px-2.5 py-1.5 -mx-1 border ${
                    pm.state === 'failed'
                      ? 'bg-rose-50 border-rose-200'
                      : 'bg-slate-50 border-slate-200 opacity-70'
                  }`}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-black text-slate-700">You</span>
                      <span className="text-[10px] font-bold text-slate-600">
                        {pm.state === 'failed' ? 'Not sent' : 'Sending…'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-800 font-medium whitespace-pre-wrap break-words mt-0.5">
                      {pm.body}
                    </p>
                    {pm.state === 'failed' && (
                      <div className="mt-1.5 space-y-1">
                        <p role="alert" className="text-[11px] text-rose-800 font-semibold">
                          {pm.error}
                        </p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => p.onRetryPending(pm.localId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden="true" /> Retry
                          </button>
                          <button
                            onClick={() => p.onDiscardPending(pm.localId)}
                            className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* New-message indicator, shown only when the reader is not at the bottom. */}
      {!atBottom && !p.loading && (
        <div className="relative">
          <button
            onClick={() => {
              setAtBottom(true);
              bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }}
            className="absolute -top-10 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" aria-hidden="true" /> Jump to latest
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-slate-200 p-3 bg-white shrink-0">
        {!p.canPost ? (
          <p className="text-[11px] text-slate-600 font-semibold text-center py-1.5">
            You have read-only access to this channel.
          </p>
        ) : p.channel.archived_at ? (
          <p className="text-[11px] text-slate-600 font-semibold text-center py-1.5">
            This channel is archived. Restore it to post.
          </p>
        ) : (
          <>
            {replyTo && (
              <div className="flex items-center gap-1.5 mb-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg">
                <CornerUpLeft className="w-3 h-3 text-slate-500 shrink-0" aria-hidden="true" />
                <p className="text-[10px] text-slate-700 font-semibold truncate flex-1">
                  Replying to {actorName(replyTo.authorActorId)}
                </p>
                <button
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="p-0.5 rounded text-slate-600 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer shrink-0"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="sr-only" htmlFor="channel-composer">
                Message #{p.channel.name}
              </label>
              <textarea
                id="channel-composer"
                ref={composerRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  // Enter sends; Shift+Enter is a newline. Both are standard here.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                rows={1}
                maxLength={4000}
                placeholder={`Message #${p.channel.name}`}
                className="flex-1 min-w-0 text-xs px-3 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y max-h-40"
              />
              <button
                onClick={submit}
                disabled={!draft.trim() || busyId === 'composer'}
                aria-label="Send message"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
              >
                {busyId === 'composer'
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  : <Send className="w-3.5 h-3.5" aria-hidden="true" />}
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
