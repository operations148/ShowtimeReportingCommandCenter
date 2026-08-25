import { useState, useEffect, useRef, useCallback } from 'react';
import {
  TaskApi, TaskApiError, ActiveTimer, newClientToken
} from '../tasks/apiClient';

/**
 * Server-authoritative active-timer state.
 *
 * The elapsed value is NEVER stored or trusted from the client. It is recomputed every
 * second from the server's `started_at`, corrected by a measured clock offset, so a wrong
 * local clock, a suspended laptop, or a paused tab cannot corrupt what the user sees — and
 * can never corrupt what is recorded, because only the database writes timestamps.
 *
 * Recovery is keyed on the global principal server-side, so the timer survives refresh,
 * logout/login, reconnect and workspace switch. This hook re-syncs on mount, on tab focus,
 * and on the browser's `online` event.
 */

export interface TimerConflict {
  /** The entry that is currently running. */
  entryId: string;
  /** The task the running timer belongs to. */
  taskId: string;
  startedAt: string;
  /** The task the user was trying to start — needed to offer "stop and switch". */
  requestedTaskId: string;
}

export interface ActiveTimerState {
  activeTimer: ActiveTimer | null;
  elapsedSeconds: number;
  loading: boolean;
  busy: boolean;
  error: string | null;
  /** Set when start returned 409 because another task is already running. */
  conflict: TimerConflict | null;
  start: (taskId: string) => Promise<void>;
  stop: (entryId?: string) => Promise<void>;
  /** Stops whatever is running, then starts on the requested task. */
  switchTo: (taskId: string) => Promise<void>;
  dismissConflict: () => void;
  refresh: () => Promise<void>;
}

export function useActiveTaskTimer(api: TaskApi, enabled: boolean): ActiveTimerState {
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [elapsedSeconds, setElapsed] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TimerConflict | null>(null);

  /** serverNow - clientNow, in ms. Keeps the display honest if the local clock is wrong. */
  const clockOffset = useRef(0);
  /** One token per user intent. Reused on retry so a retried start cannot double-create. */
  const pendingToken = useRef<{ taskId: string; token: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return; }
    try {
      const res = await api.activeTimer();
      if (res.serverTime) {
        clockOffset.current = Date.parse(res.serverTime) - Date.now();
      }
      setActiveTimer(res.activeTimer);
      setError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // A disabled module or an unresolved actor is not an error worth shouting about here;
      // the surrounding UI already explains it.
      if (err instanceof TaskApiError && err.isTerminal) setActiveTimer(null);
      else setError(err?.message ?? 'Could not load the active timer.');
    } finally {
      setLoading(false);
    }
  }, [api, enabled]);

  useEffect(() => { refresh(); }, [refresh]);

  // Re-sync whenever the tab regains focus or the connection returns, so a timer stopped
  // on another device is reflected here rather than ticking forever.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, enabled]);

  // Display-only ticker. Recomputes from started_at each tick rather than incrementing a
  // counter, so a throttled or backgrounded tab cannot drift.
  useEffect(() => {
    if (!activeTimer) { setElapsed(0); return; }
    const compute = () => {
      const serverNow = Date.now() + clockOffset.current;
      setElapsed(Math.max(0, Math.floor((serverNow - Date.parse(activeTimer.started_at)) / 1000)));
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  }, [activeTimer]);

  const start = useCallback(async (taskId: string) => {
    if (!enabled) return;
    setBusy(true); setError(null); setConflict(null);
    // Reuse the token if this is a retry of the SAME task, so the server dedupes it.
    if (pendingToken.current?.taskId !== taskId) {
      pendingToken.current = { taskId, token: newClientToken() };
    }
    try {
      const res = await api.startTimer(taskId, pendingToken.current.token);
      if (res.serverTime) clockOffset.current = Date.parse(res.serverTime) - Date.now();
      setActiveTimer({ id: res.entryId, task_id: res.taskId, started_at: res.startedAt });
      pendingToken.current = null;
    } catch (err: any) {
      if (err instanceof TaskApiError && err.code === 'TASK_TIMER_CONFLICT') {
        // Another task is running. Surface it and require an explicit decision — never
        // stop the other timer implicitly. requestedTaskId lets the UI offer a switch.
        const d = err.payload?.data ?? {};
        setConflict({
          entryId: d.entryId, taskId: d.taskId, startedAt: d.startedAt,
          requestedTaskId: taskId
        });
      } else {
        setError(err?.message ?? 'Could not start the timer.');
      }
    } finally {
      setBusy(false);
    }
  }, [api, enabled]);

  const stop = useCallback(async (entryId?: string) => {
    if (!enabled) return;
    setBusy(true); setError(null);
    try {
      await api.stopTimer(entryId);
      setActiveTimer(null);
      setConflict(null);
    } catch (err: any) {
      // Already stopped elsewhere is a benign outcome, not a failure.
      if (err instanceof TaskApiError && err.code === 'TASK_NO_ACTIVE_TIMER') setActiveTimer(null);
      else setError(err?.message ?? 'Could not stop the timer.');
    } finally {
      setBusy(false);
      refresh();
    }
  }, [api, enabled, refresh]);

  const switchTo = useCallback(async (taskId: string) => {
    setBusy(true); setError(null);
    try {
      await api.stopTimer();
      pendingToken.current = { taskId, token: newClientToken() };
      const res = await api.startTimer(taskId, pendingToken.current.token);
      setActiveTimer({ id: res.entryId, task_id: res.taskId, started_at: res.startedAt });
      pendingToken.current = null;
      setConflict(null);
    } catch (err: any) {
      setError(err?.message ?? 'Could not switch the timer.');
    } finally {
      setBusy(false);
    }
  }, [api]);

  return {
    activeTimer, elapsedSeconds, loading, busy, error, conflict,
    start, stop, switchTo,
    dismissConflict: () => setConflict(null),
    refresh
  };
}
