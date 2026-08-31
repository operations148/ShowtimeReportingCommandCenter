import React, { useState, useRef, useEffect, useId } from 'react';
import { X, Loader2, AlertTriangle, Lock, Globe, Archive, RotateCcw, Users } from 'lucide-react';
import {
  TaskApi, TaskChannel, TaskSpace, WorkspaceActor, ChannelVisibility, ChannelMemberRole
} from '../../tasks/apiClient';
import DialogPortal from './DialogPortal';

interface Props {
  api: TaskApi;
  channel: TaskChannel;
  spaces: TaskSpace[];
  actors: WorkspaceActor[];
  /** Current membership, loaded by the container. null while unknown. */
  members: { actorId: string; role: ChannelMemberRole }[] | null;
  onClose: () => void;
  /** Called after any successful change so the container refetches authoritative state. */
  onChanged: () => void;
}

/**
 * Manager-only channel settings: rename, describe, re-scope, visibility, membership, archive.
 *
 * Every control here maps to a route the backend actually exposes — PATCH /channels/:id and
 * PUT /channels/:id/members. Nothing offers an operation the contract does not support: there
 * is deliberately no hard-delete control, because the backend has none (channels are archived,
 * never destroyed), and no way to create a user, actor or workspace membership — only existing
 * workspace actors can be added.
 */
export default function ChannelManagerPanel(p: Props) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [name, setName] = useState(p.channel.name);
  const [description, setDescription] = useState(p.channel.description ?? '');
  const [visibility, setVisibility] = useState<ChannelVisibility>(p.channel.visibility);
  const [spaceId, setSpaceId] = useState<string>(p.channel.space_id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (p.members) setSelected(new Set(p.members.map(m => m.actorId)));
  }, [p.members]);

  // Focus trap + restore, matching StatusManagerPanel's established pattern.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); p.onClose(); return; }
      if (e.key !== 'Tab') return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [p]);

  const say = (m: string) => setAnnounce(m);

  const saveDetails = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Channel name is required.'); return; }
    if (busy) return;                                    // prevents duplicate submission
    setBusy('details'); setError(null);
    try {
      await p.api.updateChannel(p.channel.id, {
        version: p.channel.version,
        name: trimmed,
        description: description.trim() || null,
        visibility,
        spaceId: spaceId || null
      });
      say('Channel updated.');
      p.onChanged();
    } catch (err: any) {
      // The server's normalised message is shown verbatim; no database or Supabase detail
      // reaches the user because http.ts already maps driver errors to safe codes.
      setError(err?.message ?? 'Could not update the channel.');
    } finally {
      setBusy(null);
    }
  };

  const saveMembers = async () => {
    if (busy) return;
    setBusy('members'); setError(null);
    try {
      await p.api.setChannelMembers(
        p.channel.id,
        [...selected].map(actorId => ({ actorId, role: 'member' as ChannelMemberRole }))
      );
      say('Channel members updated.');
      p.onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not update members.');
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async () => {
    const archiving = !p.channel.archived_at;
    if (archiving && !window.confirm(
      `Archive #${p.channel.name}? Members will no longer be able to post until it is restored.`
    )) return;
    if (busy) return;
    setBusy('archive'); setError(null);
    try {
      await p.api.updateChannel(p.channel.id, {
        version: p.channel.version, archived: archiving
      });
      say(archiving ? 'Channel archived.' : 'Channel restored.');
      p.onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not update the channel.');
    } finally {
      setBusy(null);
    }
  };

  const eligible = p.actors.filter(a => !a.archived);

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={p.onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onClick={e => e.stopPropagation()}
          className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl"
        >
          <header className="flex items-center justify-between px-5 py-4 bg-[#0F172A] rounded-t-2xl sticky top-0 z-10">
            <h2 id={headingId} className="text-sm font-black text-white truncate">
              Manage #{p.channel.name}
            </h2>
            <button
              ref={closeRef}
              onClick={p.onClose}
              aria-label="Close channel settings"
              className="text-slate-300 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none rounded cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </header>

          <div role="status" aria-live="polite" className="sr-only">{announce}</div>

          <div className="p-5 space-y-5">
            {error && (
              <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {/* ── Details ──────────────────────────────────────────────────────── */}
            <section className="space-y-3">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                Details
              </h3>

              <label className="block">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">Name</span>
                <input
                  value={name} maxLength={80}
                  onChange={e => setName(e.target.value)}
                  className="w-full text-xs p-2 mt-1 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold text-slate-800"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">
                  Description
                </span>
                <textarea
                  value={description} maxLength={2000} rows={2}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What is this channel for?"
                  className="w-full text-xs p-2 mt-1 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-medium text-slate-800 resize-y"
                />
              </label>

              <fieldset>
                <legend className="text-[10px] font-black text-slate-600 uppercase tracking-wider">
                  Visibility
                </legend>
                <div className="flex gap-2 mt-1">
                  {([
                    ['workspace', 'Workspace', Globe, 'Everyone in the workspace can read it'],
                    ['restricted', 'Private', Lock, 'Only added members can read it']
                  ] as const).map(([value, label, Icon, hint]) => (
                    <button
                      key={value}
                      onClick={() => setVisibility(value)}
                      aria-pressed={visibility === value}
                      title={hint}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none ${
                        visibility === value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="w-3 h-3" aria-hidden="true" /> {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="text-[10px] font-black text-slate-600 uppercase tracking-wider">
                  Associated Space (optional)
                </span>
                <select
                  value={spaceId}
                  onChange={e => setSpaceId(e.target.value)}
                  className="w-full text-xs p-2 mt-1 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold text-slate-700 cursor-pointer"
                >
                  <option value="">No Space</option>
                  {p.spaces.filter(s => !s.archived_at).map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>

              <button
                onClick={saveDetails}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors cursor-pointer"
              >
                {busy === 'details' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                Save details
              </button>
            </section>

            {/* ── Members ──────────────────────────────────────────────────────── */}
            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" /> Members
              </h3>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Only existing workspace members are listed. This panel never creates a user or a
                workspace membership. Membership is what grants access to a{' '}
                <strong>Private</strong> channel.
              </p>

              {p.members === null ? (
                <p className="text-[11px] text-slate-600 font-semibold py-2" role="status">
                  Loading members…
                </p>
              ) : eligible.length === 0 ? (
                <p className="text-[11px] text-slate-600 font-semibold py-2">
                  No other workspace members are available.
                </p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto" aria-label="Workspace members">
                  {eligible.map(a => (
                    <li key={a.actorId}>
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected.has(a.actorId)}
                          onChange={e => setSelected(prev => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(a.actorId) : next.delete(a.actorId);
                            return next;
                          })}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                        />
                        <span className="text-[11px] font-semibold text-slate-800 truncate">
                          {a.displayName || a.email}{a.isSelf ? ' (you)' : ''}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              <button
                onClick={saveMembers}
                disabled={busy !== null || p.members === null}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
              >
                {busy === 'members' && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                Save members
              </button>
            </section>

            {/* ── Archive ──────────────────────────────────────────────────────── */}
            <section className="space-y-2 border-t border-slate-100 pt-4">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-700">
                {p.channel.archived_at ? 'Restore' : 'Archive'}
              </h3>
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Archiving hides the channel and stops new messages. Nothing is deleted — the
                backend has no hard-delete for a channel, so its history is always recoverable
                by restoring it.
              </p>
              <button
                onClick={toggleArchive}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
              >
                {busy === 'archive'
                  ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                  : p.channel.archived_at
                    ? <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    : <Archive className="w-3.5 h-3.5" aria-hidden="true" />}
                {p.channel.archived_at ? 'Restore channel' : 'Archive channel'}
              </button>
            </section>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
