import React, { useState, useEffect, useRef, useId } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import {
  TaskApi, TaskApiError, TaskItem, TaskList, TaskStatus, WorkspaceActor, Priority
} from '../../tasks/apiClient';
import DialogPortal from './DialogPortal';

interface Props {
  api: TaskApi;
  mode: 'create' | 'edit';
  /** Present in edit mode. */
  task?: TaskItem | null;
  /** Present when creating a subtask — forces the parent's list and hides list selection. */
  parentTask?: TaskItem | null;
  lists: TaskList[];
  statuses: TaskStatus[];
  actors: WorkspaceActor[];
  canAssignOthers: boolean;
  defaultListId?: string;
  onClose: () => void;
  onSaved: (task: TaskItem) => void;
}

const PRIORITIES: Priority[] = ['urgent', 'high', 'normal', 'low'];

/** ISO -> value for <input type="date">, or '' when absent. */
const toDateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
/** date input -> ISO at UTC midnight, or null. */
const fromDateInput = (v: string) => (v ? new Date(`${v}T00:00:00.000Z`).toISOString() : null);

export default function TaskFormModal({
  api, mode, task, parentTask, lists, statuses, actors, canAssignOthers,
  defaultListId, onClose, onSaved
}: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [listId, setListId] = useState(task?.list_id ?? parentTask?.list_id ?? defaultListId ?? '');
  const [statusId, setStatusId] = useState(task?.status_id ?? '');
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal');
  const [startDate, setStartDate] = useState(toDateInput(task?.start_date));
  const [dueDate, setDueDate] = useState(toDateInput(task?.due_date));
  const [estimateHours, setEstimateHours] = useState(
    task?.time_estimate_seconds ? String(task.time_estimate_seconds / 3600) : ''
  );
  const [assignees, setAssignees] = useState<string[]>(task?.assigneeActorIds ?? []);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // Statuses belong to a Space; only offer those valid for the chosen List's Space.
  const listSpaceId = lists.find(l => l.id === listId)?.space_id;
  const availableStatuses = statuses.filter(s => s.space_id === listSpaceId && !s.archived_at);

  useEffect(() => {
    if (!statusId && availableStatuses.length) {
      setStatusId((availableStatuses.find(s => s.is_default) ?? availableStatuses[0]).id);
    }
  }, [availableStatuses, statusId]);

  // Focus management: remember what had focus, move into the dialog, restore on unmount.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement;
    firstFieldRef.current?.focus();
    return () => previouslyFocused.current?.focus?.();
  }, []);

  // Escape closes; Tab is trapped inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
      );
      if (!nodes?.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const dirty =
    title !== (task?.title ?? '') ||
    description !== (task?.description ?? '') ||
    priority !== (task?.priority ?? 'normal') ||
    startDate !== toDateInput(task?.start_date) ||
    dueDate !== toDateInput(task?.due_date);

  const requestClose = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return; // guards against double submit
    setError(null); setConflict(false);

    if (!title.trim()) { setError('Title is required.'); return; }
    if (!listId) { setError('Choose a List.'); return; }
    if (!statusId) { setError('Choose a status.'); return; }
    if (startDate && dueDate && dueDate < startDate) {
      setError('Due date cannot be earlier than the start date.');
      return;
    }

    const estimate = estimateHours.trim()
      ? Math.round(parseFloat(estimateHours) * 3600)
      : null;
    if (estimate !== null && (!Number.isFinite(estimate) || estimate < 0)) {
      setError('Time estimate must be a positive number of hours.'); return;
    }

    setSaving(true);
    try {
      let saved: TaskItem;
      if (mode === 'create') {
        saved = await api.createTask({
          listId, statusId, title: title.trim(), description: description.trim() || null,
          priority, startDate: fromDateInput(startDate), dueDate: fromDateInput(dueDate),
          timeEstimateSeconds: estimate,
          parentTaskId: parentTask?.id ?? null
        });
      } else {
        saved = await api.updateTask(task!.id, {
          version: task!.version,
          title: title.trim(), description: description.trim() || null,
          statusId, listId, priority,
          startDate: fromDateInput(startDate), dueDate: fromDateInput(dueDate),
          timeEstimateSeconds: estimate
        });
      }

      // Assignments are a separate endpoint; only call it when the set actually changed.
      const before = [...(task?.assigneeActorIds ?? [])].sort().join(',');
      const after = [...assignees].sort().join(',');
      if (before !== after) {
        const r = await api.setAssignees(saved.id, assignees);
        saved = { ...saved, assigneeActorIds: r.assigneeActorIds };
      }
      onSaved(saved);
      onClose();
    } catch (err: any) {
      // Never clear the form on a recoverable error — the user's typing is preserved.
      if (err instanceof TaskApiError && err.code === 'TASK_VERSION_CONFLICT') {
        setConflict(true);
        setError('Someone else changed this task while you were editing.');
      } else {
        setError(err?.message ?? 'Could not save the task.');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleAssignee = (actorId: string, isSelf: boolean) => {
    if (!canAssignOthers && !isSelf) return; // server enforces this too
    setAssignees(prev =>
      prev.includes(actorId) ? prev.filter(a => a !== actorId) : [...prev, actorId]);
  };

  return (
    <DialogPortal>
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className="bg-white border border-slate-200 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="bg-[#0b1424] text-white p-5 rounded-t-2xl flex items-start justify-between sticky top-0 z-10">
          <div>
            <h2 id={titleId} className="text-sm font-black uppercase tracking-tight">
              {mode === 'create' ? (parentTask ? 'New Subtask' : 'New Task') : 'Edit Task'}
            </h2>
            {parentTask && (
              <p className="text-[11px] text-slate-300 font-semibold mt-0.5 truncate max-w-md">
                Subtask of “{parentTask.title}”
              </p>
            )}
          </div>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="text-slate-300 hover:text-white transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p>{error}</p>
                {conflict && (
                  <p className="font-medium mt-1">
                    Your text is preserved. Close and reopen the task to load the latest
                    version, then re-apply your change.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={`${titleId}-title`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
              Title <span className="text-rose-600">*</span>
            </label>
            <input
              id={`${titleId}-title`} ref={firstFieldRef} type="text" required maxLength={500}
              value={title} onChange={e => setTitle(e.target.value)}
              className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor={`${titleId}-desc`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
              Description
            </label>
            <textarea
              id={`${titleId}-desc`} rows={4} maxLength={20000}
              value={description} onChange={e => setDescription(e.target.value)}
              className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-y"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* A subtask always inherits its parent's List — the database enforces it. */}
            {!parentTask && (
              <div className="space-y-1">
                <label htmlFor={`${titleId}-list`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">List</label>
                <select
                  id={`${titleId}-list`} value={listId}
                  onChange={e => { setListId(e.target.value); setStatusId(''); }}
                  className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold cursor-pointer"
                >
                  <option value="">Select a List…</option>
                  {lists.filter(l => !l.archived_at).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor={`${titleId}-status`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Status</label>
              <select
                id={`${titleId}-status`} value={statusId} onChange={e => setStatusId(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold cursor-pointer"
              >
                {availableStatuses.length === 0 && <option value="">No statuses available</option>}
                {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor={`${titleId}-priority`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Priority</label>
              <select
                id={`${titleId}-priority`} value={priority}
                onChange={e => setPriority(e.target.value as Priority)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold cursor-pointer"
              >
                {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor={`${titleId}-est`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Estimate (hours)</label>
              <input
                id={`${titleId}-est`} type="number" min="0" step="0.25" value={estimateHours}
                onChange={e => setEstimateHours(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`${titleId}-start`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Start date</label>
              <input
                id={`${titleId}-start`} type="date" value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor={`${titleId}-due`} className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Due date</label>
              <input
                id={`${titleId}-due`} type="date" value={dueDate} min={startDate || undefined}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-xs p-2.5 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 font-semibold"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
              Assignees
              {!canAssignOthers && (
                <span className="ml-1.5 normal-case font-semibold text-slate-500">
                  (you can assign only yourself)
                </span>
              )}
            </legend>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {actors.filter(a => !a.archived).map(a => {
                const on = assignees.includes(a.actorId);
                const allowed = canAssignOthers || a.isSelf;
                return (
                  <button
                    key={a.actorId} type="button" disabled={!allowed}
                    aria-pressed={on}
                    onClick={() => toggleAssignee(a.actorId, a.isSelf)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none ${
                      on ? 'bg-blue-600 text-white border-blue-600'
                         : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    } ${allowed ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}
                  >
                    {a.displayName || a.email || 'Unknown'}{a.isSelf ? ' (you)' : ''}
                  </button>
                );
              })}
              {actors.length === 0 && (
                <p className="text-[11px] text-slate-500 font-medium">No members available yet.</p>
              )}
            </div>
          </fieldset>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button" onClick={requestClose}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-white border border-slate-250 text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:outline-none transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors cursor-pointer disabled:opacity-50"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? 'Saving…' : mode === 'create' ? 'Create Task' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
    </DialogPortal>
  );
}
