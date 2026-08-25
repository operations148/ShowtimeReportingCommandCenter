import React, { useState, useRef, useEffect, useId } from 'react';
import { X, Plus, Check, Loader2, AlertTriangle, ArrowUp, ArrowDown, Palette } from 'lucide-react';
import { TaskApi, TaskStatus, StatusCategory } from '../../tasks/apiClient';
import DialogPortal from './DialogPortal';

interface Props {
  api: TaskApi;
  spaceId: string;
  spaceName: string;
  statuses: TaskStatus[];
  onClose: () => void;
  /** Called after any successful change so List and Board refetch authoritative data. */
  onChanged: () => void;
}

const CATEGORIES: { value: StatusCategory; label: string; hint: string }[] = [
  { value: 'todo', label: 'To Do', hint: 'Not started' },
  { value: 'in_progress', label: 'In Progress', hint: 'Being worked on' },
  { value: 'done', label: 'Done', hint: 'Complete — drives completion reporting' }
];

/** Palette offered as swatches. Any valid 6-digit hex is accepted by the API. */
const SWATCHES = ['#94A3B8', '#2563EB', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777'];

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Manager-only custom-status panel for one Space.
 *
 * INTENTIONALLY NOT SUPPORTED: archiving or deleting a status.
 * The API exposes `archived` on PATCH, but the database does not protect against orphaning:
 * task_items.status_id has no cascade, so archiving a status that still has tasks would
 * leave those tasks pointing at a status the Board filters out — they would silently vanish
 * from the board while still existing. Until the backend enforces a reassign-or-block rule,
 * exposing that control here would be a data-visibility hazard, so it is omitted by design.
 */
export default function StatusManagerPanel(p: Props) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  // Create form — values are preserved on a recoverable error.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<StatusCategory>('todo');
  const [newColor, setNewColor] = useState<string>(SWATCHES[0]);
  const [createBusy, setCreateBusy] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState<StatusCategory>('todo');
  const [editColor, setEditColor] = useState<string>(SWATCHES[0]);

  const ordered = [...p.statuses]
    .filter(s => !s.archived_at)
    .sort((a, b) => a.position - b.position);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); p.onClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input:not([disabled]),select,[tabindex]:not([tabindex="-1"])'
      );
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [p]);

  const say = (msg: string) => { setAnnounce(msg); setTimeout(() => setAnnounce(''), 2000); };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (createBusy) return;
    setError(null);
    const name = newName.trim();
    if (!name) { setError('Status name is required.'); return; }
    if (name.length > 60) { setError('Status name must be 60 characters or fewer.'); return; }
    if (!HEX.test(newColor)) { setError('Colour must be a 6-digit hex value such as #2563EB.'); return; }
    if (ordered.some(s => s.name.toLowerCase() === name.toLowerCase())) {
      setError(`“${name}” already exists in this Space.`); return;
    }
    setCreateBusy(true);
    try {
      const last = ordered[ordered.length - 1];
      await p.api.createStatus({
        spaceId: p.spaceId, name, category: newCategory, color: newColor,
        position: (last ? last.position : 0) + 1000
      } as any);
      // Only clear the form on SUCCESS — a recoverable error keeps what was typed.
      setNewName(''); setNewCategory('todo'); setNewColor(SWATCHES[0]); setCreating(false);
      say(`Status ${name} created.`);
      p.onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not create the status.');
    } finally {
      setCreateBusy(false);
    }
  };

  const beginEdit = (s: TaskStatus) => {
    setEditId(s.id); setEditName(s.name); setEditCategory(s.category);
    setEditColor(s.color && HEX.test(s.color) ? s.color : SWATCHES[0]);
    setError(null);
  };

  const saveEdit = async (s: TaskStatus) => {
    setError(null);
    const name = editName.trim();
    if (!name) { setError('Status name is required.'); return; }
    if (!HEX.test(editColor)) { setError('Colour must be a 6-digit hex value such as #2563EB.'); return; }
    if (ordered.some(x => x.id !== s.id && x.name.toLowerCase() === name.toLowerCase())) {
      setError(`“${name}” already exists in this Space.`); return;
    }
    setBusyId(s.id);
    try {
      await p.api.updateStatus(s.id, {
        version: s.version, name, category: editCategory, color: editColor
      });
      setEditId(null);
      say(`Status ${name} updated.`);
      p.onChanged();
    } catch (err: any) {
      // Keeps the edit row open with the user's values intact.
      setError(err?.message ?? 'Could not save the status.');
    } finally {
      setBusyId(null);
    }
  };

  const move = async (s: TaskStatus, dir: -1 | 1) => {
    const i = ordered.findIndex(x => x.id === s.id);
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    setBusyId(s.id); setError(null);
    try {
      // Step just past the neighbour rather than renumbering every row.
      const target = ordered[j].position + (dir === 1 ? 1 : -1);
      await p.api.updateStatus(s.id, { version: s.version, position: target });
      say(`${s.name} moved ${dir === 1 ? 'down' : 'up'} to position ${j + 1} of ${ordered.length}.`);
      p.onChanged();
    } catch (err: any) {
      setError(err?.message ?? 'Could not reorder the status.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DialogPortal>
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={p.onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={e => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto"
      >
        <header className="bg-[#0b1424] text-white p-5 rounded-t-2xl flex items-start justify-between sticky top-0 z-10">
          <div className="min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
              Custom statuses
            </span>
            <h2 id={headingId} className="text-sm font-bold truncate">{p.spaceName}</h2>
          </div>
          <button
            ref={closeRef} onClick={p.onClose} aria-label="Close status manager"
            className="text-slate-300 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none rounded shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Polite live region so reorder/save outcomes are announced to screen readers. */}
        <div ref={liveRef} role="status" aria-live="polite" className="sr-only">{announce}</div>

        <div className="p-5 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <ol className="space-y-2" aria-label="Statuses in display order">
            {ordered.map((s, idx) => {
              const editing = editId === s.id;
              const busy = busyId === s.id;
              return (
                <li key={s.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  {editing ? (
                    <div className="space-y-2">
                      <label className="block">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Name</span>
                        <input
                          autoFocus value={editName} maxLength={60}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveEdit(s); }}
                          className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Category</span>
                        <select
                          value={editCategory}
                          onChange={e => setEditCategory(e.target.value as StatusCategory)}
                          className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold cursor-pointer"
                        >
                          {CATEGORIES.map(c => (
                            <option key={c.value} value={c.value}>{c.label} — {c.hint}</option>
                          ))}
                        </select>
                      </label>
                      <fieldset>
                        <legend className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Colour</legend>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {SWATCHES.map(c => (
                            <button
                              key={c} type="button" onClick={() => setEditColor(c)}
                              aria-label={`Use colour ${c}`} aria-pressed={editColor === c}
                              className={`w-6 h-6 rounded-full border-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${
                                editColor === c ? 'border-slate-900' : 'border-white'
                              }`}
                              style={{ background: c }}
                            />
                          ))}
                        </div>
                      </fieldset>
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditId(null)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none">
                          Cancel
                        </button>
                        <button onClick={() => saveEdit(s)} disabled={busy}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none">
                          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-slate-200"
                        style={{ background: s.color ?? '#94A3B8' }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-800 block truncate">
                          {s.name}
                          {s.is_default && (
                            <span className="ml-1.5 text-[9px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                              Default
                            </span>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-500 font-semibold">
                          {CATEGORIES.find(c => c.value === s.category)?.label}
                          {' · '}position {idx + 1} of {ordered.length}
                        </span>
                      </span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => move(s, -1)} disabled={idx === 0 || busy}
                          aria-label={`Move ${s.name} up`}
                          className="p-1 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => move(s, 1)} disabled={idx === ordered.length - 1 || busy}
                          aria-label={`Move ${s.name} down`}
                          className="p-1 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => beginEdit(s)} disabled={busy}
                          aria-label={`Edit ${s.name}`}
                          className="p-1 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
                        >
                          <Palette className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
            {ordered.length === 0 && (
              <li className="text-[11px] text-slate-500 font-medium text-center py-4">
                This Space has no statuses yet.
              </li>
            )}
          </ol>

          {creating ? (
            <form onSubmit={create} className="bg-white border border-blue-200 rounded-xl p-3 space-y-2">
              <label className="block">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">New status name</span>
                <input
                  autoFocus value={newName} maxLength={60} required
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. In Review"
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </label>
              <label className="block">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Category</span>
                <select
                  value={newCategory} onChange={e => setNewCategory(e.target.value as StatusCategory)}
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold cursor-pointer"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label} — {c.hint}</option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend className="text-[9px] font-black text-slate-500 uppercase tracking-wider">Colour</legend>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {SWATCHES.map(c => (
                    <button
                      key={c} type="button" onClick={() => setNewColor(c)}
                      aria-label={`Use colour ${c}`} aria-pressed={newColor === c}
                      className={`w-6 h-6 rounded-full border-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none ${
                        newColor === c ? 'border-slate-900' : 'border-white'
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </fieldset>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setCreating(false); setError(null); }}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none">
                  Cancel
                </button>
                <button type="submit" disabled={createBusy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none">
                  {createBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                  Add status
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={() => { setCreating(true); setError(null); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add a status
            </button>
          )}

          <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-100 pt-3">
            Statuses cannot be removed here. A status may still be referenced by existing
            tasks, and removing it would hide those tasks from the Board without deleting
            them. Rename or recolour a status instead.
          </p>
        </div>
      </div>
    </div>
    </DialogPortal>
  );
}
