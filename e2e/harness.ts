import { test as base, expect, type Page, type Route } from '@playwright/test';
import * as F from './fixtures';

/**
 * TEST-ONLY request interception harness.
 *
 * `installApi()` intercepts EVERY `/api/**` request the page makes and answers it locally
 * from e2e/fixtures.ts. There is a deliberate catch-all at the end that ABORTS anything
 * unrecognised and records it as a leak, so a request this harness does not model fails
 * loudly instead of escaping. The dev server (`vite`) has no API of its own, so combined
 * with this, no browser test can reach the production Task API.
 *
 * Response shapes below mirror src/tasks/router.ts exactly — same keys, same error codes
 * (TASK_*), same pagination envelope ({ page: { page, pageSize, total } }). If the harness
 * and the router ever disagree, the harness is wrong.
 */

export { expect };
export const test = base;

type ApiState = {
  role: F.Role;
  caps: any;
  tasks: any[];
  statuses: any[];
  lists: any[];
  spaces: any[];
  folders: any[];
  activeTimer: { id: string; task_id: string; started_at: string } | null;
  overrides: Map<string, { status: number; body: string; sticky?: boolean }>;
  hold: Set<string>;
  seen: string[];
};

export type Harness = {
  state: ApiState;
  /** Force the next request whose `METHOD /path` starts with `key` to fail. status 0 = network failure. */
  failNext(key: string, status: number, body: string): void;
  failAlways(key: string, status: number, body: string): void;
  clearFailures(): void;
  holdRoute(key: string): void;
  releaseRoute(key: string): void;
  requests(): string[];
  assertNoLeaks(): void;
};

const now = () => new Date().toISOString();
const json = (route: Route, status: number, body: string) =>
  route.fulfill({ status, contentType: 'application/json', body });

/** Matches the server envelope: { status:'success', data, ...extra }. */
const ok = (data: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'success', data, ...extra });

/** Matches the server envelope: { status:'error', code, error, ...extra }. */
export const fail = (code: string, error: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ status: 'error', code, error, ...extra });

function sessionPayload(role: F.Role, over: Record<string, unknown> = {}) {
  return {
    status: 'success',
    session: {
      token: F.FAKE_TOKEN,
      role,
      user: { id: 'e2e-user', name: 'Dana Tester', email: 'dana@example.test', onboarded: true },
      activeWorkspace: { id: 'e2e-workspace', name: 'Showtime QA Workspace', tier: 'growth' },
      entitlement: { hasAccess: true, state: 'active', kind: 'perpetual', daysRemaining: null },
      ...over
    },
    workspaces: [
      { id: 'e2e-workspace', name: 'Showtime QA Workspace', role },
      { id: 'e2e-workspace-2', name: 'Second Workspace', role }
    ]
  };
}

export async function installApi(
  page: Page,
  opts: {
    role?: F.Role;
    session?: Record<string, unknown>;
    caps?: Record<string, unknown>;
    tasks?: any[];
    spaces?: any[];
    folders?: any[];
    lists?: any[];
  } = {}
): Promise<Harness> {
  const role = opts.role ?? 'ADMIN';

  const state: ApiState = {
    role,
    caps: { ...F.capabilitiesFor(role), ...(opts.caps ?? {}) },
    tasks: JSON.parse(JSON.stringify(opts.tasks ?? F.tasks)),
    statuses: JSON.parse(JSON.stringify(F.statuses)),
    lists: JSON.parse(JSON.stringify(opts.lists ?? F.lists)),
    spaces: JSON.parse(JSON.stringify(opts.spaces ?? F.spaces)),
    folders: JSON.parse(JSON.stringify(opts.folders ?? F.folders)),
    activeTimer: null,
    overrides: new Map(),
    hold: new Set(),
    seen: []
  };

  const leaks: string[] = [];

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const key = `${req.method()} ${path}`;
    // Overrides match on method + path + query, so a test can single out the task LIST
    // request (`GET /api/tasks?`) without also catching `GET /api/tasks/bootstrap`.
    const keyWithQuery = key + url.search;
    state.seen.push(keyWithQuery);

    // Hold-open support, so loading states can actually be observed in the browser.
    for (const h of [...state.hold]) {
      if (keyWithQuery.startsWith(h)) {
        await new Promise<void>((resolve) => {
          const iv = setInterval(() => {
            if (!state.hold.has(h)) { clearInterval(iv); resolve(); }
          }, 40);
        });
        break;
      }
    }

    for (const [k, ov] of state.overrides) {
      if (keyWithQuery.startsWith(k)) {
        if (!ov.sticky) state.overrides.delete(k);
        if (ov.status === 0) return route.abort('failed'); // simulated network failure
        return json(route, ov.status, ov.body);
      }
    }

    // ---- Session --------------------------------------------------------
    if (path === '/api/auth/me' || path === '/api/auth/login' || path === '/api/auth/signup') {
      return json(route, 200, JSON.stringify(sessionPayload(role, opts.session ?? {})));
    }
    if (path.startsWith('/api/auth/')) {
      return json(route, 200, JSON.stringify({ status: 'success' }));
    }

    // ---- Reporting dashboards (NOT under test) --------------------------
    // Answered with an error envelope rather than empty data on purpose: these consumers
    // only assign state on `status === 'success'`, so an error leaves their defaults intact,
    // whereas `data: {}` would hand them a report object missing every field and crash the
    // render. Task Management does not read any of these.
    if (path.startsWith('/api/ghl/') || path.startsWith('/api/reporting/') ||
        path.startsWith('/api/admin/') || path.startsWith('/api/billing') ||
        path.startsWith('/api/entitlement') || path.startsWith('/api/health')) {
      return json(route, 200, JSON.stringify({
        status: 'error',
        error: 'Reporting data is not served in browser QA.'
      }));
    }

    // ---- Task API -------------------------------------------------------
    if (path === '/api/tasks' || path.startsWith('/api/tasks/')) {
      const res = handleTasks(req.method(), path, url, parseBody(req.postData()), state);
      if (res) return json(route, res[0], res[1]);
    }

    leaks.push(key);
    return route.abort('failed');
  });

  return {
    state,
    failNext(key, status, body) { state.overrides.set(key, { status, body }); },
    failAlways(key, status, body) { state.overrides.set(key, { status, body, sticky: true }); },
    clearFailures() { state.overrides.clear(); },
    holdRoute(key) { state.hold.add(key); },
    releaseRoute(key) { state.hold.delete(key); },
    requests() { return state.seen; },
    assertNoLeaks() {
      expect(leaks, `Un-intercepted API requests escaped the harness: ${leaks.join(', ')}`).toEqual([]);
    }
  };
}

function parseBody(raw: string | null): any {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function handleTasks(
  method: string, path: string, url: URL, body: any, s: ApiState
): [number, string] | null {
  const seg = path.replace(/^\/api\/tasks\/?/, '').split('/').filter(Boolean);
  const q = url.searchParams;

  // ---- GET /bootstrap ---------------------------------------------------
  if (method === 'GET' && seg[0] === 'bootstrap') {
    return [200, ok({
      spaces: s.spaces,
      folders: s.folders,
      lists: s.lists,
      statuses: s.statuses,
      activeTimer: s.activeTimer,
      capabilities: s.caps
    })];
  }

  if (method === 'GET' && seg[0] === 'actors') return [200, ok(F.actors)];

  // ---- Time summary (must precede the /:id route) -----------------------
  if (method === 'GET' && seg[0] === 'time' && seg[1] === 'summary') {
    return [200, ok({
      byTask: [{ taskId: F.TASK_1, trackedSeconds: 5400 }],
      byMember: s.caps.timeVisibility === 'team'
        ? [{ actorId: F.ACTOR_ME, trackedSeconds: 5400 }] : [],
      visibility: s.caps.timeVisibility
    })];
  }

  // ---- Timer ------------------------------------------------------------
  if (seg[0] === 'timer') {
    if (method === 'GET' && seg[1] === 'active') {
      return [200, ok({ activeTimer: s.activeTimer, serverTime: now() })];
    }
    if (method === 'POST' && seg[1] === 'start') {
      if (s.activeTimer && s.activeTimer.task_id !== body.taskId) {
        return [409, fail('TASK_TIMER_CONFLICT',
          'A timer is already running on a different task.', {
            data: {
              entryId: s.activeTimer.id,
              taskId: s.activeTimer.task_id,
              startedAt: s.activeTimer.started_at
            },
            serverTime: now()
          })];
      }
      const startedAt = now();
      s.activeTimer = { id: 'entry-live', task_id: body.taskId, started_at: startedAt };
      return [200, ok({
        entryId: 'entry-live', taskId: body.taskId, startedAt,
        outcome: 'started', serverTime: now()
      })];
    }
    if (method === 'POST' && seg[1] === 'stop') {
      if (!s.activeTimer) return [404, fail('TASK_NO_ACTIVE_TIMER', 'No running timer to stop.')];
      const stopped = s.activeTimer;
      s.activeTimer = null;
      return [200, ok({
        entryId: stopped.id, taskId: stopped.task_id, startedAt: stopped.started_at,
        endedAt: now(), durationSeconds: 63, outcome: 'stopped'
      })];
    }
  }

  // ---- Manual time entries (collection) ---------------------------------
  if (seg[0] === 'time-entries' && method === 'POST') {
    if (!body.startedAt || !body.endedAt) {
      return [400, fail('TASK_VALIDATION_FAILED', 'A start and end time are required.')];
    }
    if (new Date(body.endedAt) <= new Date(body.startedAt)) {
      return [400, fail('TASK_VALIDATION_FAILED', 'The end time must be after the start time.')];
    }
    return [201, ok({
      id: 'entry-manual', task_id: body.taskId, actor_id: F.ACTOR_ME,
      started_at: body.startedAt, ended_at: body.endedAt,
      source: 'manual', note: body.note ?? null
    })];
  }

  // ---- Statuses ---------------------------------------------------------
  if (seg[0] === 'statuses') {
    if (method === 'GET') {
      return [200, ok(s.statuses.filter((x) => x.space_id === (q.get('spaceId') ?? x.space_id)))];
    }
    if (method === 'POST') {
      const name = String(body.name ?? '').trim();
      if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
      if (s.statuses.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
        return [409, fail('TASK_VALIDATION_FAILED',
          'A status with that name already exists in this Space.')];
      }
      const created = {
        id: `status-new-${s.statuses.length + 1}`, space_id: body.spaceId ?? F.SPACE_A, name,
        category: body.category ?? 'todo', color: body.color ?? null,
        position: (s.statuses.length + 1) * 1000, is_default: false, version: 1, archived_at: null
      };
      s.statuses.push(created);
      return [201, ok(created)];
    }
    if (method === 'PATCH' && seg[1]) {
      const row = s.statuses.find((x) => x.id === seg[1]);
      if (!row) return [404, fail('TASK_NOT_FOUND', 'Status not found.')];
      if (body.name !== undefined) {
        const name = String(body.name ?? '').trim();
        if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
        if (s.statuses.some((x) => x.id !== row.id && x.name.toLowerCase() === name.toLowerCase())) {
          return [409, fail('TASK_VALIDATION_FAILED',
            'A status with that name already exists in this Space.')];
        }
        row.name = name;
      }
      if (body.color !== undefined) {
        if (body.color !== null && !/^#[0-9A-Fa-f]{6}$/.test(String(body.color))) {
          return [400, fail('TASK_VALIDATION_FAILED',
            'color must be a 6-digit hex value such as #2563EB.')];
        }
        row.color = body.color;
      }
      if (body.category !== undefined) row.category = body.category;
      if (body.position !== undefined) row.position = body.position;
      row.version += 1;
      s.statuses.sort((a, b) => a.position - b.position);
      return [200, ok(row)];
    }
  }

  // ---- Spaces / Lists ---------------------------------------------------
  if (seg[0] === 'spaces') {
    if (method === 'POST') {
      const name = String(body.name ?? '').trim();
      if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
      const id = `space-new-${s.spaces.length + 1}`;
      const listId = `list-new-${s.lists.length + 1}`;
      s.spaces.push({ id, name, position: 9000, version: 1, archived_at: null });
      s.lists.push({ id: listId, space_id: id, name: 'General', position: 1000,
                     is_default: true, version: 1, archived_at: null });
      return [200, ok({ spaceId: id, defaultListId: listId })];
    }
    if (method === 'PATCH' && seg[1]) {
      const row = s.spaces.find((x) => x.id === seg[1]);
      if (!row) return [404, fail('TASK_NOT_FOUND', 'Space not found.')];
      if (body.name !== undefined) row.name = String(body.name).trim();
      if (body.archived !== undefined) row.archived_at = body.archived ? now() : null;
      row.version += 1;
      return [200, ok(row)];
    }
  }
  // ---- Folders (migration 0009) ------------------------------------------
  if (seg[0] === 'folders') {
    if (method === 'POST') {
      const name = String(body.name ?? '').trim();
      if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
      const row = {
        id: `folder-new-${s.folders.length + 1}`, space_id: body.spaceId ?? F.SPACE_A,
        name, description: body.description ?? null, position: 9000, version: 1, archived_at: null
      };
      s.folders.push(row);
      return [201, ok(row)];
    }
    if (method === 'PATCH' && seg[1]) {
      const row = s.folders.find((x) => x.id === seg[1]);
      if (!row) return [404, fail('TASK_NOT_FOUND', 'Folder not found.')];
      // Mirrors the router's non-empty-archive guard (TASK_FOLDER_NOT_EMPTY, 409): refuse
      // archiving while a non-archived List still points at this Folder.
      if (body.archived === true) {
        const liveListCount = s.lists.filter((l) => l.folder_id === row.id && !l.archived_at).length;
        if (liveListCount > 0) {
          return [409, fail('TASK_FOLDER_NOT_EMPTY',
            `This folder still has ${liveListCount} list${liveListCount === 1 ? '' : 's'} in it. Move or archive them first.`,
            { listCount: liveListCount })];
        }
      }
      if (body.name !== undefined) row.name = String(body.name).trim();
      if (body.description !== undefined) row.description = body.description;
      if (body.position !== undefined) row.position = body.position;
      if (body.archived !== undefined) row.archived_at = body.archived ? now() : null;
      row.version += 1;
      return [200, ok(row)];
    }
  }

  if (seg[0] === 'lists') {
    if (method === 'POST') {
      const name = String(body.name ?? '').trim();
      if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
      const spaceId = body.spaceId ?? F.SPACE_A;
      const folderId = body.folderId ?? null;
      if (folderId) {
        const folder = s.folders.find((f) => f.id === folderId);
        if (!folder) return [404, fail('TASK_NOT_FOUND', 'Folder not found.')];
        if (folder.space_id !== spaceId) {
          return [422, fail('TASK_FOLDER_CROSS_SPACE', 'That folder belongs to a different Space and cannot be used here.')];
        }
      }
      const row = { id: `list-new-${s.lists.length + 1}`, space_id: spaceId, folder_id: folderId,
                    name, position: 9000, is_default: false, version: 1, archived_at: null };
      s.lists.push(row);
      return [201, ok(row)];
    }
    if (method === 'PATCH' && seg[1]) {
      const row = s.lists.find((x) => x.id === seg[1]);
      if (!row) return [404, fail('TASK_NOT_FOUND', 'List not found.')];
      if (body.name !== undefined) row.name = String(body.name).trim();
      if (body.position !== undefined) row.position = body.position;
      if (body.archived !== undefined) row.archived_at = body.archived ? now() : null;
      // Move into/out of a Folder: omitted key = unchanged, null = Space root, id = that Folder.
      // Mirrors the router's own same-Space validation (TASK_FOLDER_CROSS_SPACE, 422) and its
      // exact `!== undefined` presence check — parseBody() below turns a truly absent JSON key
      // into `undefined` on access, same as Express does server-side.
      if (body.folderId !== undefined) {
        if (body.folderId === null) {
          row.folder_id = null;
        } else {
          const folder = s.folders.find((f) => f.id === body.folderId);
          if (!folder) return [404, fail('TASK_NOT_FOUND', 'Folder not found.')];
          if (folder.space_id !== row.space_id) {
            return [422, fail('TASK_FOLDER_CROSS_SPACE', 'That folder belongs to a different Space and cannot be used here.')];
          }
          row.folder_id = folder.id;
        }
      }
      row.version += 1;
      return [200, ok(row)];
    }
  }

  // ---- Task collection --------------------------------------------------
  if (method === 'GET' && seg.length === 0) {
    let rows = [...s.tasks];
    if (q.get('rootOnly') === 'true') rows = rows.filter((t) => t.parent_task_id === null);
    const listId = q.get('listId');
    if (listId) rows = rows.filter((t) => t.list_id === listId);
    const statusId = q.get('statusId');
    if (statusId) rows = rows.filter((t) => t.status_id === statusId);
    const priority = q.get('priority');
    if (priority) rows = rows.filter((t) => t.priority === priority);
    const search = q.get('q');
    if (search) rows = rows.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()));
    const dueBefore = q.get('dueBefore');
    if (dueBefore) rows = rows.filter((t) => t.due_date && t.due_date <= dueBefore);
    if (q.get('includeArchived') !== 'true') rows = rows.filter((t) => !t.archived_at);

    const rawSort = q.get('sort') ?? 'position';
    const desc = rawSort.startsWith('-');
    const col = desc ? rawSort.slice(1) : rawSort;
    rows.sort((a, b) => {
      const av = a[col] ?? '', bv = b[col] ?? '';
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * (desc ? -1 : 1);
    });

    const total = rows.length;
    const pageNum = Math.max(1, Number(q.get('page') ?? 1));
    const pageSize = Math.max(1, Number(q.get('pageSize') ?? 50));
    const start = (pageNum - 1) * pageSize;
    return [200, ok(rows.slice(start, start + pageSize),
      { page: { page: pageNum, pageSize, total } })];
  }

  if (method === 'POST' && seg.length === 0) {
    const title = String(body.title ?? '').trim();
    if (!title) return [400, fail('TASK_VALIDATION_FAILED', 'title is required.')];
    const created = {
      id: `task-new-${s.tasks.length + 1}`,
      list_id: body.listId ?? F.LIST_A,
      status_id: body.statusId ?? F.STATUS_TODO,
      parent_task_id: body.parentTaskId ?? null,
      title, description: body.description ?? null,
      priority: body.priority ?? 'normal',
      start_date: body.startDate ?? null, due_date: body.dueDate ?? null,
      time_estimate_seconds: body.timeEstimateSeconds ?? null,
      position: 9000, version: 1, archived_at: null,
      created_by: F.ACTOR_ME, updated_by: F.ACTOR_ME,
      created_at: now(), updated_at: now(),
      assigneeActorIds: [], subtaskCount: 0
    };
    s.tasks.push(created);
    if (created.parent_task_id) {
      const p = s.tasks.find((x) => x.id === created.parent_task_id);
      if (p) p.subtaskCount = (p.subtaskCount ?? 0) + 1;
    }
    return [201, ok(created)];
  }

  // ---- Single task ------------------------------------------------------
  const id = seg[0];
  const t = s.tasks.find((x) => x.id === id);

  if (seg[1] === 'activity' && method === 'GET') {
    return [200, ok([
      { id: 'act-2', actor_id: F.ACTOR_ME, entity_type: 'task', action: 'TASK_UPDATED',
        detail: { field: 'status' }, created_at: '2026-08-10T12:00:00.000Z' },
      { id: 'act-1', actor_id: F.ACTOR_OTHER, entity_type: 'task', action: 'TASK_CREATED',
        detail: {}, created_at: '2026-08-01T10:00:00.000Z' }
    ])];
  }
  if (seg[1] === 'time-entries' && method === 'GET') {
    if (s.caps.timeVisibility === 'aggregate_only') {
      return [200, ok({ entries: [], visibility: 'aggregate_only' })];
    }
    return [200, ok({
      entries: [{
        id: 'entry-1', task_id: id, actor_id: F.ACTOR_ME,
        started_at: '2026-08-02T09:00:00.000Z', ended_at: '2026-08-02T10:30:00.000Z',
        source: 'manual', note: 'Site visit', archived_at: null
      }],
      visibility: s.caps.timeVisibility
    })];
  }
  if (seg[1] === 'assignees' && method === 'PUT') {
    if (!t) return [404, fail('TASK_NOT_FOUND', 'Task not found.')];
    t.assigneeActorIds = body.actorIds ?? [];
    return [200, ok({ taskId: id, assigneeActorIds: t.assigneeActorIds })];
  }
  if ((seg[1] === 'archive' || seg[1] === 'restore') && method === 'POST') {
    if (!t) return [404, fail('TASK_NOT_FOUND', 'Task not found.')];
    if (body.version !== undefined && body.version !== t.version) {
      return [409, fail('TASK_VERSION_CONFLICT',
        'This task changed since you loaded it. Reload and try again.')];
    }
    t.archived_at = seg[1] === 'archive' ? now() : null;
    t.version += 1;
    return [200, ok(t)];
  }

  if (method === 'GET' && seg.length === 1) {
    if (!t) return [404, fail('TASK_NOT_FOUND', 'Task not found.')];
    const subtasks = s.tasks.filter((x) => x.parent_task_id === id);
    return [200, ok({ ...t, subtasks })];
  }
  if (method === 'PATCH' && seg.length === 1) {
    if (!t) return [404, fail('TASK_NOT_FOUND', 'Task not found.')];
    if (body.version !== undefined && body.version !== t.version) {
      return [409, fail('TASK_VERSION_CONFLICT',
        'This task changed since you loaded it. Reload and try again.')];
    }
    if (body.title !== undefined && !String(body.title).trim()) {
      return [400, fail('TASK_VALIDATION_FAILED', 'title is required.')];
    }
    if (body.title !== undefined) t.title = String(body.title).trim();
    if (body.description !== undefined) t.description = body.description;
    if (body.statusId !== undefined) t.status_id = body.statusId;
    if (body.listId !== undefined) t.list_id = body.listId;
    if (body.priority !== undefined) t.priority = body.priority;
    if (body.dueDate !== undefined) t.due_date = body.dueDate;
    t.version += 1;
    t.updated_at = now();
    return [200, ok(t)];
  }

  return null;
}

/** Seed a fake session token so SaaSAuthLayer renders the cockpit without a real login. */
export async function bootApp(page: Page) {
  await page.addInitScript((tok) => {
    try { window.localStorage.setItem('saas_token', tok as string); } catch { /* ignore */ }
  }, F.FAKE_TOKEN);
  await page.goto('/');
}

/**
 * Open the app shell's navigation and return the requested nav button, ready to click.
 *
 * Below the app's `md` breakpoint the whole shell sidebar is off-canvas: the nav item is laid
 * out but sits outside the viewport until the hamburger opens it. Opening it first is what a
 * real narrow-viewport user does, and it keeps every nav assertion usable at every width.
 */
export async function appNav(page: Page, id: string) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  const nav = page.locator(`#nav-btn-${id}`);
  await expect(nav).toBeVisible();
  return nav;
}

/** Navigate to the Task Management tab and wait for its first load. */
export async function openTaskManagement(page: Page) {
  const nav = await appNav(page, 'task-management');
  await nav.click();
  await expect(page.locator('#task-management-view, [role="alert"]').first()).toBeVisible();
}

/**
 * The Spaces/Lists navigation as the current viewport actually presents it.
 *
 * On `lg` and up it is an inline sidebar. Below that it lives only in a drawer, so this opens
 * the drawer first. Tests then read the same way at every width instead of being desktop-only.
 */
export async function spacesNav(page: Page) {
  const inline = page.getByRole('navigation', { name: 'Spaces and Lists' });
  if (await inline.first().isVisible().catch(() => false)) return inline.first();

  const opener = page.getByRole('button', { name: 'Open Spaces and Lists' });
  await expect(opener).toBeVisible();
  await opener.click();
  const drawer = page.getByRole('dialog', { name: 'Spaces and Lists' });
  await expect(drawer).toBeVisible();
  return drawer.getByRole('navigation', { name: 'Spaces and Lists' });
}

/**
 * One task as the current viewport presents it: a table row on `md` and up, a card below.
 *
 * `filter({ visible: true })` is what makes this width-agnostic — both presentations are in
 * the DOM at all times and CSS decides which one a user can actually see and operate.
 */
export function taskItem(page: Page, title: string) {
  return page.locator('table tbody tr, ul > li')
    .filter({ hasText: title })
    .filter({ visible: true })
    .first();
}

/** Every task the current viewport actually shows. */
export function taskItems(page: Page) {
  return page.locator('table tbody tr, .md\\:hidden > li').filter({ visible: true });
}
