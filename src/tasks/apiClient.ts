/**
 * Typed browser client for /api/tasks.
 *
 * Contract notes that matter:
 *   * Success is always { status:'success', data, ...extra }; failure is always
 *     { status:'error', code, error, ...extra }. Callers branch on `code`, never on message
 *     text, because messages are user-facing prose and may change.
 *   * The workspace is NEVER sent. The server derives it from the session and rejects any
 *     client-supplied workspace_id with 422 — so sending one is a bug, not a convenience.
 *   * Every request is `cache: 'no-store'`. The service worker also refuses to cache
 *     /api/tasks/, so a stale board or a stale active timer can never be served.
 *   * The backend remains authoritative for auth, isolation, entitlement, RBAC and timer
 *     concurrency. Anything this module reports about permissions is a usability hint.
 */

// ── Wire types (mirror the server payloads exactly; no invented fields) ────────────────

export type TaskErrorCode =
  | 'TASK_MODULE_DISABLED' | 'TASK_ROLLOUT_EXCLUDED'
  | 'TASK_TIME_TRACKING_DISABLED' | 'TASK_ACTOR_UNRESOLVED'
  | 'TASK_ENTITLEMENT_EXPIRED' | 'TASK_WORKSPACE_SUSPENDED' | 'TASK_FORBIDDEN'
  | 'TASK_NOT_FOUND' | 'TASK_VALIDATION_FAILED' | 'TASK_VERSION_CONFLICT'
  | 'TASK_TIMER_CONFLICT' | 'TASK_NO_ACTIVE_TIMER'
  | 'TASK_FOLDER_NOT_EMPTY' | 'TASK_FOLDER_CROSS_SPACE'
  | 'TASK_INTERNAL_ERROR'
  | 'TASK_UNAUTHENTICATED' | 'TASK_NETWORK';

export type Priority = 'urgent' | 'high' | 'normal' | 'low';
export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type TimeVisibility = 'team' | 'own' | 'aggregate_only';

export interface TaskSpace {
  id: string; name: string; position: number; version: number; archived_at: string | null;
}
export interface TaskFolder {
  id: string; space_id: string; name: string; description: string | null;
  position: number; version: number; archived_at: string | null;
}
export interface TaskList {
  id: string; space_id: string; folder_id: string | null; name: string; position: number;
  is_default: boolean; version: number; archived_at: string | null;
}
export interface TaskStatus {
  id: string; space_id: string; name: string; category: StatusCategory;
  color: string | null; position: number; is_default: boolean;
  version: number; archived_at: string | null;
}
export interface TaskItem {
  id: string; list_id: string; status_id: string; parent_task_id: string | null;
  title: string; description: string | null; priority: Priority;
  start_date: string | null; due_date: string | null;
  time_estimate_seconds: number | null;
  position: number; version: number; archived_at: string | null;
  created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
  assigneeActorIds: string[];
  subtaskCount?: number;
  subtasks?: TaskItem[];
}
export interface WorkspaceActor {
  actorId: string; displayName: string | null; email: string | null;
  archived: boolean; isSelf: boolean;
}
export interface ActiveTimer { id: string; task_id: string; started_at: string; }
export interface TimeEntry {
  id: string; task_id: string; actor_id: string;
  started_at: string; ended_at: string | null;
  source: 'timer' | 'manual'; note: string | null; archived_at?: string | null;
}
export interface ActivityEvent {
  id: string; actor_id: string | null; entity_type: string;
  action: string; detail: Record<string, unknown>; created_at: string;
}
export interface Capabilities {
  canManageHierarchy: boolean; canCreateTask: boolean; canAssignOthers: boolean;
  timeVisibility: TimeVisibility; timeTrackingEnabled: boolean; actorResolved: boolean;
}
export interface Bootstrap {
  spaces: TaskSpace[]; folders: TaskFolder[]; lists: TaskList[]; statuses: TaskStatus[];
  activeTimer: ActiveTimer | null; capabilities: Capabilities;
}
export interface PageInfo { page: number; pageSize: number; total: number; }

/**
 * Per-status totals for the status-grouped List view.
 *
 * Computed by the server across the WHOLE active query, not the page being viewed — so a
 * group header's count is how many tasks match the current filters, which is the only figure
 * that stays consistent once the result spans more than one page.
 */
export interface StatusGroupCount { statusId: string; total: number; }

export type StatusTemplatePlanAction = 'reuse' | 'create' | 'keep';
export interface StatusTemplatePlanItem {
  action: StatusTemplatePlanAction;
  name: string; category: string; color: string | null;
  statusId?: string; position: number; taskCount?: number; note: string;
}
export interface StatusTemplatePlan {
  templateKey: string; templateLabel: string;
  items: StatusTemplatePlanItem[];
  createCount: number; reuseCount: number; keepCount: number; noop: boolean;
}

/** Normalised failure. Every rejection from this client is one of these. */
export class TaskApiError extends Error {
  constructor(
    public status: number,
    public code: TaskErrorCode,
    message: string,
    /** Extra payload the server attached, e.g. the running timer on a 409. */
    public payload: Record<string, any> = {}
  ) {
    super(message);
    this.name = 'TaskApiError';
  }
  /** True when retrying verbatim cannot succeed and the user must change something. */
  get isTerminal(): boolean {
    return ['TASK_MODULE_DISABLED', 'TASK_ROLLOUT_EXCLUDED',
            'TASK_WORKSPACE_SUSPENDED', 'TASK_ACTOR_UNRESOLVED',
            'TASK_FORBIDDEN', 'TASK_NOT_FOUND',
            'TASK_FOLDER_NOT_EMPTY', 'TASK_FOLDER_CROSS_SPACE'].includes(this.code);
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function createTaskApi(getToken: () => string) {
  async function request<T>(
    method: string, path: string, opts: RequestOptions = {}
  ): Promise<{ data: T; page?: PageInfo; raw: any }> {
    const headers: Record<string, string> = { 'x-auth-token': getToken() };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    // The router is mounted at /api/tasks, so its root route is addressed as path '/'.
    // Naively concatenating that yields '/api/tasks/', and Vercel's rewrite
    // (/api/:path* -> /api/index) does NOT match a bare trailing slash: the request is
    // answered with a platform-level 404 before it ever reaches Express. Verified against a
    // live deployment — '/api/tasks/' 404s while '/api/tasks' returns 200 for the same query
    // and token, and '/api/tasks/bootstrap/' 404s while '/api/tasks/bootstrap' succeeds.
    // Collapsing the root path to '' keeps every call on a shape the rewrite matches.
    const suffix = path === '/' ? '' : path;

    let res: Response;
    try {
      res = await fetch(`/api/tasks${suffix}${buildQuery(opts.query)}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
        cache: 'no-store'
      });
    } catch (err: any) {
      // Abort is a normal control-flow signal, not an error to surface.
      if (err?.name === 'AbortError') throw err;
      throw new TaskApiError(0, 'TASK_NETWORK',
        'Could not reach the server. Check your connection and try again.');
    }

    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }

    if (!res.ok || json?.status === 'error') {
      const code: TaskErrorCode =
        json?.code ?? (res.status === 401 ? 'TASK_UNAUTHENTICATED' : 'TASK_INTERNAL_ERROR');
      const message = json?.error ?? `Request failed (${res.status}).`;
      const { status: _s, code: _c, error: _e, ...payload } = json ?? {};
      throw new TaskApiError(res.status, code, message, payload);
    }
    return { data: json?.data as T, page: json?.page, raw: json };
  }

  return {
    // Reads
    bootstrap: (signal?: AbortSignal) =>
      request<Bootstrap>('GET', '/bootstrap', { signal }).then(r => r.data),

    actors: (signal?: AbortSignal) =>
      request<WorkspaceActor[]>('GET', '/actors', { signal }).then(r => r.data),

    statuses: (spaceId: string, signal?: AbortSignal) =>
      request<TaskStatus[]>('GET', '/statuses', { query: { spaceId }, signal }).then(r => r.data),

    /** `groups` is present only when the caller asked for `groupBy: 'status'` (with a spaceId). */
    listTasks: (query: Record<string, any>, signal?: AbortSignal) =>
      request<TaskItem[]>('GET', '/', { query, signal })
        .then(r => ({
          tasks: r.data ?? [],
          page: r.page,
          groups: r.raw?.groups as StatusGroupCount[] | undefined
        })),

    getTask: (id: string, signal?: AbortSignal) =>
      request<TaskItem>('GET', `/${id}`, { signal }).then(r => r.data),

    activity: (id: string, signal?: AbortSignal) =>
      request<ActivityEvent[]>('GET', `/${id}/activity`, { signal }).then(r => r.data),

    taskTimeEntries: (id: string, signal?: AbortSignal) =>
      request<{ entries: TimeEntry[]; visibility: TimeVisibility }>(
        'GET', `/${id}/time-entries`, { signal }).then(r => r.data),

    timeSummary: (query: Record<string, any> = {}, signal?: AbortSignal) =>
      request<{ byTask: { taskId: string; trackedSeconds: number }[];
                byMember: { actorId: string; trackedSeconds: number }[];
                visibility: TimeVisibility }>('GET', '/time/summary', { query, signal })
        .then(r => r.data),

    // Hierarchy
    createSpace: (name: string) =>
      request<{ spaceId: string; defaultListId: string }>('POST', '/spaces', { body: { name } })
        .then(r => r.data),
    updateSpace: (id: string, body: Record<string, unknown>) =>
      request<TaskSpace>('PATCH', `/spaces/${id}`, { body }).then(r => r.data),

    createFolder: (body: { spaceId: string; name: string; description?: string }) =>
      request<TaskFolder>('POST', '/folders', { body }).then(r => r.data),
    /** `body.folderId`: omit to leave unchanged, `null` to move to the Space root, or a Folder id. */
    updateFolder: (id: string, body: Record<string, unknown>) =>
      request<TaskFolder>('PATCH', `/folders/${id}`, { body }).then(r => r.data),

    createList: (body: { spaceId: string; folderId?: string | null; name: string; position?: number }) =>
      request<TaskList>('POST', '/lists', { body }).then(r => r.data),
    /** `body.folderId`: omit to leave unchanged, `null` to move to the Space root, or a Folder id. */
    updateList: (id: string, body: Record<string, unknown>) =>
      request<TaskList>('PATCH', `/lists/${id}`, { body }).then(r => r.data),

    createStatus: (body: { spaceId: string; name: string; category: StatusCategory; color?: string }) =>
      request<TaskStatus>('POST', '/statuses', { body }).then(r => r.data),
    updateStatus: (id: string, body: Record<string, unknown>) =>
      request<TaskStatus>('PATCH', `/statuses/${id}`, { body }).then(r => r.data),

    /**
     * Dry-run: returns exactly what applying the template WOULD do, having written nothing.
     * The UI must show this and take a second, explicit confirmation before calling apply.
     */
    previewStatusTemplate: (spaceId: string, template = 'operations') =>
      request<StatusTemplatePlan & { dryRun: true }>(
        'POST', '/statuses/template/preview', { body: { spaceId, template } }).then(r => r.data),

    applyStatusTemplate: (spaceId: string, template = 'operations') =>
      request<{ applied: true; plan: StatusTemplatePlan; statuses: TaskStatus[] }>(
        'POST', '/statuses/template/apply', { body: { spaceId, template } }).then(r => r.data),

    // Tasks
    createTask: (body: Record<string, unknown>) =>
      request<TaskItem>('POST', '/', { body }).then(r => r.data),
    updateTask: (id: string, body: Record<string, unknown>) =>
      request<TaskItem>('PATCH', `/${id}`, { body }).then(r => r.data),
    archiveTask: (id: string, version: number) =>
      request<TaskItem>('POST', `/${id}/archive`, { body: { version } }).then(r => r.data),
    restoreTask: (id: string, version: number) =>
      request<TaskItem>('POST', `/${id}/restore`, { body: { version } }).then(r => r.data),
    setAssignees: (id: string, actorIds: string[]) =>
      request<{ taskId: string; assigneeActorIds: string[] }>(
        'PUT', `/${id}/assignees`, { body: { actorIds } }).then(r => r.data),

    // Time
    activeTimer: (signal?: AbortSignal) =>
      request<{ activeTimer: ActiveTimer | null; serverTime?: string }>(
        'GET', '/timer/active', { signal }).then(r => r.data),

    /**
     * Starts a timer. `clientToken` MUST be stable across retries of the same user intent —
     * the server dedupes on it, so a retried request returns the original entry instead of
     * creating a second one.
     */
    startTimer: (taskId: string, clientToken: string) =>
      request<{ entryId: string; taskId: string; startedAt: string;
                outcome: string; serverTime: string }>(
        'POST', '/timer/start', { body: { taskId, clientToken } }).then(r => r.data),

    stopTimer: (entryId?: string) =>
      request<{ entryId: string; taskId: string; startedAt: string; endedAt: string;
                durationSeconds: number; outcome: string }>(
        'POST', '/timer/stop', { body: entryId ? { entryId } : {} }).then(r => r.data),

    addManualEntry: (body: { taskId: string; startedAt: string; endedAt: string; note?: string }) =>
      request<TimeEntry>('POST', '/time-entries', { body }).then(r => r.data),
    updateTimeEntry: (id: string, body: Record<string, unknown>) =>
      request<TimeEntry>('PATCH', `/time-entries/${id}`, { body }).then(r => r.data)
  };
}

export type TaskApi = ReturnType<typeof createTaskApi>;

/** RFC4122 v4 token for timer idempotency. Uses crypto when available. */
export function newClientToken(): string {
  const c: any = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  (c?.getRandomValues ? c.getRandomValues(b) : b.forEach((_, i) => (b[i] = Math.floor(Math.random() * 256))));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/** Formats seconds as H:MM:SS for timer displays. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Compact "2h 15m" style, ESTIMATE-ONLY.
 *
 * time_estimate_seconds is a planning figure a person typed in round units, never a measured
 * duration — so it deliberately stays coarse (no seconds shown) and always shows minutes even
 * at :00, which reads as "a whole number of hours" rather than an ambiguous bare "2h". Do not
 * repurpose this for tracked/actual time: use formatTrackedDuration for that, which is exact
 * to the second and never collapses a real positive duration to the same string as "no data".
 */
export function formatTracked(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Canonical formatter for ACTUAL tracked time (completed entries plus, where the caller
 * includes it, the live elapsed seconds of a running timer). Exact to the second below one
 * hour, so a 48-second task and a 61-second task are visibly different — unlike formatTracked,
 * which would round both estimate-style. `undefined`/`null` are ONLY valid at the call site as
 * "not yet known" and must never reach here as an implicit 0; callers should show a loading
 * state instead. A genuine 0 is the only input that renders as "—", so a real positive
 * duration — even 1 second — can never be mistaken for "no time recorded".
 */
export function formatTrackedDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s <= 0) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem ? `${m}m ${rem}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
