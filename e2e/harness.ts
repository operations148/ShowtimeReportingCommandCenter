import { test as base, expect, type Page, type Route } from '@playwright/test';
import * as F from './fixtures';
import { STATUS_TEMPLATES, findStatusTemplate, planStatusTemplate } from '../src/tasks/statusTemplates';
// The harness uses the SHIPPED cursor logic, so it cannot drift from the microsecond-exact
// implementation the router relies on.
import {
  encodeCursor, decodeCursor, compareCursor, cursorOf,
  trimToStrictlyAfter, trimToStrictlyBefore
} from '../src/tasks/channels';

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
  /** Backs GET /time/summary and GET /:id/time-entries so both derive from the SAME data —
   *  starting/stopping a timer, adding a manual entry, or archiving one all mutate this array,
   *  and every reader recomputes from it. A prior version of this harness returned a static
   *  canned summary regardless of what the timer/manual-entry routes did, which could never
   *  have caught the List-row staleness bug this fixture now exists to test. */
  timeEntries: any[];
  channels: any[];
  channelMessages: any[];
  channelReads: Map<string, string>;
  channelMembers: Map<string, string[]>;
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
    statuses?: any[];
    timeEntries?: any[];
    channels?: any[];
    channelMessages?: any[];
  } = {}
): Promise<Harness> {
  const role = opts.role ?? 'ADMIN';

  const state: ApiState = {
    role,
    caps: { ...F.capabilitiesFor(role), ...(opts.caps ?? {}) },
    tasks: JSON.parse(JSON.stringify(opts.tasks ?? F.tasks)),
    statuses: JSON.parse(JSON.stringify(opts.statuses ?? F.statuses)),
    channels: JSON.parse(JSON.stringify(opts.channels ?? F.channels)),
    channelMessages: JSON.parse(JSON.stringify(opts.channelMessages ?? F.channelMessages)),
    channelReads: new Map<string, string>(),
    channelMembers: new Map<string, string[]>(),
    lists: JSON.parse(JSON.stringify(opts.lists ?? F.lists)),
    spaces: JSON.parse(JSON.stringify(opts.spaces ?? F.spaces)),
    folders: JSON.parse(JSON.stringify(opts.folders ?? F.folders)),
    activeTimer: null,
    timeEntries: JSON.parse(JSON.stringify(opts.timeEntries ?? [{
      id: 'entry-1', task_id: F.TASK_1, actor_id: F.ACTOR_ME,
      started_at: '2026-08-02T09:00:00.000Z', ended_at: '2026-08-02T10:30:00.000Z',
      source: 'manual', note: 'Site visit', archived_at: null
    }])),
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
      capabilities: s.caps,
      // The server's clock, used by the client to judge the edit window.
      serverTime: '2026-08-31T14:12:40.000000+00:00'
    })];
  }

  if (method === 'GET' && seg[0] === 'actors') return [200, ok(F.actors)];

  // ---- Time summary (must precede the /:id route) -----------------------
  // Mirrors the server's own /time/summary: sums every non-archived entry, using `now` as the
  // end of a still-running one — so a live timer's elapsed-so-far counts here exactly as it
  // does in production, and the numbers this returns are ALWAYS derived from the same
  // s.timeEntries/s.activeTimer that the timer and manual-entry routes below actually mutate.
  if (method === 'GET' && seg[0] === 'time' && seg[1] === 'summary') {
    const live = s.activeTimer
      ? [{ task_id: s.activeTimer.task_id, actor_id: F.ACTOR_ME,
           started_at: s.activeTimer.started_at, ended_at: null }]
      : [];
    const rows = [...s.timeEntries.filter((e) => !e.archived_at), ...live];
    const byTask = new Map<string, number>();
    const byMember = new Map<string, number>();
    for (const e of rows) {
      const end = e.ended_at ? Date.parse(e.ended_at) : Date.now();
      const secs = Math.max(0, Math.floor((end - Date.parse(e.started_at)) / 1000));
      byTask.set(e.task_id, (byTask.get(e.task_id) ?? 0) + secs);
      byMember.set(e.actor_id, (byMember.get(e.actor_id) ?? 0) + secs);
    }
    return [200, ok({
      byTask: [...byTask].map(([taskId, trackedSeconds]) => ({ taskId, trackedSeconds })),
      byMember: s.caps.timeVisibility === 'team'
        ? [...byMember].map(([actorId, trackedSeconds]) => ({ actorId, trackedSeconds })) : [],
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
      const endedAt = now();
      // Real elapsed from started_at (which a test may have backdated), not a fixed constant —
      // so a test can assert an exact, deterministic tracked duration after stopping without
      // waiting in wall-clock time, and the entry recorded here is the SAME one /time/summary
      // and GET /:id/time-entries subsequently read.
      const durationSeconds =
        Math.max(0, Math.floor((Date.parse(endedAt) - Date.parse(stopped.started_at)) / 1000));
      s.timeEntries.push({
        id: stopped.id, task_id: stopped.task_id, actor_id: F.ACTOR_ME,
        started_at: stopped.started_at, ended_at: endedAt, source: 'timer',
        note: null, archived_at: null
      });
      return [200, ok({
        entryId: stopped.id, taskId: stopped.task_id, startedAt: stopped.started_at,
        endedAt, durationSeconds, outcome: 'stopped'
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
    const created = {
      id: `entry-manual-${s.timeEntries.length + 1}`, task_id: body.taskId, actor_id: F.ACTOR_ME,
      started_at: body.startedAt, ended_at: body.endedAt,
      source: 'manual', note: body.note ?? null, archived_at: null
    };
    s.timeEntries.push(created);
    return [201, ok(created)];
  }

  // ---- Time entry edit / archive (restore) -------------------------------
  if (seg[0] === 'time-entries' && seg[1] && method === 'PATCH') {
    const entry = s.timeEntries.find((e) => e.id === seg[1]);
    if (!entry) return [404, fail('TASK_NOT_FOUND', 'Time entry not found.')];
    if (body.note !== undefined) entry.note = body.note;
    if (body.startedAt !== undefined) entry.started_at = body.startedAt;
    if (body.endedAt !== undefined) entry.ended_at = body.endedAt;
    if (body.archived === true) entry.archived_at = now();
    if (body.archived === false) entry.archived_at = null;
    return [200, ok(entry)];
  }

  // ---- Statuses ---------------------------------------------------------
  if (seg[0] === 'statuses') {
    // Template routes are matched BEFORE the generic /statuses/:id handling below, exactly as
    // the real router registers them as static paths.
    if (method === 'GET' && seg[1] === 'templates') {
      return [200, ok(STATUS_TEMPLATES.map((t) => ({
        key: t.key, label: t.label, description: t.description, entries: t.entries
      })))];
    }
    if (method === 'POST' && seg[1] === 'template' && (seg[2] === 'preview' || seg[2] === 'apply')) {
      if (!s.caps.canManageHierarchy) {
        return [403, fail('TASK_FORBIDDEN', 'Only a manager can change statuses.')];
      }
      const spaceId = body.spaceId ?? F.SPACE_A;
      const tpl = findStatusTemplate(body.template ?? 'operations');
      if (!tpl) return [400, fail('TASK_VALIDATION_FAILED', 'Unknown status template.')];

      const inSpace = () => s.statuses.filter((x) => x.space_id === spaceId);
      const counts = new Map<string, number>();
      for (const st of inSpace()) {
        counts.set(st.id, s.tasks.filter((t) => t.status_id === st.id).length);
      }
      // Planned from the SAME shared module the server uses, so the harness cannot drift from
      // the real plan — only the persistence below is simulated.
      const plan = planStatusTemplate(inSpace() as any, tpl, counts);

      if (seg[2] === 'preview') return [200, ok({ dryRun: true, ...plan })];

      for (const item of plan.items) {
        if (item.action === 'create') {
          s.statuses.push({
            id: `status-tpl-${s.statuses.length + 1}`, space_id: spaceId, name: item.name,
            category: item.category, color: item.color, position: item.position,
            is_default: false, version: 1, archived_at: null
          });
        } else if (item.action === 'reuse' && item.statusId) {
          const row = s.statuses.find((x) => x.id === item.statusId);
          if (row) { row.position = item.position; row.archived_at = null; row.version += 1; }
        }
        // `keep` writes nothing at all — the guarantee the tests pin.
      }
      s.statuses.sort((a, b) => a.position - b.position);
      return [200, ok({ applied: true, plan, statuses: inSpace() })];
    }
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

  // ---- Channels ---------------------------------------------------------
  // Mirrors src/tasks/channelsRouter.ts: same paths, same envelope, same error codes, and
  // the same fail-closed flag check ahead of everything else.
  if (seg[0] === 'channels') {
    if (!s.caps.channelsEnabled) {
      return [403, fail('TASK_CHANNELS_DISABLED', 'Channels are not enabled.')];
    }

    const visible = () => s.channels.filter((c: any) =>
      c.visibility !== 'restricted' ||
      s.caps.canManageChannels ||
      (s.channelMembers.get(c.id) ?? []).includes(F.ACTOR_ME));

    const unreadFor = (c: any) => {
      const since = s.channelReads.get(c.id);
      return s.channelMessages.filter((m: any) =>
        m.channel_id === c.id && !m.deleted_at && m.author_actor_id !== F.ACTOR_ME &&
        (!since || m.created_at > since)).length;
    };

    // GET /channels/unread — registered before /:channelId, as in the router.
    if (method === 'GET' && seg[1] === 'unread') {
      return [200, ok(visible().map((c: any) => ({
        channelId: c.id, unreadCount: unreadFor(c),
        lastReadAt: s.channelReads.get(c.id) ?? null
      })))];
    }

    if (method === 'GET' && seg.length === 1) {
      const includeArchived = q.get('includeArchived') === 'true';
      const rows = visible()
        .filter((c: any) => includeArchived || !c.archived_at)
        .sort((a: any, b: any) => a.position - b.position)
        .map((c: any) => ({
          ...c, unreadCount: unreadFor(c),
          lastReadAt: s.channelReads.get(c.id) ?? null
        }));
      return [200, ok(rows)];
    }

    if (method === 'POST' && seg.length === 1) {
      if (!s.caps.canManageChannels) {
        return [403, fail('TASK_FORBIDDEN', 'Only a manager can create channels.')];
      }
      const name = String(body.name ?? '').trim();
      if (!name) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (s.channels.some((c: any) => c.slug === slug && !c.archived_at)) {
        return [409, fail('TASK_VALIDATION_FAILED',
          'A channel with that name already exists in this workspace.')];
      }
      const created = {
        id: `channel-new-${s.channels.length + 1}`, space_id: body.spaceId ?? null,
        name, slug, description: body.description ?? null,
        visibility: body.visibility ?? 'workspace',
        position: (s.channels.length + 1) * 1000, version: 1, archived_at: null,
        created_at: '2026-08-31T14:13:00.000000+00:00',
        updated_at: '2026-08-31T14:13:00.000000+00:00'
      };
      s.channels.push(created);
      return [201, ok(created)];
    }

    const channelId = seg[1];
    const channel = s.channels.find((c: any) => c.id === channelId);
    if (!channel) return [404, fail('TASK_NOT_FOUND', 'Channel not found.')];
    if (channel.visibility === 'restricted' && !s.caps.canManageChannels &&
        !(s.channelMembers.get(channel.id) ?? []).includes(F.ACTOR_ME)) {
      return [403, fail('TASK_CHANNEL_FORBIDDEN', 'You do not have access to this channel.')];
    }

    if (method === 'PATCH' && seg.length === 2) {
      if (!s.caps.canManageChannels) {
        return [403, fail('TASK_FORBIDDEN', 'Only a manager can manage channels.')];
      }
      if (body.name !== undefined) {
        const n = String(body.name).trim();
        if (!n) return [400, fail('TASK_VALIDATION_FAILED', 'name is required.')];
        channel.name = n;
        channel.slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      }
      if (body.description !== undefined) channel.description = body.description;
      if (body.visibility !== undefined) channel.visibility = body.visibility;
      if (body.spaceId !== undefined) channel.space_id = body.spaceId;
      if (body.archived === true) channel.archived_at = '2026-08-31T16:00:00.000000+00:00';
      if (body.archived === false) channel.archived_at = null;
      channel.version += 1;
      return [200, ok(channel)];
    }

    if (method === 'PUT' && seg[2] === 'members') {
      if (!s.caps.canManageChannels) {
        return [403, fail('TASK_FORBIDDEN', 'Only a manager can manage channels.')];
      }
      const members = Array.isArray(body.members) ? body.members : [];
      s.channelMembers.set(channel.id, members.map((m: any) => m.actorId));
      return [200, ok({ channelId: channel.id, members })];
    }

    if (seg[2] === 'read' && method === 'POST') {
      const mid = body.lastReadMessageId;
      // The server resolves the timestamp from the MESSAGE, never from the client.
      const m = mid
        ? s.channelMessages.find((x: any) => x.id === mid && x.channel_id === channel.id)
        : [...s.channelMessages].filter((x: any) => x.channel_id === channel.id).pop();
      if (!m) return [200, ok({ channelId: channel.id, lastReadAt: null,
        lastReadMessageId: null, unreadCount: 0 })];
      s.channelReads.set(channel.id, m.created_at);
      return [200, ok({ channelId: channel.id, lastReadAt: m.created_at,
        lastReadMessageId: m.id, unreadCount: 0 })];
    }

    if (seg[2] === 'messages') {
      const present = (m: any) => ({
        id: m.id, channelId: m.channel_id,
        authorActorId: m.deleted_at ? null : m.author_actor_id,
        body: m.deleted_at ? null : m.body,
        parentMessageId: m.parent_message_id,
        editedAt: m.edited_at, deletedAt: m.deleted_at,
        createdAt: m.created_at, updatedAt: m.updated_at,
        cursor: encodeCursor({ createdAt: m.created_at, id: m.id })
      });

      if (method === 'GET') {
        const limit = Math.min(Number(q.get('limit') ?? 50), 100);
        const all = s.channelMessages
          .filter((m: any) => m.channel_id === channel.id)
          .sort((a: any, b: any) =>
            compareCursor(cursorOf(a) as any, cursorOf(b) as any));
        const after = q.get('after') ? decodeCursor(q.get('after'), 'after') : null;
        const before = q.get('before') ? decodeCursor(q.get('before'), 'before') : null;

        let rows: any[];
        let hasMoreBefore = false;
        if (after) {
          rows = trimToStrictlyAfter(all as any, after).slice(0, limit);
        } else if (before) {
          const t = trimToStrictlyBefore(all as any, before);
          hasMoreBefore = t.length > limit;
          rows = t.slice(-limit);
        } else {
          hasMoreBefore = all.length > limit;
          rows = all.slice(-limit);
        }
        const out = rows.map(present);
        return [200, ok(out, {
          page: {
            limit,
            nextAfter: out.length ? out[out.length - 1].cursor
              : (after ? encodeCursor(after) : null),
            nextBefore: out.length ? out[0].cursor
              : (before ? encodeCursor(before) : null),
            hasMoreBefore
          }
        })];
      }

      if (method === 'POST') {
        if (!s.caps.canPostMessages) {
          return [403, fail('TASK_FORBIDDEN', 'Your role cannot post messages.')];
        }
        if (channel.archived_at) {
          return [409, fail('TASK_CHANNEL_ARCHIVED', 'This channel is archived.')];
        }
        const text = String(body.body ?? '').trim();
        if (!text) return [400, fail('TASK_VALIDATION_FAILED', 'Message body cannot be empty.')];
        // Idempotency: the same token from the same author returns the ORIGINAL message.
        const dup = body.clientToken && s.channelMessages.find(
          (m: any) => m.client_token === body.clientToken &&
            m.channel_id === channel.id && m.author_actor_id === F.ACTOR_ME);
        if (dup) return [200, ok(present(dup), { outcome: 'duplicate' })];

        const n = s.channelMessages.length + 1;
        const created = {
          id: `msg-new-${n}`, channel_id: channel.id, author_actor_id: F.ACTOR_ME,
          body: text, parent_message_id: body.parentMessageId ?? null,
          client_token: body.clientToken ?? null,
          edited_at: null, deleted_at: null,
          // Server-generated, microsecond precision, strictly after the fixtures.
          created_at: `2026-08-31T14:20:0${n}.${String(n).padStart(6, '0')}+00:00`,
          updated_at: `2026-08-31T14:20:0${n}.${String(n).padStart(6, '0')}+00:00`
        };
        s.channelMessages.push(created);
        return [201, ok(present(created), { outcome: 'created' })];
      }

      const messageId = seg[3];
      const msg = s.channelMessages.find(
        (m: any) => m.id === messageId && m.channel_id === channel.id);
      if (!msg) return [404, fail('TASK_NOT_FOUND', 'Message not found.')];

      if (method === 'PATCH') {
        if (msg.deleted_at) return [409, fail('TASK_MESSAGE_DELETED', 'That message has been deleted.')];
        if (msg.author_actor_id !== F.ACTOR_ME) {
          return [403, fail('TASK_FORBIDDEN', 'You can only edit your own messages.')];
        }
        msg.body = String(body.body ?? '').trim();
        msg.edited_at = '2026-08-31T14:30:00.000000+00:00';
        return [200, ok(present(msg))];
      }

      if (method === 'DELETE') {
        const mine = msg.author_actor_id === F.ACTOR_ME;
        if (!mine && !s.caps.canManageChannels) {
          return [403, fail('TASK_FORBIDDEN', 'You can only delete your own messages.')];
        }
        if (msg.deleted_at) return [200, ok(present(msg), { outcome: 'already_deleted' })];
        msg.deleted_at = '2026-08-31T14:35:00.000000+00:00';
        return [200, ok(present(msg), { outcome: mine ? 'deleted' : 'moderated' })];
      }
    }

    return [405, fail('TASK_VALIDATION_FAILED', 'Unsupported channel operation.')];
  }

  // ---- Task collection --------------------------------------------------
  if (method === 'GET' && seg.length === 0) {
    // ONE definition of the active query, exactly as the router factors it — so the page
    // total and the per-status group counts can never describe different filter sets.
    const matches = (t: any) => {
      if (q.get('rootOnly') === 'true' && t.parent_task_id !== null) return false;
      const listId = q.get('listId');
      if (listId && t.list_id !== listId) return false;
      const statusId = q.get('statusId');
      if (statusId && t.status_id !== statusId) return false;
      const priority = q.get('priority');
      if (priority && t.priority !== priority) return false;
      const search = q.get('q');
      if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
      const dueBefore = q.get('dueBefore');
      if (dueBefore && !(t.due_date && t.due_date <= dueBefore)) return false;
      // Server-side in the real router too: filtering assignees in the browser made
      // `total` and every group count describe the unfiltered set.
      const assignee = q.get('assigneeActorId');
      if (assignee && !(t.assigneeActorIds ?? []).includes(assignee)) return false;
      if (q.get('includeArchived') !== 'true' && t.archived_at) return false;
      return true;
    };

    const rows = s.tasks.filter(matches);

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

    // Per-status totals across the WHOLE filtered set, not the page — same contract as the
    // router's groupBy=status fan-out.
    const extra: Record<string, unknown> = { page: { page: pageNum, pageSize, total } };
    if (q.get('groupBy') === 'status') {
      const spaceId = q.get('spaceId');
      extra.groups = s.statuses
        .filter((st) => !st.archived_at && (!spaceId || st.space_id === spaceId))
        .sort((a, b) => a.position - b.position)
        .map((st) => ({
          statusId: st.id,
          total: rows.filter((t) => t.status_id === st.id).length
        }));
    }

    return [200, ok(rows.slice(start, start + pageSize), extra)];
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
    const completed = s.timeEntries.filter((e) => e.task_id === id && !e.archived_at);
    const live = s.activeTimer && s.activeTimer.task_id === id
      ? [{ id: s.activeTimer.id, task_id: id, actor_id: F.ACTOR_ME,
           started_at: s.activeTimer.started_at, ended_at: null,
           source: 'timer', note: null, archived_at: null }]
      : [];
    return [200, ok({ entries: [...completed, ...live], visibility: s.caps.timeVisibility })];
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
    // The router accepts `position` (manual ordering inside a status group); the harness
    // silently dropped it, so a reorder round-tripped as a no-op here while working in
    // production. Mirrored now, including the re-sort a position change implies.
    if (body.position !== undefined) {
      t.position = Number(body.position);
      s.tasks.sort((a, b) => a.position - b.position);
    }
    t.version += 1;
    t.updated_at = now();
    return [200, ok(t)];
  }

  return null;
}

/**
 * Seed a fake session token so SaaSAuthLayer renders the cockpit without a real login.
 *
 * Also seeds the List-layout preference to that of a RETURNING user — grouped layout, nothing
 * collapsed, both fixture Spaces already initialised — unless `freshPrefs` is passed.
 *
 * Why: on a Space's first visit the grouped List collapses DONE-category groups by default.
 * That is real, intended behaviour, but it is behaviour about *first visits*, and without this
 * seed every unrelated test (permissions, contrast, reduced motion, archiving) would silently
 * depend on it, since the shared fixture happens to put one of its three tasks in Done. Tests
 * that are actually about the first-visit default opt in with `freshPrefs: true`.
 *
 * The seed is written only when the key is ABSENT, so it re-applies on a fresh context but
 * never overwrites a preference the test itself just set — which is what makes the
 * persistence-across-reload assertions meaningful.
 */
export async function bootApp(page: Page, opts: { freshPrefs?: boolean } = {}) {
  await page.addInitScript((tok) => {
    try { window.localStorage.setItem('saas_token', tok as string); } catch { /* ignore */ }
  }, F.FAKE_TOKEN);

  if (!opts.freshPrefs) {
    await page.addInitScript((spaceIds) => {
      try {
        if (window.localStorage.getItem('taskmgmt:list')) return;
        window.localStorage.setItem('taskmgmt:list', JSON.stringify({
          mode: 'grouped', collapsed: [], initialisedSpaceIds: spaceIds
        }));
      } catch { /* ignore */ }
    }, [F.SPACE_A, F.SPACE_B]);
  }

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
