import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import {
  X, Loader2, AlertTriangle, Plus, Archive, RotateCcw, Clock, ListTree, History, Pencil
} from 'lucide-react';
import {
  TaskApi, TaskApiError, TaskItem, TaskStatus, WorkspaceActor, TimeEntry, ActivityEvent,
  formatTracked
} from '../../tasks/apiClient';
import { TimerToggleButton } from './ActiveTimerBar';
import type { ActiveTimerState } from '../../hooks/useActiveTaskTimer';
import DialogPortal from './DialogPortal';

interface Props {
  api: TaskApi;
  taskId: string;
  statuses: TaskStatus[];
  actors: WorkspaceActor[];
  timer: ActiveTimerState;
  timeTrackingEnabled: boolean;
  canMutate: (t: TaskItem) => boolean;
  canCreateTask: boolean;
  onClose: () => void;
  onEdit: (t: TaskItem) => void;
  onAddSubtask: (parent: TaskItem) => void;
  onChanged: () => void;
}

export default function TaskDetailDrawer(p: Props) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [task, setTask] = useState<TaskItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [entriesState, setEntriesState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [activityState, setActivityState] = useState<'idle' | 'loading' | 'error'>('idle');

  const [manualOpen, setManualOpen] = useState(false);
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const [manualNote, setManualNote] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const manualDirty = manualOpen && (manualStart !== '' || manualEnd !== '' || manualNote !== '');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      setTask(await p.api.getTask(p.taskId, signal));
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Could not load this task.');
    } finally {
      setLoading(false);
    }
  }, [p.api, p.taskId]);

  // Each section loads independently so one failure does not blank the whole drawer.
  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    const ac = new AbortController();
    setActivityState('loading');
    p.api.activity(p.taskId, ac.signal)
      .then(a => { setActivity(a); setActivityState('idle'); })
      .catch(e => { if (e?.name !== 'AbortError') setActivityState('error'); });
    return () => ac.abort();
  }, [p.api, p.taskId]);

  const loadEntries = useCallback(async () => {
    if (!p.timeTrackingEnabled) return;
    setEntriesState('loading');
    try {
      const r = await p.api.taskTimeEntries(p.taskId);
      setEntries(r.entries); setEntriesState('idle');
    } catch { setEntriesState('error'); }
  }, [p.api, p.taskId, p.timeTrackingEnabled]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const requestClose = useCallback(() => {
    if (manualDirty && !window.confirm('Discard the time entry you were adding?')) return;
    p.onClose();
  }, [manualDirty, p]);

  // Focus management: move focus in, trap Tab, restore on close.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [requestClose]);

  const statusById = new Map(p.statuses.map(s => [s.id, s]));
  const actorName = (id: string | null) => {
    if (!id) return 'System';
    const a = p.actors.find(x => x.actorId === id);
    return a?.displayName || a?.email || 'Unknown';
  };

  const trackedSeconds = entries.reduce((sum, e) => {
    const end = e.ended_at ? Date.parse(e.ended_at) : Date.now();
    return sum + Math.max(0, Math.floor((end - Date.parse(e.started_at)) / 1000));
  }, 0);

  const mutable = task ? p.canMutate(task) : false;

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (manualBusy) return;
    setManualError(null);
    if (!manualStart || !manualEnd) { setManualError('Both start and end are required.'); return; }
    if (Date.parse(manualEnd) <= Date.parse(manualStart)) {
      setManualError('End must be after start.'); return;
    }
    setManualBusy(true);
    try {
      await p.api.addManualEntry({
        taskId: p.taskId,
        startedAt: new Date(manualStart).toISOString(),
        endedAt: new Date(manualEnd).toISOString(),
        note: manualNote.trim() || undefined
      });
      setManualOpen(false); setManualStart(''); setManualEnd(''); setManualNote('');
      await loadEntries();
      p.onChanged();
    } catch (err: any) {
      setManualError(err?.message ?? 'Could not add the time entry.');
    } finally {
      setManualBusy(false);
    }
  };

  const archiveEntry = async (entry: TimeEntry) => {
    if (!window.confirm('Archive this time entry? It will no longer count toward totals.')) return;
    try {
      await p.api.updateTimeEntry(entry.id, { archived: true });
      await loadEntries();
      p.onChanged();
    } catch (err: any) {
      setEntriesState('error');
    }
  };

  const toggleArchive = async () => {
    if (!task) return;
    const archiving = !task.archived_at;
    if (archiving && !window.confirm(`Archive “${task.title}”? You can restore it later.`)) return;
    try {
      const updated = archiving
        ? await p.api.archiveTask(task.id, task.version)
        : await p.api.restoreTask(task.id, task.version);
      setTask(prev => (prev ? { ...prev, ...updated } : updated));
      p.onChanged();
    } catch (err: any) {
      setError(err instanceof TaskApiError && err.code === 'TASK_VERSION_CONFLICT'
        ? 'This task changed elsewhere. Close and reopen it, then try again.'
        : err?.message ?? 'Could not update the task.');
    }
  };

  return (
    <DialogPortal>
    <div className="fixed inset-0 z-50 flex justify-end" onClick={requestClose}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={e => e.stopPropagation()}
        className="relative bg-white w-full sm:max-w-xl h-full overflow-y-auto shadow-2xl flex flex-col"
      >
        <header className="bg-[#0b1424] text-white p-5 flex items-start justify-between gap-3 sticky top-0 z-10">
          <div className="min-w-0">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">
              Task details
            </span>
            <h2 id={headingId} className="text-sm font-bold mt-0.5 break-words">
              {loading ? 'Loading…' : task?.title ?? 'Task'}
            </h2>
          </div>
          <button
            ref={closeRef} onClick={requestClose} aria-label="Close task details"
            className="text-slate-300 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none rounded shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-5 space-y-6 flex-1">
          {loading && (
            <div className="py-12 text-center" role="status" aria-live="polite">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin mx-auto" aria-hidden="true" />
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {task && !loading && (
            <>
              {/* Summary */}
              <section className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                    {statusById.get(task.status_id)?.name ?? 'Unknown status'}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                    {task.priority}
                  </span>
                  {task.archived_at && (
                    <span className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-50 border-amber-200 text-amber-700">
                      Archived
                    </span>
                  )}
                </div>

                {task.description && (
                  <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap break-words">
                    {task.description}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-3 text-[11px]">
                  <div><dt className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Start</dt>
                    <dd className="text-slate-700 font-semibold">{task.start_date ? new Date(task.start_date).toLocaleDateString() : '—'}</dd></div>
                  <div><dt className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Due</dt>
                    <dd className="text-slate-700 font-semibold">{task.due_date ? new Date(task.due_date).toLocaleDateString() : '—'}</dd></div>
                  <div><dt className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Estimate</dt>
                    <dd className="text-slate-700 font-semibold">{task.time_estimate_seconds ? formatTracked(task.time_estimate_seconds) : '—'}</dd></div>
                  <div><dt className="text-slate-500 font-bold uppercase tracking-wider text-[9px]">Tracked</dt>
                    <dd className="text-slate-700 font-semibold font-mono">{trackedSeconds ? formatTracked(trackedSeconds) : '—'}</dd></div>
                </dl>

                <div>
                  <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider mb-1">Assignees</p>
                  <div className="flex flex-wrap gap-1">
                    {task.assigneeActorIds.length === 0 && <span className="text-[11px] text-slate-500">Unassigned</span>}
                    {task.assigneeActorIds.map(id => (
                      <span key={id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-1.5 py-0.5 rounded">
                        {actorName(id)}
                      </span>
                    ))}
                  </div>
                </div>

                {/* READ_ONLY sees no mutation controls at all. */}
                {mutable && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => p.onEdit(task)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" aria-hidden="true" /> Edit
                    </button>
                    {p.timeTrackingEnabled && !task.archived_at && (
                      <TimerToggleButton taskId={task.id} timer={p.timer} label />
                    )}
                    <button
                      onClick={toggleArchive}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none transition-colors cursor-pointer"
                    >
                      {task.archived_at
                        ? <><RotateCcw className="w-3 h-3" aria-hidden="true" /> Restore</>
                        : <><Archive className="w-3 h-3" aria-hidden="true" /> Archive</>}
                    </button>
                  </div>
                )}
              </section>

              {/* Subtasks — only offered on a ROOT task, so one level is enforced in the UI
                  as well as in the database. */}
              <section className="space-y-2">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <ListTree className="w-3.5 h-3.5" aria-hidden="true" />
                  Subtasks ({task.subtasks?.length ?? 0})
                </h3>
                <ul className="space-y-1">
                  {(task.subtasks ?? []).map(s => (
                    <li key={s.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                      <span className="text-[11px] font-semibold text-slate-700 truncate">{s.title}</span>
                      <span className="text-[9px] font-black uppercase text-slate-500 shrink-0">
                        {statusById.get(s.status_id)?.name ?? ''}
                      </span>
                    </li>
                  ))}
                  {(task.subtasks?.length ?? 0) === 0 && (
                    <li className="text-[11px] text-slate-500 font-medium">No subtasks.</li>
                  )}
                </ul>
                {task.parent_task_id === null && p.canCreateTask && !task.archived_at && (
                  <button
                    onClick={() => p.onAddSubtask(task)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" /> Add subtask
                  </button>
                )}
              </section>

              {/* Time entries */}
              {p.timeTrackingEnabled && (
                <section className="space-y-2">
                  <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Time entries
                  </h3>
                  {entriesState === 'loading' && <p className="text-[11px] text-slate-500">Loading…</p>}
                  {entriesState === 'error' && (
                    <button onClick={loadEntries} className="text-[11px] text-rose-600 font-bold underline cursor-pointer">
                      Could not load entries — retry
                    </button>
                  )}
                  {entriesState === 'idle' && entries.length === 0 && (
                    <p className="text-[11px] text-slate-500 font-medium">
                      No time recorded yet.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {entries.map(e => (
                      <li key={e.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <span className="min-w-0">
                          <span className="text-[11px] font-semibold text-slate-700 block truncate">
                            {actorName(e.actor_id)} · {e.source === 'manual' ? 'Manual' : 'Timer'}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {new Date(e.started_at).toLocaleString()}
                            {e.note ? ` — ${e.note}` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-mono font-bold text-slate-600">
                            {e.ended_at
                              ? formatTracked((Date.parse(e.ended_at) - Date.parse(e.started_at)) / 1000)
                              : 'running'}
                          </span>
                          {mutable && e.ended_at && (
                            <button
                              onClick={() => archiveEntry(e)}
                              aria-label="Archive this time entry"
                              className="p-0.5 text-slate-500 hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:outline-none rounded cursor-pointer"
                            >
                              <Archive className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {mutable && !manualOpen && (
                    <button
                      onClick={() => setManualOpen(true)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3" aria-hidden="true" /> Add time manually
                    </button>
                  )}

                  {manualOpen && (
                    <form onSubmit={submitManual} className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      {manualError && (
                        <p role="alert" className="text-[11px] text-rose-700 font-bold">{manualError}</p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">Start</span>
                          <input type="datetime-local" required value={manualStart}
                            onChange={e => setManualStart(e.target.value)}
                            className="w-full text-[11px] p-1.5 bg-white border border-slate-200 rounded focus:border-blue-500 outline-none" />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[9px] font-black text-slate-500 uppercase tracking-wider block">End</span>
                          <input type="datetime-local" required value={manualEnd} min={manualStart || undefined}
                            onChange={e => setManualEnd(e.target.value)}
                            className="w-full text-[11px] p-1.5 bg-white border border-slate-200 rounded focus:border-blue-500 outline-none" />
                        </label>
                      </div>
                      <input type="text" maxLength={2000} placeholder="Note (optional)" value={manualNote}
                        onChange={e => setManualNote(e.target.value)}
                        className="w-full text-[11px] p-1.5 bg-white border border-slate-200 rounded focus:border-blue-500 outline-none" />
                      <div className="flex gap-2 justify-end">
                        <button type="button" onClick={() => { setManualOpen(false); setManualError(null); }}
                          className="px-2.5 py-1 rounded text-[11px] font-bold bg-white border border-slate-200 text-slate-600 cursor-pointer">
                          Cancel
                        </button>
                        <button type="submit" disabled={manualBusy}
                          className="px-2.5 py-1 rounded text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50">
                          {manualBusy ? 'Adding…' : 'Add entry'}
                        </button>
                      </div>
                    </form>
                  )}
                </section>
              )}

              {/* Activity */}
              <section className="space-y-2">
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" aria-hidden="true" /> Activity
                </h3>
                {activityState === 'loading' && <p className="text-[11px] text-slate-500">Loading…</p>}
                {activityState === 'error' && <p className="text-[11px] text-slate-500">Activity unavailable.</p>}
                <ol className="space-y-1">
                  {activity.map(a => (
                    <li key={a.id} className="text-[11px] text-slate-500 flex gap-2">
                      <span className="text-slate-500 shrink-0 font-mono">
                        {new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="font-semibold text-slate-600">{actorName(a.actor_id)}</span>
                      <span className="text-slate-500">{a.action.replace(/_/g, ' ').toLowerCase()}</span>
                    </li>
                  ))}
                  {activityState === 'idle' && activity.length === 0 && (
                    <li className="text-[11px] text-slate-500 font-medium">No activity recorded.</li>
                  )}
                </ol>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
    </DialogPortal>
  );
}
