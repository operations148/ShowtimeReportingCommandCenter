import React, { useState } from 'react';
import { Loader2, AlertTriangle, MoveRight, Inbox } from 'lucide-react';
import { TaskItem, TaskStatus, WorkspaceActor, formatTracked } from '../../tasks/apiClient';
import { TimerToggleButton } from './ActiveTimerBar';
import type { ActiveTimerState } from '../../hooks/useActiveTaskTimer';

interface Props {
  tasks: TaskItem[];
  statuses: TaskStatus[];
  actors: WorkspaceActor[];
  trackedByTask: Map<string, number>;
  timer: ActiveTimerState;
  timeTrackingEnabled: boolean;
  loading: boolean;
  error: string | null;
  canMutate: (t: TaskItem) => boolean;
  onOpenTask: (id: string) => void;
  onMoveTask: (task: TaskItem, statusId: string) => Promise<void>;
  onRetry: () => void;
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-rose-500', high: 'bg-amber-500', normal: 'bg-slate-300', low: 'bg-slate-200'
};

/**
 * Status-grouped board.
 *
 * Movement is done with an explicit "Move to status" <select>, not drag-and-drop. That is a
 * deliberate V1 decision (D5): a native select is keyboard-operable, screen-reader friendly
 * and works on touch without a gesture library or a new dependency. Drag can be layered on
 * later as an *additional* affordance, but it must never become the only way to move a task.
 */
export default function TaskBoardView(p: Props) {
  const [movingId, setMovingId] = useState<string | null>(null);

  if (p.loading) {
    return (
      <div className="py-16 text-center space-y-2" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" aria-hidden="true" />
        <p className="text-xs text-slate-600">Loading board…</p>
      </div>
    );
  }
  if (p.error) {
    return (
      <div role="alert" className="bg-white border border-rose-200 rounded-xl p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-800">Could not load the board</p>
        <p className="text-xs text-slate-500">{p.error}</p>
        <button
          onClick={p.onRetry}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const columns = p.statuses.filter(s => !s.archived_at).sort((a, b) => a.position - b.position);
  if (!columns.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-700">No statuses in this Space</p>
        <p className="text-xs text-slate-500 mt-1">Add a status to start using the board.</p>
      </div>
    );
  }

  const actorName = (id: string) => {
    const a = p.actors.find(x => x.actorId === id);
    return a?.displayName || a?.email || 'Unknown';
  };

  const move = async (task: TaskItem, statusId: string) => {
    if (statusId === task.status_id) return;
    setMovingId(task.id);
    try {
      // No optimistic mutation: the container refetches authoritative data afterwards, so a
      // rejected move (stale version, permission, entitlement) can never leave the board
      // showing a change the server did not accept.
      await p.onMoveTask(task, statusId);
    } finally {
      setMovingId(null);
    }
  };

  return (
    // Columns scroll horizontally inside their own container so the page body never does.
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-4 min-w-min">
        {columns.map(col => {
          const items = p.tasks.filter(t => t.status_id === col.id);
          return (
            <section
              key={col.id}
              aria-label={`${col.name} column, ${items.length} task${items.length === 1 ? '' : 's'}`}
              className="w-72 shrink-0 bg-slate-50 border border-slate-200 rounded-xl flex flex-col max-h-[70vh]"
            >
              <header className="p-3 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-slate-50 rounded-t-xl">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full bg-slate-400 shrink-0"
                    style={col.color ? { background: col.color } : undefined}
                    aria-hidden="true"
                  />
                  <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-700 truncate">
                    {col.name}
                  </h3>
                </span>
                <span className="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-1.5 rounded shrink-0">
                  {items.length}
                </span>
              </header>

              <ul className="p-2 space-y-2 overflow-y-auto flex-1">
                {items.length === 0 && (
                  <li className="text-[11px] text-slate-500 text-center py-6 font-medium">
                    Nothing here
                  </li>
                )}
                {items.map(t => {
                  const tracked = p.trackedByTask.get(t.id) ?? 0;
                  const mutable = p.canMutate(t);
                  return (
                    <li
                      key={t.id}
                      className={`bg-white border border-slate-200 rounded-lg p-2.5 space-y-2 shadow-xs ${
                        movingId === t.id ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-start gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[t.priority]}`}
                          aria-label={`Priority: ${t.priority}`}
                        />
                        <button
                          onClick={() => p.onOpenTask(t.id)}
                          className="text-xs font-bold text-slate-900 hover:text-blue-700 text-left flex-1 min-w-0 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none rounded cursor-pointer"
                        >
                          {t.title}
                        </button>
                      </div>

                      {(t.assigneeActorIds.length > 0 || tracked > 0 || t.subtaskCount) && (
                        <div className="flex flex-wrap items-center gap-1 pl-3">
                          {t.assigneeActorIds.slice(0, 2).map(id => (
                            <span key={id} className="text-[9px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-1.5 rounded truncate max-w-[90px]">
                              {actorName(id)}
                            </span>
                          ))}
                          {t.subtaskCount ? (
                            <span className="text-[9px] text-slate-500 font-bold">
                              {t.subtaskCount} sub
                            </span>
                          ) : null}
                          {tracked > 0 && (
                            <span className="text-[9px] font-mono font-bold text-slate-500">
                              {formatTracked(tracked)}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 pl-3">
                        {mutable ? (
                          <>
                            {/* The accessible move control. */}
                            <label className="sr-only" htmlFor={`move-${t.id}`}>
                              Move “{t.title}” to a different status
                            </label>
                            <span className="relative flex-1 min-w-0">
                              <MoveRight
                                className="w-3 h-3 text-slate-500 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
                                aria-hidden="true"
                              />
                              <select
                                id={`move-${t.id}`}
                                value={t.status_id}
                                disabled={movingId === t.id}
                                onChange={e => move(t, e.target.value)}
                                className="w-full text-[10px] font-bold pl-6 pr-1 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-600 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus:outline-none disabled:opacity-50"
                              >
                                {columns.map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </span>
                            {p.timeTrackingEnabled && !t.archived_at && (
                              <TimerToggleButton taskId={t.id} timer={p.timer} />
                            )}
                          </>
                        ) : (
                          <span className="text-[9px] text-slate-500 font-semibold italic">
                            View only
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
