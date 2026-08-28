import React from 'react';
import {
  Loader2, AlertTriangle, Inbox, ChevronLeft, ChevronRight, ListTree, Archive, RotateCcw
} from 'lucide-react';
import {
  TaskItem, TaskStatus, WorkspaceActor, PageInfo, formatTracked, formatTrackedDuration
} from '../../tasks/apiClient';
import { TimerToggleButton } from './ActiveTimerBar';
import type { ActiveTimerState } from '../../hooks/useActiveTaskTimer';

interface Props {
  tasks: TaskItem[];
  page?: PageInfo;
  loading: boolean;
  error: string | null;
  statuses: TaskStatus[];
  actors: WorkspaceActor[];
  trackedByTask: Map<string, number>;
  timer: ActiveTimerState;
  timeTrackingEnabled: boolean;
  canMutate: (t: TaskItem) => boolean;
  onOpenTask: (id: string) => void;
  onArchiveToggle: (t: TaskItem) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
}

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-rose-50 text-rose-700 border-rose-200',
  high: 'bg-amber-50 text-amber-700 border-amber-200',
  normal: 'bg-slate-100 text-slate-600 border-slate-200',
  low: 'bg-slate-100 text-slate-600 border-slate-300'
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function isOverdue(iso: string | null): boolean {
  return !!iso && Date.parse(iso) < Date.now();
}

export default function TaskListView(p: Props) {
  const statusById = new Map(p.statuses.map(s => [s.id, s]));
  const actorName = (id: string) => {
    const a = p.actors.find(x => x.actorId === id);
    return a?.displayName || a?.email || 'Unknown';
  };

  if (p.loading) {
    return (
      <div className="py-16 text-center space-y-2" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" aria-hidden="true" />
        <p className="text-xs text-slate-600">Loading tasks…</p>
      </div>
    );
  }

  if (p.error) {
    return (
      <div role="alert" className="bg-white border border-rose-200 rounded-xl p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-800">Could not load tasks</p>
        <p className="text-xs text-slate-500 max-w-md mx-auto">{p.error}</p>
        <button
          onClick={p.onRetry}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!p.tasks.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-700">No tasks here yet</p>
        <p className="text-xs text-slate-500 mt-1">
          Adjust your filters, or create the first task in this List.
        </p>
      </div>
    );
  }

  const totalPages = p.page ? Math.max(1, Math.ceil(p.page.total / p.page.pageSize)) : 1;

  return (
    <div className="space-y-3">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Tasks, with status, priority, assignees and dates</caption>
            <thead className="bg-[#f8fafc] border-b border-slate-200 text-[10px] text-slate-500 uppercase font-black">
              <tr>
                <th scope="col" className="p-4 pl-5">Task</th>
                <th scope="col" className="p-4">Status</th>
                <th scope="col" className="p-4">Priority</th>
                <th scope="col" className="p-4">Assignees</th>
                <th scope="col" className="p-4">Due</th>
                <th scope="col" className="p-4">Tracked</th>
                <th scope="col" className="p-4 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {p.tasks.map(t => {
                const st = statusById.get(t.status_id);
                const tracked = p.trackedByTask.get(t.id) ?? 0;
                const mutable = p.canMutate(t);
                return (
                  <tr key={t.id} className={`hover:bg-slate-50/50 ${t.archived_at ? 'opacity-60' : ''}`}>
                    <td className="p-4 pl-5 max-w-xs">
                      <button
                        onClick={() => p.onOpenTask(t.id)}
                        className="font-bold text-slate-900 hover:text-blue-700 text-left truncate block max-w-full focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none rounded cursor-pointer"
                      >
                        {t.title}
                      </button>
                      <span className="flex items-center gap-2 mt-0.5">
                        {t.subtaskCount ? (
                          <span className="text-[10px] text-slate-500 font-semibold inline-flex items-center gap-0.5">
                            <ListTree className="w-2.5 h-2.5" aria-hidden="true" />
                            {t.subtaskCount} subtask{t.subtaskCount === 1 ? '' : 's'}
                          </span>
                        ) : null}
                        {t.archived_at && (
                          <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                            Archived
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="p-4">
                      <span
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600"
                        /* The status colour tints the border and the dot only. It is NOT used
                           as the text colour: the colour is chosen by a workspace manager, so
                           a light or muted pick would silently drop the label below 4.5:1.
                           The dot carries the colour; the label stays readable. */
                        style={st?.color ? { borderColor: `${st.color}55` } : undefined}
                      >
                        <span
                          className="w-1 h-1 rounded-full bg-slate-400"
                          style={st?.color ? { background: st.color } : undefined}
                          aria-hidden="true"
                        />
                        {st?.name ?? 'Unknown'}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${PRIORITY_STYLE[t.priority]}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {t.assigneeActorIds.length === 0 && <span className="text-slate-500">—</span>}
                        {t.assigneeActorIds.slice(0, 2).map(id => (
                          <span key={id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-1.5 py-0.5 rounded truncate max-w-[80px]">
                            {actorName(id)}
                          </span>
                        ))}
                        {t.assigneeActorIds.length > 2 && (
                          <span className="text-[10px] text-slate-500 font-bold">
                            +{t.assigneeActorIds.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className={`p-4 text-[11px] font-semibold ${isOverdue(t.due_date) && !t.archived_at ? 'text-rose-600' : 'text-slate-500'}`}>
                      {fmtDate(t.due_date)}
                    </td>
                    <td className="p-4 text-[11px] font-mono font-bold text-slate-600 tabular-nums">
                      {formatTrackedDuration(tracked)}
                      {t.time_estimate_seconds ? (
                        <span className="text-slate-500 font-sans font-semibold">
                          {' '}/ {formatTracked(t.time_estimate_seconds)}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-4 pr-5">
                      <div className="flex items-center justify-end gap-1.5">
                        {p.timeTrackingEnabled && !t.archived_at && mutable && (
                          <TimerToggleButton taskId={t.id} timer={p.timer} />
                        )}
                        {mutable && (
                          <button
                            onClick={() => p.onArchiveToggle(t)}
                            aria-label={t.archived_at ? 'Restore task' : 'Archive task'}
                            title={t.archived_at ? 'Restore' : 'Archive'}
                            className="p-1 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
                          >
                            {t.archived_at
                              ? <RotateCcw className="w-3.5 h-3.5" />
                              : <Archive className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards — same data, no horizontal scrolling */}
        <ul className="md:hidden divide-y divide-slate-100">
          {p.tasks.map(t => {
            const st = statusById.get(t.status_id);
            const tracked = p.trackedByTask.get(t.id) ?? 0;
            return (
              <li key={t.id} className={`p-4 space-y-2 ${t.archived_at ? 'opacity-60' : ''}`}>
                <button
                  onClick={() => p.onOpenTask(t.id)}
                  className="font-bold text-slate-900 text-sm text-left w-full focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none rounded cursor-pointer"
                >
                  {t.title}
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full border bg-slate-50 border-slate-200 text-slate-600">
                    {st?.name ?? 'Unknown'}
                  </span>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${PRIORITY_STYLE[t.priority]}`}>
                    {t.priority}
                  </span>
                  {t.due_date && (
                    <span className={`text-[10px] font-bold ${isOverdue(t.due_date) ? 'text-rose-600' : 'text-slate-500'}`}>
                      Due {fmtDate(t.due_date)}
                    </span>
                  )}
                  {tracked > 0 && (
                    <span className="text-[10px] font-mono font-bold text-slate-500">
                      {formatTrackedDuration(tracked)}
                    </span>
                  )}
                  {/* Archived state must be stated in text, not carried by opacity alone —
                      a reduced-opacity card is indistinguishable for anyone who cannot
                      compare it against an active one. */}
                  {t.archived_at && (
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                      Archived
                    </span>
                  )}
                </div>
                {/* Capability parity with the desktop table: without this, archiving and
                    restoring were reachable only from the detail drawer on narrow screens. */}
                {p.canMutate(t) && (
                  <div className="flex items-center gap-2">
                    {p.timeTrackingEnabled && !t.archived_at && (
                      <TimerToggleButton taskId={t.id} timer={p.timer} label />
                    )}
                    <button
                      onClick={() => p.onArchiveToggle(t)}
                      aria-label={t.archived_at ? 'Restore task' : 'Archive task'}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
                    >
                      {t.archived_at
                        ? <><RotateCcw className="w-3 h-3" aria-hidden="true" /> Restore</>
                        : <><Archive className="w-3 h-3" aria-hidden="true" /> Archive</>}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {p.page && totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Task pagination">
          <p className="text-[11px] text-slate-500 font-semibold">
            Page {p.page.page} of {totalPages} · {p.page.total} task{p.page.total === 1 ? '' : 's'}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => p.onPageChange(p.page!.page - 1)}
              disabled={p.page.page <= 1}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" /> Previous
            </button>
            <button
              onClick={() => p.onPageChange(p.page!.page + 1)}
              disabled={p.page.page >= totalPages}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
            >
              Next <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
