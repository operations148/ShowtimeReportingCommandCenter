import React, { useState, useRef, useEffect } from 'react';
import {
  Loader2, AlertTriangle, Inbox, ChevronLeft, ChevronRight, ChevronDown, ListTree,
  Archive, RotateCcw, Plus, MoveRight, ArrowUp, ArrowDown, X
} from 'lucide-react';
import {
  TaskItem, TaskStatus, WorkspaceActor, PageInfo, StatusGroupCount,
  formatTracked, formatTrackedDuration
} from '../../tasks/apiClient';
import { TimerToggleButton } from './ActiveTimerBar';
import type { ActiveTimerState } from '../../hooks/useActiveTaskTimer';

interface Props {
  tasks: TaskItem[];
  /** The Space's non-archived statuses, already in display order. */
  statuses: TaskStatus[];
  /** Server-side per-status totals for the WHOLE active query. Absent while loading. */
  groupCounts: StatusGroupCount[] | undefined;
  page?: PageInfo;
  loading: boolean;
  error: string | null;
  actors: WorkspaceActor[];
  trackedByTask: Map<string, number>;
  timer: ActiveTimerState;
  timeTrackingEnabled: boolean;
  canMutate: (t: TaskItem) => boolean;
  canCreateTask: boolean;
  /** Manual ordering is only meaningful while the list is in manual-order sort. */
  manualOrder: boolean;
  collapsedStatusIds: Set<string>;
  /** True once any filter/search narrows the query — drives the empty-state wording. */
  filtered: boolean;
  onToggleCollapsed: (statusId: string) => void;
  onOpenTask: (id: string) => void;
  onArchiveToggle: (t: TaskItem) => void;
  onMoveTask: (t: TaskItem, statusId: string) => Promise<void>;
  onReorderTask: (t: TaskItem, dir: -1 | 1) => Promise<void>;
  onInlineCreate: (statusId: string, title: string) => Promise<boolean>;
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

/** The six columns every group shows, in the same order, at every width. */
const COLUMNS = ['Task', 'Assignee', 'Priority', 'Due', 'Tracked', 'Actions'] as const;

/**
 * Status-grouped List view.
 *
 * Structural choices that matter, because tests and assistive technology both depend on them:
 *   * ONE `<table>` per group, each with its own `<thead>` and `<caption>`. A single table with
 *     group-header rows inside `<tbody>` would make those headers indistinguishable from task
 *     rows for anything walking the table — including screen readers announcing "row 4 of 22".
 *   * An empty group still renders its header row set, with the "nothing here" message in a
 *     `<tfoot>` rather than as an empty `<tbody>` row, so a placeholder is never mistaken for
 *     a task by a row count.
 *   * Group counts come from the SERVER (`groupCounts`), covering the whole filtered result,
 *     while the rows rendered are only the current page. Counting the rows on screen instead
 *     would silently under-report every group as soon as the result spanned two pages.
 *   * Movement between statuses is an explicit `<select>`, and ordering within a status is a
 *     pair of buttons — the same keyboard- and touch-operable pattern the Board and the
 *     hierarchy sidebar already use. Drag may be added later, but never as the only route.
 */
export default function TaskGroupedListView(p: Props) {
  const actorName = (id: string) => {
    const a = p.actors.find(x => x.actorId === id);
    return a?.displayName || a?.email || 'Unknown';
  };

  if (p.loading) {
    return (
      <div className="space-y-3">
        {/* Skeletons mirror the real group shape so the layout does not jump on arrival. */}
        {[0, 1, 2].map(i => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-200 animate-pulse" aria-hidden="true" />
              <span className="h-3 w-28 rounded bg-slate-200 animate-pulse" aria-hidden="true" />
            </div>
            <div className="p-4 space-y-3" aria-hidden="true">
              {[0, 1].map(r => <div key={r} className="h-4 rounded bg-slate-100 animate-pulse" />)}
            </div>
          </div>
        ))}
        <p className="text-xs text-slate-600 text-center font-semibold" role="status" aria-live="polite">
          Loading tasks…
        </p>
      </div>
    );
  }

  if (p.error) {
    return (
      <div role="alert" className="bg-white border border-rose-200 rounded-xl p-8 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-800">Could not load tasks</p>
        <p className="text-xs text-slate-600 max-w-md mx-auto">{p.error}</p>
        <button
          onClick={p.onRetry}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!p.statuses.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-700">No statuses in this Space</p>
        <p className="text-xs text-slate-600 mt-1">
          Add a status, or apply the Operations Status Template, to group this List.
        </p>
      </div>
    );
  }

  const totalMatching = p.page?.total ?? p.tasks.length;

  /**
   * A FILTERED query that matches nothing gets one clear sentence instead of a wall of
   * zero-count groups: the useful information is that the filters exclude everything, and
   * seven empty tables bury it.
   *
   * An UNFILTERED empty List keeps its groups, because there the groups are the affordance —
   * they are what you add the List's first task into, and each carries its own inline Add.
   * Empty groups also always stay visible whenever any other group has results.
   */
  if (totalMatching === 0 && p.filtered) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
        <Inbox className="w-8 h-8 text-slate-500 mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-bold text-slate-700">No tasks here yet</p>
        <p className="text-xs text-slate-600 mt-1">
          No task in this List matches the current filters. Clear a filter to see more.
        </p>
      </div>
    );
  }

  const totalPages = p.page ? Math.max(1, Math.ceil(p.page.total / p.page.pageSize)) : 1;
  const countFor = (statusId: string) =>
    p.groupCounts?.find(g => g.statusId === statusId)?.total
      // Before the first grouped response lands, fall back to what is on screen rather than
      // rendering a confident "0" the server has not confirmed.
      ?? p.tasks.filter(t => t.status_id === statusId).length;

  return (
    <div className="space-y-3">
      {/* An unfiltered List with nothing in it keeps its groups — they are what you add the
          first task into — but still says so plainly, rather than leaving the reader to infer
          it from a column of zeroes. */}
      {totalMatching === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2">
          <Inbox className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <p className="text-xs text-slate-700 font-semibold">
            No tasks here yet — add the first one to any status below.
          </p>
        </div>
      )}

      {p.statuses.map(status => (
        <StatusGroup
          key={status.id}
          status={status}
          items={p.tasks.filter(t => t.status_id === status.id)}
          total={countFor(status.id)}
          /**
           * A collapse never survives a filter that has matches in that group. Leaving DONE
           * collapsed while a search matches three closed tasks is exactly the "hidden
           * unexpectedly" failure the collapse default has to avoid: the user asked to see
           * those rows. The preference itself is untouched and reapplies as soon as the
           * filters are cleared.
           */
          collapsed={
            p.collapsedStatusIds.has(status.id) &&
            !(p.filtered && countFor(status.id) > 0)
          }
          statuses={p.statuses}
          actorName={actorName}
          p={p}
        />
      ))}

      {p.page && totalPages > 1 && (
        <nav className="flex items-center justify-between" aria-label="Task pagination">
          <p className="text-[11px] text-slate-600 font-semibold">
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

// ── One status group ───────────────────────────────────────────────────────────────────

interface GroupProps {
  status: TaskStatus;
  items: TaskItem[];
  total: number;
  collapsed: boolean;
  statuses: TaskStatus[];
  actorName: (id: string) => string;
  p: Props;
}

const StatusGroup: React.FC<GroupProps> = ({ status, items, total, collapsed, statuses, actorName, p }) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const submit = async () => {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    const okd = await p.onInlineCreate(status.id, title);
    setSaving(false);
    if (okd) {
      setDraft('');
      // Stay open so several tasks can be added in a row without re-reaching for the control.
      inputRef.current?.focus();
    }
  };

  const label = `${status.name}, ${total} task${total === 1 ? '' : 's'}`;

  return (
    <section
      aria-label={label}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs"
    >
      <header className="flex items-center gap-1.5 px-2 py-2 border-b border-slate-200 bg-[#f8fafc]">
        <button
          onClick={() => p.onToggleCollapsed(status.id)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
          className="flex items-center gap-1.5 min-w-0 flex-1 px-1.5 py-1 rounded-lg hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer text-left"
        >
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-600 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span
            className="w-2 h-2 rounded-full bg-slate-400 shrink-0"
            style={status.color ? { background: status.color } : undefined}
            aria-hidden="true"
          />
          {/* Deliberately NOT aria-hidden. The button carries its own explicit label, so the
              heading adds nothing to the button's announcement — but it does keep each group
              reachable by heading navigation, which is how a screen-reader user skims a long
              List. Only the decorative dot, the count and the "hidden" note are hidden, since
              the label already states both. */}
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-800 truncate">
            {status.name}
          </h3>
          <span
            className="text-[10px] font-black text-slate-700 bg-white border border-slate-200 px-1.5 rounded shrink-0"
            aria-hidden="true"
          >
            {total}
          </span>
          {/* A collapsed group with content says so in text, so nothing is ever silently
              hidden — this is what makes collapsing DONE by default safe. */}
          {collapsed && total > 0 && (
            <span className="text-[10px] font-semibold text-slate-600 truncate" aria-hidden="true">
              · {total} hidden
            </span>
          )}
        </button>

        {p.canCreateTask && !adding && (
          <button
            // Adding into a collapsed group has to expand it first, otherwise the input it
            // opens is inside the hidden body and the click appears to do nothing.
            onClick={() => { if (collapsed) p.onToggleCollapsed(status.id); setAdding(true); }}
            aria-label={`Add task to ${status.name}`}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3 h-3" aria-hidden="true" /> Task
          </button>
        )}
      </header>

      {!collapsed && (
        <>
          {/* Desktop table — one per group, same six columns everywhere. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                {status.name}: {total} task{total === 1 ? '' : 's'}, with assignee, priority,
                due date and tracked time
              </caption>
              <thead className="border-b border-slate-200 text-[10px] text-slate-600 uppercase font-black">
                <tr>
                  {COLUMNS.map(c => (
                    <th
                      key={c}
                      scope="col"
                      className={`p-3 ${c === 'Task' ? 'pl-4' : ''} ${c === 'Actions' ? 'pr-4 text-right' : ''}`}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {items.map(t => (
                  <TaskRow key={t.id} t={t} statuses={statuses} actorName={actorName} p={p} />
                ))}
              </tbody>
              {items.length === 0 && (
                // Deliberately a tfoot, not an empty tbody row: a placeholder must never be
                // countable as a task.
                <tfoot>
                  <tr>
                    <td colSpan={COLUMNS.length} className="p-4 text-center text-[11px] text-slate-600 font-semibold">
                      {total > 0
                        ? `No task in ${status.name} on this page — ${total} on other pages.`
                        : `Nothing in ${status.name} right now.`}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile cards — stacked rows, no horizontal scrolling, same controls. */}
          {items.length > 0 && (
            <ul className="md:hidden divide-y divide-slate-100">
              {items.map(t => (
                <TaskCard key={t.id} t={t} statuses={statuses} actorName={actorName} p={p} />
              ))}
            </ul>
          )}
          {items.length === 0 && (
            <p className="md:hidden p-4 text-center text-[11px] text-slate-600 font-semibold">
              {total > 0
                ? `No task in ${status.name} on this page — ${total} on other pages.`
                : `Nothing in ${status.name} right now.`}
            </p>
          )}

          {adding && (
            <div className="flex items-center gap-1.5 p-2.5 border-t border-slate-200 bg-[#f8fafc]">
              <label className="sr-only" htmlFor={`inline-add-${status.id}`}>
                New task title in {status.name}
              </label>
              <input
                id={`inline-add-${status.id}`}
                ref={inputRef}
                value={draft}
                disabled={saving}
                placeholder={`New task in ${status.name}…`}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); submit(); }
                  if (e.key === 'Escape') { setAdding(false); setDraft(''); }
                }}
                className="flex-1 min-w-0 text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
              />
              <button
                onClick={submit}
                disabled={saving || !draft.trim()}
                aria-label={`Create task in ${status.name}`}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : 'Add'}
              </button>
              <button
                onClick={() => { setAdding(false); setDraft(''); }}
                aria-label={`Cancel new task in ${status.name}`}
                className="p-1.5 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};

// ── One task, in each of the two presentations ─────────────────────────────────────────

interface RowProps {
  t: TaskItem;
  statuses: TaskStatus[];
  actorName: (id: string) => string;
  p: Props;
}

/**
 * The status <select> and the two ordering buttons, shared by the row and the card.
 *
 * `variant` is not cosmetic: both presentations are in the DOM at every width (CSS decides
 * which is visible), so a single id would appear twice on the page. Duplicate ids break the
 * label→control association — `<label for>` resolves to the FIRST match, which at mobile
 * width is the hidden table row, leaving the visible card's select unlabelled.
 */
const RowControls: React.FC<RowProps & { variant: 'row' | 'card' }> = ({ t, statuses, p, variant }) => {
  const compact = variant === 'card';
  const moveId = `glist-move-${variant}-${t.id}`;
  const mutable = p.canMutate(t);
  if (!mutable) {
    return <span className="text-[10px] text-slate-600 font-semibold italic">View only</span>;
  }
  return (
    <>
      {p.manualOrder && (
        <>
          <button
            onClick={() => p.onReorderTask(t, -1)}
            aria-label={`Move “${t.title}” up`}
            className="p-1 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
          >
            <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            onClick={() => p.onReorderTask(t, 1)}
            aria-label={`Move “${t.title}” down`}
            className="p-1 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
          >
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </>
      )}
      <label className="sr-only" htmlFor={moveId}>
        Move “{t.title}” to a different status
      </label>
      <span className={`relative inline-flex items-center ${compact ? 'flex-1 min-w-0' : ''}`}>
        <MoveRight
          className="w-3 h-3 text-slate-600 absolute left-1.5 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <select
          id={moveId}
          value={t.status_id}
          onChange={e => p.onMoveTask(t, e.target.value)}
          className="text-[10px] font-bold pl-6 pr-1 py-1 bg-white border border-slate-200 rounded-md text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus:outline-none w-full"
        >
          {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </span>
      {p.timeTrackingEnabled && !t.archived_at && (
        <TimerToggleButton taskId={t.id} timer={p.timer} />
      )}
      <button
        onClick={() => p.onArchiveToggle(t)}
        aria-label={t.archived_at ? `Restore “${t.title}”` : `Archive “${t.title}”`}
        title={t.archived_at ? 'Restore' : 'Archive'}
        className="p-1 rounded-lg text-slate-600 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none transition-colors cursor-pointer"
      >
        {t.archived_at ? <RotateCcw className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
      </button>
    </>
  );
};

const TaskRow: React.FC<RowProps> = ({ t, statuses, actorName, p }) => {
  const tracked = p.trackedByTask.get(t.id) ?? 0;
  return (
    <tr className={`hover:bg-slate-50/50 ${t.archived_at ? 'opacity-60' : ''}`}>
      <td className="p-3 pl-4 max-w-xs">
        <button
          onClick={() => p.onOpenTask(t.id)}
          className="font-bold text-slate-900 hover:text-blue-700 text-left truncate block max-w-full focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none rounded cursor-pointer"
        >
          {t.title}
        </button>
        <span className="flex items-center gap-2 mt-0.5">
          {t.subtaskCount ? (
            <span className="text-[10px] text-slate-600 font-semibold inline-flex items-center gap-0.5">
              <ListTree className="w-2.5 h-2.5" aria-hidden="true" />
              {t.subtaskCount} subtask{t.subtaskCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {t.archived_at && (
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-600">Archived</span>
          )}
        </span>
      </td>
      <td className="p-3">
        <div className="flex flex-wrap gap-1 max-w-[180px]">
          {t.assigneeActorIds.length === 0 && <span className="text-slate-600">—</span>}
          {t.assigneeActorIds.slice(0, 2).map(id => (
            <span key={id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-1.5 py-0.5 rounded truncate max-w-[80px]">
              {actorName(id)}
            </span>
          ))}
          {t.assigneeActorIds.length > 2 && (
            <span className="text-[10px] text-slate-600 font-bold">+{t.assigneeActorIds.length - 2}</span>
          )}
        </div>
      </td>
      <td className="p-3">
        <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${PRIORITY_STYLE[t.priority]}`}>
          {t.priority}
        </span>
      </td>
      <td className={`p-3 text-[11px] font-semibold ${isOverdue(t.due_date) && !t.archived_at ? 'text-rose-600' : 'text-slate-600'}`}>
        {fmtDate(t.due_date)}
      </td>
      <td className="p-3 text-[11px] font-mono font-bold text-slate-700 tabular-nums">
        {/* Actual tracked time, exact to the second below an hour. The estimate beside it
            keeps the coarser "Xh Ym" form — it is a plan, not a measurement. */}
        {formatTrackedDuration(tracked)}
        {t.time_estimate_seconds ? (
          <span className="text-slate-600 font-sans font-semibold">
            {' '}/ {formatTracked(t.time_estimate_seconds)}
          </span>
        ) : null}
      </td>
      <td className="p-3 pr-4">
        <div className="flex items-center justify-end gap-1">
          <RowControls t={t} statuses={statuses} actorName={actorName} p={p} variant="row" />
        </div>
      </td>
    </tr>
  );
};

const TaskCard: React.FC<RowProps> = ({ t, statuses, actorName, p }) => {
  const tracked = p.trackedByTask.get(t.id) ?? 0;
  return (
    <li className={`p-3.5 space-y-2 ${t.archived_at ? 'opacity-60' : ''}`}>
      <button
        onClick={() => p.onOpenTask(t.id)}
        className="font-bold text-slate-900 text-sm text-left w-full focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none rounded cursor-pointer"
      >
        {t.title}
      </button>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${PRIORITY_STYLE[t.priority]}`}>
          {t.priority}
        </span>
        {t.assigneeActorIds.slice(0, 2).map(id => (
          <span key={id} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-150 font-bold px-1.5 rounded truncate max-w-[110px]">
            {actorName(id)}
          </span>
        ))}
        {t.due_date && (
          <span className={`text-[10px] font-bold ${isOverdue(t.due_date) ? 'text-rose-600' : 'text-slate-600'}`}>
            Due {fmtDate(t.due_date)}
          </span>
        )}
        {tracked > 0 && (
          <span className="text-[10px] font-mono font-bold text-slate-700">
            {formatTrackedDuration(tracked)}
          </span>
        )}
        {t.subtaskCount ? (
          <span className="text-[10px] text-slate-600 font-semibold">{t.subtaskCount} sub</span>
        ) : null}
        {/* Archived state is stated in text, never carried by opacity alone. */}
        {t.archived_at && (
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-600">Archived</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <RowControls t={t} statuses={statuses} actorName={actorName} p={p} variant="card" />
      </div>
    </li>
  );
};
