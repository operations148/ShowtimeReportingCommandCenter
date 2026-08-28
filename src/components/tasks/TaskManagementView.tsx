import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Loader2, AlertTriangle, Plus, Search, LayoutGrid, Rows3, Menu, X, ShieldOff, Clock, Palette
} from 'lucide-react';
import { UserRole } from '../../types';
import {
  createTaskApi, TaskApiError, Bootstrap, TaskFolder, TaskItem, TaskList, TaskSpace, TaskStatus,
  WorkspaceActor, PageInfo, formatTracked
} from '../../tasks/apiClient';
import { useActiveTaskTimer } from '../../hooks/useActiveTaskTimer';
import TaskSidebar, { HierarchyAction } from './TaskSidebar';
import HierarchyBreadcrumb from './HierarchyBreadcrumb';
import TaskListView from './TaskListView';
import TaskBoardView from './TaskBoardView';
import TaskDetailDrawer from './TaskDetailDrawer';
import TaskFormModal from './TaskFormModal';
import ActiveTimerBar from './ActiveTimerBar';
import StatusManagerPanel from './StatusManagerPanel';
import DialogPortal from './DialogPortal';

const NAV_STORAGE_KEY = 'taskmgmt:nav';

/**
 * Restores the last-viewed Space/List and which Folders were left expanded.
 *
 * Not workspace-scoped: the client is deliberately never told its own workspace id (see
 * apiClient.ts — "The workspace is NEVER sent"), so there is nothing to scope this key by.
 * That is safe here because every restored id is re-validated against the freshly-loaded
 * bootstrap data before use (below) — a stale id from a previous workspace just fails
 * validation and falls back to the default selection, exactly like a stale id from the SAME
 * workspace (e.g. something since archived) already would.
 *
 * Deliberately localStorage, not a URL query param: this app has no URL-based routing
 * anywhere today (the active tab itself is plain component state), so real shareable deep
 * links would require restoring the top-level tab too — a whole-app routing change well
 * beyond this component's boundary. This restores your place WITHIN Task Management across a
 * remount or a return visit to the tab.
 */
function readPersistedNav(): {
  spaceId: string | null; listId: string | null;
  expandedSpaceIds: string[]; expandedFolderIds: string[];
} {
  const empty = { spaceId: null, listId: null, expandedSpaceIds: [], expandedFolderIds: [] };
  try {
    const raw = localStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const strArr = (x: unknown) => Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
    return {
      spaceId: typeof parsed?.spaceId === 'string' ? parsed.spaceId : null,
      listId: typeof parsed?.listId === 'string' ? parsed.listId : null,
      expandedSpaceIds: strArr(parsed?.expandedSpaceIds),
      expandedFolderIds: strArr(parsed?.expandedFolderIds)
    };
  } catch {
    return empty;
  }
}

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

  const [persistedNav] = useState(readPersistedNav);
  const [spaceId, setSpaceId] = useState<string | null>(persistedNav.spaceId);
  const [listId, setListId] = useState<string | null>(persistedNav.listId);
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Set<string>>(
    () => new Set(persistedNav.expandedSpaceIds)
  );
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(persistedNav.expandedFolderIds)
  );
  /** Ids currently mid-mutation (including "temp-…" create placeholders) — the sidebar shows
   *  a spinner on that specific row and disables it, rather than freezing the whole tree. */
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
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

  /**
   * Validates the current (possibly localStorage-restored) Space against real data, falling
   * back to the first non-archived Space when it is missing, archived, or from a different
   * workspace than the one that just answered bootstrap. Also ensures the resolved Space is
   * expanded, which covers both first load and a restored selection alike.
   */
  useEffect(() => {
    if (!boot) return;
    const valid = spaceId !== null && boot.spaces.some(s => s.id === spaceId && !s.archived_at);
    const resolved = valid ? spaceId : (boot.spaces.find(s => !s.archived_at)?.id ?? null);
    if (resolved !== spaceId) { setSpaceId(resolved); return; }
    if (resolved) {
      setExpandedSpaceIds(prev => prev.has(resolved) ? prev : new Set(prev).add(resolved));
    }
  }, [boot, spaceId]);

  /**
   * Same validation for the List within the now-resolved Space, defaulting to that Space's
   * default List (or its first List) when the current one is missing, archived, or belongs to
   * a different Space. When valid and inside a Folder, ensures that Folder is expanded too, so
   * a restored selection is always visible in the tree, not hidden behind a collapsed Folder.
   */
  useEffect(() => {
    if (!boot || !spaceId) return;
    const current = listId ? boot.lists.find(l => l.id === listId) : undefined;
    const valid = !!current && current.space_id === spaceId && !current.archived_at;
    if (!valid) {
      const inSpace = boot.lists.filter(l => l.space_id === spaceId && !l.archived_at);
      setListId((inSpace.find(l => l.is_default) ?? inSpace[0])?.id ?? null);
      return;
    }
    if (current!.folder_id) {
      const fid = current!.folder_id;
      setExpandedFolderIds(prev => prev.has(fid) ? prev : new Set(prev).add(fid));
    }
  }, [boot, spaceId, listId]);

  // Persist navigation state across a remount or a return visit — see readPersistedNav above.
  useEffect(() => {
    try {
      localStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({
        spaceId, listId,
        expandedSpaceIds: [...expandedSpaceIds],
        expandedFolderIds: [...expandedFolderIds]
      }));
    } catch { /* storage unavailable (private mode, quota) — navigation still works, just not restored */ }
  }, [spaceId, listId, expandedSpaceIds, expandedFolderIds]);

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

  /**
   * Starting or stopping a timer writes/closes a task_time_entries row, which the List's
   * `tracked` summary must reflect — but TimerToggleButton (in rows, board cards and the
   * drawer) and the global ActiveTimerBar call timer.start/stop directly and have no idea
   * this view even has a cache to invalidate. This effect is the missing link.
   *
   * Keyed on the running entry's id, not the activeTimer object reference: refresh() also
   * runs on window focus and the 'online' event and always calls setActiveTimer with a new
   * object even when the running timer hasn't changed, which would re-trigger a naive
   * reference-based effect on every tab switch. The id only changes on an actual start, stop
   * or switch. The first-render guard skips the initial mount (loadTasks already fetches a
   * correct, current summary on mount regardless of whether a timer happens to be running),
   * so this fires only on a genuine transition thereafter.
   */
  const activeTimerEntryId = timer.activeTimer?.id ?? null;
  const isFirstTimerSync = useRef(true);
  useEffect(() => {
    if (isFirstTimerSync.current) { isFirstTimerSync.current = false; return; }
    loadTasks();
  }, [activeTimerEntryId]);

  const refreshAll = useCallback(() => { loadTasks(); timer.refresh(); }, [loadTasks, timer]);

  // ── Hierarchy mutations (optimistic, with rollback) ─────────────────────────────────
  const bootRef = useRef<Bootstrap | null>(null);
  bootRef.current = boot;

  /**
   * Applies an optimistic patch to `boot` immediately, then performs the real request.
   * On success, silently refetches bootstrap in the background to reconcile — replacing any
   * temp-id placeholder with the server's real row and correcting anything the optimistic
   * patch approximated (e.g. a reordered position). On failure, rolls back to the exact
   * pre-action snapshot, shows the server's error in the banner, and ALSO refetches — the
   * snapshot being rolled back to may itself be stale (e.g. a 409 from someone else's
   * concurrent edit), so the failure path re-syncs too rather than leaving a merely-reverted
   * but still-outdated tree on screen.
   */
  const optimisticAction = useCallback(async (
    targetId: string,
    apply: (b: Bootstrap) => Bootstrap,
    perform: () => Promise<unknown>,
    fallbackMessage: string
  ): Promise<boolean> => {
    const snapshot = bootRef.current;
    if (!snapshot) return false;
    setBoot(apply(snapshot));
    setPendingIds(prev => new Set(prev).add(targetId));
    const clearPending = () => setPendingIds(prev => {
      if (!prev.has(targetId)) return prev;
      const next = new Set(prev); next.delete(targetId); return next;
    });
    try {
      await perform();
      clearPending();
      loadBootstrap(true);
      return true;
    } catch (err: any) {
      setBoot(snapshot);
      clearPending();
      setBanner(err?.message ?? fallbackMessage);
      loadBootstrap(true);
      return false;
    }
  }, [loadBootstrap]);

  const handleHierarchyAction = useCallback(async (action: HierarchyAction): Promise<boolean> => {
    const current = bootRef.current;
    if (!current) return false;

    switch (action.type) {
      case 'createSpace': {
        const tempId = `temp-${crypto.randomUUID()}`;
        const optimistic: TaskSpace = { id: tempId, name: action.name, position: 1e9, version: 1, archived_at: null };
        return optimisticAction(tempId,
          b => ({ ...b, spaces: [...b.spaces, optimistic] }),
          async () => {
            const r = await api.createSpace(action.name);
            setSpaceId(r.spaceId);
            setExpandedSpaceIds(prev => new Set(prev).add(r.spaceId));
            setListId(r.defaultListId);
          },
          'Could not create the Space.');
      }

      case 'createFolder': {
        const tempId = `temp-${crypto.randomUUID()}`;
        const optimistic: TaskFolder = {
          id: tempId, space_id: action.spaceId, name: action.name, description: null,
          position: 1e9, version: 1, archived_at: null
        };
        return optimisticAction(tempId,
          b => ({ ...b, folders: [...b.folders, optimistic] }),
          async () => {
            const f = await api.createFolder({ spaceId: action.spaceId, name: action.name });
            setExpandedFolderIds(prev => new Set(prev).add(f.id));
          },
          'Could not create the Folder.');
      }

      case 'createList': {
        const tempId = `temp-${crypto.randomUUID()}`;
        const optimistic: TaskList = {
          id: tempId, space_id: action.spaceId, folder_id: action.folderId, name: action.name,
          position: 1e9, is_default: false, version: 1, archived_at: null
        };
        return optimisticAction(tempId,
          b => ({ ...b, lists: [...b.lists, optimistic] }),
          async () => {
            const l = await api.createList({ spaceId: action.spaceId, folderId: action.folderId ?? undefined, name: action.name });
            setListId(l.id);
          },
          'Could not create the List.');
      }

      case 'renameSpace':
        return optimisticAction(action.space.id,
          b => ({ ...b, spaces: b.spaces.map(s => s.id === action.space.id ? { ...s, name: action.name } : s) }),
          () => api.updateSpace(action.space.id, { name: action.name, version: action.space.version }),
          'Could not rename the Space.');

      case 'renameFolder':
        return optimisticAction(action.folder.id,
          b => ({ ...b, folders: b.folders.map(f => f.id === action.folder.id ? { ...f, name: action.name } : f) }),
          () => api.updateFolder(action.folder.id, { name: action.name, version: action.folder.version }),
          'Could not rename the Folder.');

      case 'renameList':
        return optimisticAction(action.list.id,
          b => ({ ...b, lists: b.lists.map(l => l.id === action.list.id ? { ...l, name: action.name } : l) }),
          () => api.updateList(action.list.id, { name: action.name, version: action.list.version }),
          'Could not rename the List.');

      case 'archiveToggleSpace': {
        const archiving = !action.space.archived_at;
        return optimisticAction(action.space.id,
          b => ({ ...b, spaces: b.spaces.map(s => s.id === action.space.id
            ? { ...s, archived_at: archiving ? new Date().toISOString() : null } : s) }),
          () => api.updateSpace(action.space.id, { archived: archiving, version: action.space.version }),
          'Could not update the Space.');
      }

      case 'archiveToggleFolder': {
        const archiving = !action.folder.archived_at;
        return optimisticAction(action.folder.id,
          b => ({ ...b, folders: b.folders.map(f => f.id === action.folder.id
            ? { ...f, archived_at: archiving ? new Date().toISOString() : null } : f) }),
          () => api.updateFolder(action.folder.id, { archived: archiving, version: action.folder.version }),
          // The server's TASK_FOLDER_NOT_EMPTY message ("This folder still has N list(s)…")
          // already names the exact reason — no need for a separate generic fallback here
          // beyond the one every action already has.
          'Could not update the Folder.');
      }

      case 'archiveToggleList': {
        const archiving = !action.list.archived_at;
        return optimisticAction(action.list.id,
          b => ({ ...b, lists: b.lists.map(l => l.id === action.list.id
            ? { ...l, archived_at: archiving ? new Date().toISOString() : null } : l) }),
          () => api.updateList(action.list.id, { archived: archiving, version: action.list.version }),
          'Could not update the List.');
      }

      case 'reorderSpace': {
        const siblings = current.spaces.filter(s => !s.archived_at).sort((a, b) => a.position - b.position);
        const i = siblings.findIndex(x => x.id === action.space.id);
        const j = i + action.dir;
        if (i < 0 || j < 0 || j >= siblings.length) return false;
        const target = siblings[j].position + (action.dir === 1 ? 1 : -1);
        return optimisticAction(action.space.id,
          b => ({ ...b, spaces: b.spaces.map(s => s.id === action.space.id ? { ...s, position: target } : s) }),
          () => api.updateSpace(action.space.id, { position: target, version: action.space.version }),
          'Could not reorder the Space.');
      }

      case 'reorderFolder': {
        const siblings = current.folders
          .filter(f => f.space_id === action.folder.space_id && !f.archived_at)
          .sort((a, b) => a.position - b.position);
        const i = siblings.findIndex(x => x.id === action.folder.id);
        const j = i + action.dir;
        if (i < 0 || j < 0 || j >= siblings.length) return false;
        const target = siblings[j].position + (action.dir === 1 ? 1 : -1);
        return optimisticAction(action.folder.id,
          b => ({ ...b, folders: b.folders.map(f => f.id === action.folder.id ? { ...f, position: target } : f) }),
          () => api.updateFolder(action.folder.id, { position: target, version: action.folder.version }),
          'Could not reorder the Folder.');
      }

      case 'reorderList': {
        // Siblings are scoped by (space_id, folder_id) together: a direct List and a List
        // inside a Folder are never siblings, even sitting in the same Space, since each
        // grouping has its own independent position sequence.
        const siblings = current.lists.filter(l =>
          l.space_id === action.list.space_id && l.folder_id === action.list.folder_id && !l.archived_at
        ).sort((a, b) => a.position - b.position);
        const i = siblings.findIndex(x => x.id === action.list.id);
        const j = i + action.dir;
        if (i < 0 || j < 0 || j >= siblings.length) return false;
        const target = siblings[j].position + (action.dir === 1 ? 1 : -1);
        return optimisticAction(action.list.id,
          b => ({ ...b, lists: b.lists.map(l => l.id === action.list.id ? { ...l, position: target } : l) }),
          () => api.updateList(action.list.id, { position: target, version: action.list.version }),
          'Could not reorder the List.');
      }

      case 'moveList': {
        if (action.list.folder_id === action.folderId) return true; // already there
        if (action.folderId) {
          const fid = action.folderId;
          setExpandedFolderIds(prev => prev.has(fid) ? prev : new Set(prev).add(fid));
        }
        return optimisticAction(action.list.id,
          b => ({ ...b, lists: b.lists.map(l => l.id === action.list.id ? { ...l, folder_id: action.folderId } : l) }),
          () => api.updateList(action.list.id, { folderId: action.folderId, version: action.list.version }),
          'Could not move the List.');
      }
    }
  }, [api, optimisticAction]);

  const spaceStatuses = useMemo(
    () => (boot?.statuses ?? []).filter(s => s.space_id === spaceId),
    [boot, spaceId]
  );
  const spaceLists = useMemo(
    () => (boot?.lists ?? []).filter(l => l.space_id === spaceId),
    [boot, spaceId]
  );
  const selectedList = useMemo(
    () => boot?.lists.find(l => l.id === listId),
    [boot, listId]
  );
  const breadcrumb = useMemo(() => ({
    spaceName: boot?.spaces.find(s => s.id === spaceId)?.name,
    folderName: selectedList?.folder_id
      ? boot?.folders.find(f => f.id === selectedList.folder_id)?.name
      : null,
    listName: selectedList?.name
  }), [boot, spaceId, selectedList]);
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
    // Retrying cannot fix any of these — they need an operator, not another request.
    const terminal = ['TASK_MODULE_DISABLED', 'TASK_ROLLOUT_EXCLUDED', 'TASK_WORKSPACE_SUSPENDED']
      .includes(bootError.code ?? '');
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
            spaces={boot!.spaces} folders={boot!.folders} lists={boot!.lists}
            selectedSpaceId={spaceId} selectedListId={listId}
            expandedSpaceIds={expandedSpaceIds} expandedFolderIds={expandedFolderIds}
            pendingIds={pendingIds}
            canManage={caps.canManageHierarchy} showArchived={showArchived}
            onSelectSpace={id => { setSpaceId(id); setPage(1); }}
            onSelectList={id => { setListId(id); setPage(1); }}
            onToggleSpaceExpanded={id => setExpandedSpaceIds(prev => {
              const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
            })}
            onToggleFolderExpanded={id => setExpandedFolderIds(prev => {
              const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
            })}
            onAction={handleHierarchyAction}
          />
        </aside>

        <div className="min-w-0 space-y-3">
          <HierarchyBreadcrumb {...breadcrumb} />

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
              spaces={boot!.spaces} folders={boot!.folders} lists={boot!.lists}
              selectedSpaceId={spaceId} selectedListId={listId}
              expandedSpaceIds={expandedSpaceIds} expandedFolderIds={expandedFolderIds}
              pendingIds={pendingIds}
              canManage={caps.canManageHierarchy} showArchived={showArchived}
              onSelectSpace={id => { setSpaceId(id); setPage(1); }}
              onSelectList={id => { setListId(id); setPage(1); setMobileNavOpen(false); }}
              onToggleSpaceExpanded={id => setExpandedSpaceIds(prev => {
                const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
              })}
              onToggleFolderExpanded={id => setExpandedFolderIds(prev => {
                const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
              })}
              onAction={handleHierarchyAction}
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
