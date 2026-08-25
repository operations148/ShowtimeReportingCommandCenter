import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Loader2, AlertTriangle, Plus, Search, LayoutGrid, Rows3, Menu, X, ShieldOff, Clock, Palette
} from 'lucide-react';
import { UserRole } from '../../types';
import {
  createTaskApi, TaskApiError, Bootstrap, TaskItem, TaskStatus, WorkspaceActor,
  PageInfo, formatTracked
} from '../../tasks/apiClient';
import { useActiveTaskTimer } from '../../hooks/useActiveTaskTimer';
import TaskSidebar from './TaskSidebar';
import TaskListView from './TaskListView';
import TaskBoardView from './TaskBoardView';
import TaskDetailDrawer from './TaskDetailDrawer';
import TaskFormModal from './TaskFormModal';
import ActiveTimerBar from './ActiveTimerBar';
import StatusManagerPanel from './StatusManagerPanel';
import DialogPortal from './DialogPortal';

interface Props {
  token: string;
  role: UserRole;
  currentActorHint?: string;
}

const MANAGER_ROLES = [UserRole.SUPER_ADMIN, UserRole.WORKSPACE_OWNER, UserRole.ADMIN];
const CONTRIBUTOR_ROLES = [UserRole.SALES_REP, UserRole.TEAM_MEMBER];

export default function TaskManagementView({ token, role }: Props) {
  const api = useMemo(() => createTaskApi(() => token), [token]);

  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [bootError, setBootError] = useState<{ message: string; code?: string } | null>(null);
  const [bootLoading, setBootLoading] = useState(true);
  const [actors, setActors] = useState<WorkspaceActor[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState('position');
  const [page, setPage] = useState(1);

  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo | undefined>();
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [trackedByTask, setTracked] = useState<Map<string, number>>(new Map());

  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [formState, setFormState] = useState<
    { mode: 'create'; parent?: TaskItem | null } | { mode: 'edit'; task: TaskItem } | null
  >(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);

  const timeTrackingEnabled = boot?.capabilities.timeTrackingEnabled ?? false;
  const timer = useActiveTaskTimer(api, timeTrackingEnabled);

  const isManager = MANAGER_ROLES.includes(role);
  const isContributor = CONTRIBUTOR_ROLES.includes(role);
  const myActorId = actors.find(a => a.isSelf)?.actorId;

  /**
   * Mirror of the server's D6 rule, used ONLY to decide which controls to render.
   * The server re-checks every mutation; this is an affordance, never a boundary.
   */
  const canMutate = useCallback((t: TaskItem) => {
    if (isManager) return true;
    if (!isContributor || !myActorId) return false;
    return t.created_by === myActorId || t.assigneeActorIds.includes(myActorId);
  }, [isManager, isContributor, myActorId]);

  // ── Bootstrap ────────────────────────────────────────────────────────────────────────
  /**
   * `silent` refetches without raising the full-page loading gate.
   *
   * The gate replaces the entire subtree, which unmounts any open dialog — destroying its
   * focus position and its aria-live announcement. That is correct on first load, when there
   * is nothing to preserve, but wrong for a refresh triggered from inside a dialog, so
   * in-dialog refreshes pass silent.
   */
  const loadBootstrap = useCallback(async (silent = false) => {
    if (!silent) setBootLoading(true);
    setBootError(null);
    try {
      const b = await api.bootstrap();
      setBoot(b);
      setSpaceId(prev => prev ?? b.spaces.find(s => !s.archived_at)?.id ?? null);
      try { setActors(await api.actors()); } catch { /* directory is non-fatal */ }
    } catch (err: any) {
      setBootError({
        message: err?.message ?? 'Task Management could not be loaded.',
        code: err instanceof TaskApiError ? err.code : undefined
      });
    } finally {
      setBootLoading(false);
    }
  }, [api]);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  // Default the List selection to the chosen Space's default List.
  useEffect(() => {
    if (!boot || !spaceId || listId) return;
    const inSpace = boot.lists.filter(l => l.space_id === spaceId && !l.archived_at);
    setListId((inSpace.find(l => l.is_default) ?? inSpace[0])?.id ?? null);
  }, [boot, spaceId, listId]);

  /**
   * Debounce search so typing does not fire a request per keystroke.
   *
   * The early return matters: without it this effect also runs on mount and 300ms later
   * calls setPage(1) even though the search never changed. Anyone who paged forward inside
   * that window was silently dragged back to page 1, and the same happened after every
   * settle. Bailing out when the value already matches means the page is reset only by an
   * actual change of search term, which is the only case that invalidates the current page.
   */
  useEffect(() => {
    if (search === debouncedSearch) return;
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search, debouncedSearch]);

  // ── Tasks ────────────────────────────────────────────────────────────────────────────
  const reqSeq = useRef(0);
  const loadTasks = useCallback(async () => {
    if (!boot) return;
    const seq = ++reqSeq.current;
    const ac = new AbortController();
    setTasksLoading(true); setTasksError(null);
    try {
      const { tasks: rows, page: pi } = await api.listTasks({
        listId: listId ?? undefined,
        statusId: statusFilter || undefined,
        priority: priorityFilter || undefined,
        q: debouncedSearch || undefined,
        dueBefore: dueBefore ? new Date(`${dueBefore}T23:59:59Z`).toISOString() : undefined,
        includeArchived: showArchived ? 'true' : undefined,
        // The board needs every status column at once, so it does not filter to root-only.
        rootOnly: view === 'list' ? 'true' : undefined,
        sort, page, pageSize: view === 'board' ? 200 : 50
      }, ac.signal);
      // Ignore a response that a newer request has already superseded.
      if (seq !== reqSeq.current) return;

      let visible = rows;
      if (assigneeFilter) {
        visible = rows.filter(t => t.assigneeActorIds.includes(assigneeFilter));
      }
      setTasks(visible);
      setPageInfo(pi);

      if (timeTrackingEnabled) {
        try {
          const sum = await api.timeSummary({}, ac.signal);
          if (seq === reqSeq.current) {
            setTracked(new Map(sum.byTask.map(x => [x.taskId, x.trackedSeconds])));
          }
        } catch { /* summary is supplementary */ }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || seq !== reqSeq.current) return;
      setTasksError(err?.message ?? 'Could not load tasks.');
    } finally {
      if (seq === reqSeq.current) setTasksLoading(false);
    }
  }, [api, boot, listId, statusFilter, priorityFilter, debouncedSearch, dueBefore,
      showArchived, sort, page, view, assigneeFilter, timeTrackingEnabled]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const refreshAll = useCallback(() => { loadTasks(); timer.refresh(); }, [loadTasks, timer]);

  const spaceStatuses = useMemo(
    () => (boot?.statuses ?? []).filter(s => s.space_id === spaceId),
    [boot, spaceId]
  );
  const spaceLists = useMemo(
    () => (boot?.lists ?? []).filter(l => l.space_id === spaceId),
    [boot, spaceId]
  );
  const taskTitleById = useCallback(
    (id: string) => tasks.find(t => t.id === id)?.title,
    [tasks]
  );

  const moveTask = async (t: TaskItem, statusId: string) => {
    try {
      await api.updateTask(t.id, { version: t.version, statusId });
    } catch (err: any) {
      setBanner(err instanceof TaskApiError && err.code === 'TASK_VERSION_CONFLICT'
        ? 'That task changed elsewhere — the board has been refreshed.'
        : err?.message ?? 'Could not move the task.');
    } finally {
      // Always refetch authoritative state; never leave an unconfirmed change on screen.
      loadTasks();
    }
  };

  const archiveToggle = async (t: TaskItem) => {
    const archiving = !t.archived_at;
    if (archiving && !window.confirm(`Archive “${t.title}”? You can restore it later.`)) return;
    try {
      archiving ? await api.archiveTask(t.id, t.version) : await api.restoreTask(t.id, t.version);
    } catch (err: any) {
      setBanner(err?.message ?? 'Could not update the task.');
    } finally {
      loadTasks();
    }
  };

  // ── Gate states ──────────────────────────────────────────────────────────────────────
  if (bootLoading) {
    return (
      <div className="py-24 text-center space-y-3" role="status" aria-live="polite">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" aria-hidden="true" />
        <p className="text-xs text-slate-600 font-semibold">Loading Task Management…</p>
      </div>
    );
  }

  if (bootError) {
    const terminal = ['TASK_MODULE_DISABLED', 'TASK_WORKSPACE_SUSPENDED'].includes(bootError.code ?? '');
    return (
      <div role="alert" className="bg-white border border-slate-200 rounded-2xl p-12 text-center max-w-lg mx-auto space-y-3">
        <ShieldOff className="w-10 h-10 text-slate-500 mx-auto" aria-hidden="true" />
        <h2 className="text-base font-black text-slate-900">Task Management unavailable</h2>
        <p className="text-xs text-slate-500 leading-relaxed">{bootError.message}</p>
        {!terminal && (
          <button
            onClick={loadBootstrap}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const caps = boot!.capabilities;
  const expiredReadOnly = !caps.canCreateTask && role !== UserRole.READ_ONLY;

  return (
    <div className="space-y-4" id="task-management-view">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[10px] bg-blue-50 border border-blue-200 text-blue-700 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider block w-fit mb-1.5">
            Workspace Operations
          </span>
          <h1 className="text-xl font-bold tracking-tight text-[#0F172A]">Task Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
            aria-label="Open Spaces and Lists"
          >
            <Menu className="w-4 h-4" aria-hidden="true" /> Spaces
          </button>
          {/* Manager-only: statuses shape the Board for everyone in the Space. */}
          {caps.canManageHierarchy && spaceId && (
            <button
              onClick={() => setStatusPanelOpen(true)}
              id="btn-manage-statuses"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none"
            >
              <Palette className="w-3.5 h-3.5" aria-hidden="true" /> Statuses
            </button>
          )}
          {caps.canCreateTask && listId && (
            <button
              onClick={() => setFormState({ mode: 'create' })}
              id="btn-new-task"
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New Task
            </button>
          )}
        </div>
      </div>

      {!caps.actorResolved && (
        <div role="alert" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-900 font-semibold">
            Your session has no verified user identity, so you can view tasks but not change
            them. Sign in again from GoHighLevel, or contact your administrator.
          </p>
        </div>
      )}

      {expiredReadOnly && (
        <div role="status" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-amber-900 font-semibold">
            This workspace has read-only access to Task Management. You can review tasks and
            stop a running timer, but changes require full access.
          </p>
        </div>
      )}

      {banner && (
        <div role="alert" className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
          <p className="text-xs text-rose-800 font-semibold flex-1">{banner}</p>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" className="text-rose-400 hover:text-rose-700 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {timeTrackingEnabled && (
        <ActiveTimerBar timer={timer} taskTitleById={taskTitleById} onOpenTask={setOpenTaskId} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Desktop sidebar */}
        <aside className="hidden lg:block bg-white border border-slate-200 rounded-xl p-4 h-fit sticky top-4">
          <TaskSidebar
            api={api} spaces={boot!.spaces} lists={boot!.lists}
            selectedSpaceId={spaceId} selectedListId={listId}
            canManage={caps.canManageHierarchy} showArchived={showArchived}
            onSelectSpace={id => { setSpaceId(id); setPage(1); }}
            onSelectList={id => { setListId(id); setPage(1); }}
            onChanged={() => loadBootstrap(true)} onError={setBanner}
          />
        </aside>

        <div className="min-w-0 space-y-3">
          {/* Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 min-w-0">
                <label className="sr-only" htmlFor="task-search">Search tasks by title</label>
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                <input
                  id="task-search" type="search" value={search} placeholder="Search tasks…"
                  onChange={e => setSearch(e.target.value)}
                  className="w-full text-xs pl-8 pr-2 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-semibold"
                />
              </div>
              <div className="flex gap-1 shrink-0" role="group" aria-label="Choose a view">
                {(['list', 'board'] as const).map(v => (
                  <button
                    key={v} onClick={() => { setView(v); setPage(1); }}
                    aria-pressed={view === v}
                    className={`flex items-center gap-1 px-3 py-2 rounded-lg text-[11px] font-bold transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:outline-none ${
                      view === v ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {v === 'list' ? <Rows3 className="w-3.5 h-3.5" aria-hidden="true" /> : <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />}
                    {v === 'list' ? 'List' : 'Board'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="f-status">Filter by status</label>
              <select id="f-status" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                className="text-[11px] px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-600 cursor-pointer focus:border-blue-500 outline-none">
                <option value="">All statuses</option>
                {spaceStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>

              <label className="sr-only" htmlFor="f-priority">Filter by priority</label>
              <select id="f-priority" value={priorityFilter} onChange={e => { setPriorityFilter(e.target.value); setPage(1); }}
                className="text-[11px] px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-600 cursor-pointer focus:border-blue-500 outline-none">
                <option value="">All priorities</option>
                {['urgent','high','normal','low'].map(x => <option key={x} value={x}>{x}</option>)}
              </select>

              <label className="sr-only" htmlFor="f-assignee">Filter by assignee</label>
              <select id="f-assignee" value={assigneeFilter} onChange={e => { setAssigneeFilter(e.target.value); setPage(1); }}
                className="text-[11px] px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-600 cursor-pointer focus:border-blue-500 outline-none">
                <option value="">All assignees</option>
                {actors.filter(a => !a.archived).map(a => (
                  <option key={a.actorId} value={a.actorId}>{a.displayName || a.email}{a.isSelf ? ' (you)' : ''}</option>
                ))}
              </select>

              <label className="sr-only" htmlFor="f-due">Due before</label>
              <input id="f-due" type="date" value={dueBefore} onChange={e => { setDueBefore(e.target.value); setPage(1); }}
                className="text-[11px] px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-600 focus:border-blue-500 outline-none" />

              <label className="sr-only" htmlFor="f-sort">Sort by</label>
              <select id="f-sort" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}
                className="text-[11px] px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-600 cursor-pointer focus:border-blue-500 outline-none">
                <option value="position">Manual order</option>
                <option value="due_date">Due date ↑</option>
                <option value="-due_date">Due date ↓</option>
                <option value="-updated_at">Recently updated</option>
                <option value="title">Title A–Z</option>
              </select>

              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer px-2">
                <input type="checkbox" checked={showArchived}
                  onChange={e => { setShowArchived(e.target.checked); setPage(1); }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5" />
                Show archived
              </label>
            </div>
          </div>

          {view === 'list' ? (
            <TaskListView
              tasks={tasks} page={pageInfo} loading={tasksLoading} error={tasksError}
              statuses={boot!.statuses} actors={actors} trackedByTask={trackedByTask}
              timer={timer} timeTrackingEnabled={timeTrackingEnabled}
              canMutate={canMutate} onOpenTask={setOpenTaskId}
              onArchiveToggle={archiveToggle} onPageChange={setPage} onRetry={loadTasks}
            />
          ) : (
            <TaskBoardView
              tasks={tasks} statuses={spaceStatuses} actors={actors}
              trackedByTask={trackedByTask} timer={timer}
              timeTrackingEnabled={timeTrackingEnabled}
              loading={tasksLoading} error={tasksError} canMutate={canMutate}
              onOpenTask={setOpenTaskId} onMoveTask={moveTask} onRetry={loadTasks}
            />
          )}
        </div>
      </div>

      {/* Mobile nav drawer — portalled for the same reason as the other dialogs: the app
          shell's transformed wrapper would otherwise capture its fixed positioning. */}
      {mobileNavOpen && (
        <DialogPortal>
        <div className="lg:hidden fixed inset-0 z-40 flex" onClick={() => setMobileNavOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" aria-hidden="true" />
          <div
            role="dialog" aria-modal="true" aria-label="Spaces and Lists"
            onClick={e => e.stopPropagation()}
            className="relative bg-white w-72 max-w-[85vw] h-full overflow-y-auto p-4 shadow-2xl"
          >
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Navigate</h2>
              <button onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"
                className="text-slate-500 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <TaskSidebar
              api={api} spaces={boot!.spaces} lists={boot!.lists}
              selectedSpaceId={spaceId} selectedListId={listId}
              canManage={caps.canManageHierarchy} showArchived={showArchived}
              onSelectSpace={id => { setSpaceId(id); setPage(1); }}
              onSelectList={id => { setListId(id); setPage(1); setMobileNavOpen(false); }}
              onChanged={() => loadBootstrap(true)} onError={setBanner}
            />
          </div>
        </div>
        </DialogPortal>
      )}

      {openTaskId && (
        <TaskDetailDrawer
          api={api} taskId={openTaskId} statuses={boot!.statuses} actors={actors}
          timer={timer} timeTrackingEnabled={timeTrackingEnabled}
          canMutate={canMutate} canCreateTask={caps.canCreateTask}
          onClose={() => setOpenTaskId(null)}
          onEdit={t => { setOpenTaskId(null); setFormState({ mode: 'edit', task: t }); }}
          onAddSubtask={parent => { setOpenTaskId(null); setFormState({ mode: 'create', parent }); }}
          onChanged={refreshAll}
        />
      )}

      {statusPanelOpen && spaceId && (
        <StatusManagerPanel
          api={api} spaceId={spaceId}
          spaceName={boot!.spaces.find(sp => sp.id === spaceId)?.name ?? 'Space'}
          statuses={spaceStatuses}
          onClose={() => setStatusPanelOpen(false)}
          onChanged={() => { loadBootstrap(true); loadTasks(); }}
        />
      )}

      {formState && (
        <TaskFormModal
          api={api} mode={formState.mode}
          task={formState.mode === 'edit' ? formState.task : null}
          parentTask={formState.mode === 'create' ? formState.parent ?? null : null}
          lists={spaceLists} statuses={boot!.statuses} actors={actors}
          canAssignOthers={caps.canAssignOthers} defaultListId={listId ?? undefined}
          onClose={() => setFormState(null)}
          onSaved={() => refreshAll()}
        />
      )}
    </div>
  );
}
