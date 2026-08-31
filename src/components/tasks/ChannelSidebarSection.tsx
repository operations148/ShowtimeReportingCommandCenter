import React, { useState, useRef, useEffect } from 'react';
import {
  Hash, Plus, ChevronDown, Loader2, AlertTriangle, Lock, MessageSquare, X, Check
} from 'lucide-react';
import { TaskChannel } from '../../tasks/apiClient';

interface Props {
  channels: TaskChannel[];
  selectedChannelId: string | null;
  loading: boolean;
  error: string | null;
  canManage: boolean;
  expanded: boolean;
  /** Ids currently mid-mutation — the row shows a spinner rather than freezing the section. */
  pendingIds: Set<string>;
  onToggleExpanded: () => void;
  onSelect: (channelId: string) => void;
  onCreate: (name: string) => Promise<boolean>;
  onRetry: () => void;
}

/**
 * The CHANNELS section, rendered beneath the Spaces/Folders/Lists tree.
 *
 * Deliberately a SIBLING of the hierarchy nav rather than part of it: channels are a
 * workspace-level surface, not a node in the Space tree, and keeping them in their own
 * <nav> means expanding a Space or selecting a List cannot disturb channel state (and vice
 * versa). Styling reuses the module's existing tokens — white surface, slate text, blue
 * active state — rather than introducing a second visual language.
 */
export default function ChannelSidebarSection(p: Props) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const submit = async () => {
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    const ok = await p.onCreate(name);
    setSaving(false);
    if (ok) {
      setDraft('');
      setCreating(false);
      // Focus returns to the control that opened the row, not to the document body.
      createBtnRef.current?.focus();
    }
  };

  const cancel = () => {
    setCreating(false);
    setDraft('');
    createBtnRef.current?.focus();
  };

  const totalUnread = p.channels.reduce((n, c) => n + (c.unreadCount ?? 0), 0);

  return (
    <section aria-labelledby="channels-heading" className="mt-4 pt-3 border-t border-slate-200">
      <div className="flex items-center gap-1 mb-1.5">
        <button
          onClick={p.onToggleExpanded}
          aria-expanded={p.expanded}
          aria-controls="channels-list"
          className="flex items-center gap-1 flex-1 min-w-0 px-1 py-1 rounded-lg hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer text-left"
        >
          <ChevronDown
            className={`w-3 h-3 text-slate-600 shrink-0 transition-transform ${p.expanded ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
          <h3
            id="channels-heading"
            className="text-[10px] font-black uppercase tracking-wider text-slate-700"
          >
            Channels
          </h3>
          {/* Collapsed with unread content still says so, so nothing is silently hidden. */}
          {!p.expanded && totalUnread > 0 && (
            <span
              className="text-[9px] font-black text-white bg-blue-600 rounded-full px-1.5 py-0.5 shrink-0"
              aria-label={`${totalUnread} unread message${totalUnread === 1 ? '' : 's'}`}
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>

        {p.canManage && !creating && (
          <button
            ref={createBtnRef}
            onClick={() => { setCreating(true); if (!p.expanded) p.onToggleExpanded(); }}
            aria-label="Create a channel"
            className="p-1 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {p.expanded && (
        <div id="channels-list">
          {p.loading && (
            <div className="space-y-1.5 px-1 py-1" role="status" aria-live="polite">
              <span className="sr-only">Loading channels…</span>
              {[0, 1, 2].map(i => (
                <div key={i} className="h-5 rounded bg-slate-100 animate-pulse" aria-hidden="true" />
              ))}
            </div>
          )}

          {!p.loading && p.error && (
            <div role="alert" className="px-1.5 py-2 space-y-1.5">
              <p className="text-[11px] text-rose-800 font-semibold flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{p.error}</span>
              </p>
              <button
                onClick={p.onRetry}
                className="text-[11px] font-bold px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer"
              >
                Try again
              </button>
            </div>
          )}

          {!p.loading && !p.error && p.channels.length === 0 && !creating && (
            <p className="px-1.5 py-2 text-[11px] text-slate-600 font-medium leading-relaxed">
              <MessageSquare className="w-3 h-3 inline mr-1 -mt-0.5" aria-hidden="true" />
              No channels yet.
              {p.canManage ? ' Create one to start a conversation.' : ''}
            </p>
          )}

          {!p.loading && !p.error && p.channels.length > 0 && (
            <ul className="space-y-0.5">
              {p.channels.map(c => {
                const selected = c.id === p.selectedChannelId;
                const unread = c.unreadCount ?? 0;
                const restricted = c.visibility === 'restricted';
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => p.onSelect(c.id)}
                      aria-current={selected ? 'true' : undefined}
                      disabled={p.pendingIds.has(c.id)}
                      aria-label={
                        `${c.name}${restricted ? ', private' : ''}` +
                        `${unread ? `, ${unread} unread message${unread === 1 ? '' : 's'}` : ''}` +
                        `${c.archived_at ? ', archived' : ''}`
                      }
                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none disabled:opacity-50 ${
                        selected
                          ? 'bg-blue-600 text-white font-bold'
                          : unread
                            ? 'text-slate-900 font-bold hover:bg-slate-100'
                            : 'text-slate-700 font-semibold hover:bg-slate-100'
                      }`}
                    >
                      {p.pendingIds.has(c.id)
                        ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" aria-hidden="true" />
                        : <Hash className={`w-3 h-3 shrink-0 ${selected ? 'text-white' : 'text-slate-500'}`} aria-hidden="true" />}
                      <span className="truncate flex-1 text-left" aria-hidden="true">{c.name}</span>
                      {restricted && (
                        <Lock
                          className={`w-2.5 h-2.5 shrink-0 ${selected ? 'text-blue-100' : 'text-slate-500'}`}
                          aria-hidden="true"
                        />
                      )}
                      {unread > 0 && (
                        <span
                          aria-hidden="true"
                          className={`text-[9px] font-black rounded-full px-1.5 shrink-0 ${
                            selected ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
                          }`}
                        >
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {creating && (
            <div className="flex items-center gap-1 mt-1.5 px-0.5">
              <label className="sr-only" htmlFor="new-channel-name">New channel name</label>
              <span className="text-slate-500 text-[11px] font-bold" aria-hidden="true">#</span>
              <input
                id="new-channel-name"
                ref={inputRef}
                value={draft}
                disabled={saving}
                maxLength={80}
                placeholder="channel-name"
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                }}
                className="flex-1 min-w-0 text-[11px] px-2 py-1 bg-white border border-slate-200 rounded-lg font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
              />
              <button
                onClick={submit}
                disabled={saving || !draft.trim()}
                aria-label="Create channel"
                className="p-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none cursor-pointer shrink-0"
              >
                {saving
                  ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  : <Check className="w-3 h-3" aria-hidden="true" />}
              </button>
              <button
                onClick={cancel}
                aria-label="Cancel new channel"
                className="p-1 rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
