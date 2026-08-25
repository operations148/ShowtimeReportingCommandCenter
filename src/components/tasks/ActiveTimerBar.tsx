import React from 'react';
import { Play, Square, AlertTriangle, Loader2 } from 'lucide-react';
import { formatDuration, TaskItem } from '../../tasks/apiClient';
import type { ActiveTimerState } from '../../hooks/useActiveTaskTimer';

interface Props {
  timer: ActiveTimerState;
  /** Title lookup so the bar can name the running task without another request. */
  taskTitleById: (id: string) => string | undefined;
  onOpenTask: (taskId: string) => void;
}

/**
 * Persistent running-timer indicator.
 *
 * The elapsed value comes from the hook, which recomputes it from the server's started_at.
 * Nothing here is authoritative; this is a display surface with a stop control.
 */
export default function ActiveTimerBar({ timer, taskTitleById, onOpenTask }: Props) {
  const { activeTimer, elapsedSeconds, busy, error, conflict } = timer;

  // A conflict must be resolved explicitly, so it takes precedence over the running display.
  if (conflict) {
    const title = taskTitleById(conflict.taskId) ?? 'another task';
    return (
      <div
        role="alertdialog"
        aria-labelledby="timer-conflict-title"
        className="flex flex-col sm:flex-row sm:items-center gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 no-print"
      >
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p id="timer-conflict-title" className="text-xs font-bold text-amber-900">
            A timer is already running on “{title}”.
          </p>
          <p className="text-[11px] text-amber-700 font-medium">
            Stop it and start the new one, or keep the current timer running.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => timer.switchTo(conflict.requestedTaskId)}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none transition-colors cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Switching…' : 'Stop it and switch'}
          </button>
          <button
            onClick={timer.dismissConflict}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none transition-colors cursor-pointer"
          >
            Keep current timer
          </button>
        </div>
      </div>
    );
  }

  if (!activeTimer) return null;

  const title = taskTitleById(activeTimer.task_id) ?? 'Untitled task';

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-[#0b1424] text-white rounded-xl px-4 py-3 no-print">
      <span className="flex items-center gap-2 shrink-0">
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
          Tracking
        </span>
      </span>

      <button
        onClick={() => onOpenTask(activeTimer.task_id)}
        className="flex-1 min-w-0 text-left text-xs font-bold truncate hover:underline focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none rounded cursor-pointer"
      >
        {title}
      </button>

      {/* aria-live so screen readers hear the running total without it being announced
          every single second (polite, and only the minute-level change matters). */}
      <span
        className="font-mono text-sm font-bold tabular-nums shrink-0"
        aria-live="off"
      >
        {formatDuration(elapsedSeconds)}
      </span>

      <button
        onClick={() => timer.stop(activeTimer.id)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-rose-600 hover:bg-rose-700 active:bg-rose-800 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:outline-none transition-colors cursor-pointer disabled:opacity-50 shrink-0"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
        Stop
      </button>

      {error && <span className="text-[11px] text-rose-300 font-semibold shrink-0">{error}</span>}
    </div>
  );
}

/** Compact start/stop control used inside rows and cards. */
export function TimerToggleButton({
  taskId, timer, disabled, label
}: { taskId: string; timer: ActiveTimerState; disabled?: boolean; label?: boolean }) {
  const isRunning = timer.activeTimer?.task_id === taskId;
  const Icon = isRunning ? Square : Play;
  return (
    <button
      onClick={() => (isRunning ? timer.stop(timer.activeTimer!.id) : timer.start(taskId))}
      disabled={disabled || timer.busy}
      aria-label={isRunning ? 'Stop timer for this task' : 'Start timer for this task'}
      title={isRunning ? 'Stop timer' : 'Start timer'}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer disabled:opacity-40 focus-visible:ring-2 focus-visible:outline-none ${
        isRunning
          ? 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 focus-visible:ring-rose-300'
          : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100 focus-visible:ring-blue-300'
      }`}
    >
      <Icon className="w-3 h-3" aria-hidden="true" />
      {label && (isRunning ? 'Stop' : 'Start')}
    </button>
  );
}
