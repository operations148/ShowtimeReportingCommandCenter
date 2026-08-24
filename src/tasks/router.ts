/**
 * Task Management API router. Mounted ONLY from _api_src/index.ts (decision D2);
 * server.ts is deliberately left untouched and does not serve this module.
 *
 * Invariants enforced on every route:
 *   * The workspace comes from req.workspace.id. A client-supplied workspace_id is rejected.
 *   * Feature flags are checked before any authorization or data access.
 *   * Entitlement policy (D4) runs per operation class: read / timer.stop / mutate.
 *   * Mutations require a resolved principal+actor (D1) or fail 403 TASK_ACTOR_UNRESOLVED.
 *   * Every response is no-store.
 *   * Nothing internal is ever returned: no principal ids, external ids, tokens or raw errors.
 */

import express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { UserRole } from '../types.js';
import {
  ok, fail, handler, TaskError, notFound, invalid, versionConflict, mapDbError, applyNoStore
} from './http.js';
import { isTaskManagementEnabled, isTaskTimeTrackingEnabled } from './config.js';
import { resolveActor, requireResolvedActor, ResolvedActor } from './actors.js';
import {
  assertTaskEntitlement, closeActiveTimersForWorkspace, TaskOperation
} from './entitlement.js';
import * as perm from './permissions.js';
import * as v from './validation.js';

interface Ctx {
  workspaceId: string;
  role: UserRole;
  actor: ResolvedActor | null;
}

/** Columns safe to return to a browser. Excludes principal ids and other internals. */
const TASK_COLUMNS =
  'id, list_id, status_id, parent_task_id, title, description, priority, start_date, due_date,' +
  ' time_estimate_seconds, position, version, archived_at, created_by, updated_by,' +
  ' created_at, updated_at';

/**
 * Wraps a handler with the full guard chain. `operation` selects the entitlement policy.
 */
function guard(
  operation: TaskOperation,
  fn: (req: any, res: any, ctx: Ctx) => Promise<void>,
  opts: { requiresTimeTracking?: boolean } = {}
) {
  return handler(async (req: any, res: any) => {
    if (!isTaskManagementEnabled()) {
      throw new TaskError(403, 'TASK_MODULE_DISABLED', 'Task Management is not enabled.');
    }
    if (opts.requiresTimeTracking && !isTaskTimeTrackingEnabled()) {
      throw new TaskError(403, 'TASK_TIME_TRACKING_DISABLED', 'Time tracking is not enabled.');
    }
    v.rejectClientWorkspaceId(req.body, req.query);

    assertTaskEntitlement(req.entitlement, req.role, operation);

    // Authoritative cutoff: the moment we observe a lapsed workspace, close any timer still
    // running so it cannot accrue indefinitely. Idempotent and non-fatal.
    if (req.entitlement && !req.entitlement.hasAccess &&
        req.entitlement.accessStatus !== 'SUSPENDED') {
      await closeActiveTimersForWorkspace(req.workspace.id, 'entitlement_expired');
    }

    const actor = await resolveActor(req);
    if (operation !== 'read') requireResolvedActor(actor);

    await fn(req, res, { workspaceId: req.workspace.id, role: req.role, actor });
  });
}

/** Records a safe, non-sensitive activity event. Never fatal. */
async function recordActivity(
  ctx: Ctx, entityType: string, entityId: string, action: string, detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    await supabaseAdmin.from('task_activity_events').insert({
      workspace_id: ctx.workspaceId,
      actor_id: ctx.actor?.actorId ?? null,
      entity_type: entityType,
      entity_id: entityId,
      action,
      detail
    });
  } catch (err: any) {
    console.error('[tasks] activity write failed', { action, message: err?.message });
  }
}

/** Loads a task scoped to the workspace, or throws 404. */
async function loadTask(ctx: Ctx, taskId: string) {
  const { data, error } = await supabaseAdmin
    .from('task_items').select(TASK_COLUMNS)
    .eq('workspace_id', ctx.workspaceId).eq('id', taskId).maybeSingle();
  if (error) throw mapDbError(error, 'load task');
  if (!data) throw notFound('Task');
  return data as any;
}

/** Current assignee actor ids for a task — read fresh, never trusted from the request. */
async function loadAssigneeIds(ctx: Ctx, taskId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('task_assignments').select('actor_id')
    .eq('workspace_id', ctx.workspaceId).eq('task_id', taskId);
  if (error) throw mapDbError(error, 'load assignees');
  return (data || []).map((r: any) => r.actor_id);
}

export function createTaskRouter(): express.Router {
  const router = express.Router();

  // Defence in depth: even if a route forgets, nothing from this module is cacheable.
  router.use((_req, res, next) => { applyNoStore(res); next(); });

  // ── Bootstrap ───────────────────────────────────────────────────────────────────────
  // One call returns the whole navigable hierarchy plus the caller's live timer, so the UI
  // does not issue a request per Space/List (N+1) on load.
  router.get('/bootstrap', guard('read', async (_req, res, ctx) => {
    const [spaces, lists, statuses] = await Promise.all([
      supabaseAdmin.from('task_spaces')
        .select('id, name, position, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position'),
      supabaseAdmin.from('task_lists')
        .select('id, space_id, name, position, is_default, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position'),
      supabaseAdmin.from('task_statuses')
        .select('id, space_id, name, category, color, position, is_default, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position')
    ]);
    for (const r of [spaces, lists, statuses]) {
      if (r.error) throw mapDbError(r.error, 'bootstrap');
    }

    let activeTimer: any = null;
    if (isTaskTimeTrackingEnabled() && ctx.actor) {
      const { data } = await supabaseAdmin
        .from('task_time_entries')
        .select('id, task_id, started_at')
        .eq('principal_id', ctx.actor.principalId).is('ended_at', null).maybeSingle();
      activeTimer = data ?? null;
    }

    ok(res, {
      spaces: spaces.data ?? [],
      lists: lists.data ?? [],
      statuses: statuses.data ?? [],
      activeTimer,
      capabilities: {
        canManageHierarchy: perm.isManager(ctx.role),
        canCreateTask: perm.isManager(ctx.role) || perm.isContributor(ctx.role),
        canAssignOthers: perm.isManager(ctx.role),
        timeVisibility: perm.timeVisibilityFor(ctx.role),
        timeTrackingEnabled: isTaskTimeTrackingEnabled(),
        actorResolved: ctx.actor !== null
      }
    });
  }));

  // ── Spaces ──────────────────────────────────────────────────────────────────────────
  router.post('/spaces', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const name = v.requireString(req.body?.name, 'name', 1, 120);
    const actor = requireResolvedActor(ctx.actor);

    // Atomic: Space + default "General" List + default statuses + ordering, in one txn.
    const { data, error } = await supabaseAdmin.rpc('task_create_space', {
      p_workspace_id: ctx.workspaceId, p_name: name, p_actor_id: actor.actorId
    });
    if (error) throw mapDbError(error, 'create space');
    const row = Array.isArray(data) ? data[0] : data;
    await recordActivity(ctx, 'space', row.space_id, 'SPACE_CREATED', { name });
    ok(res, { spaceId: row.space_id, defaultListId: row.list_id });
  }));

  router.patch('/spaces/:id', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const id = v.requireUuid(req.params.id, 'id');
    const version = v.requireVersion(req.body?.version);
    const actor = requireResolvedActor(ctx.actor);

    const patch: Record<string, unknown> = { updated_by: actor.actorId, version: version + 1 };
    if (req.body?.name !== undefined) patch.name = v.requireString(req.body.name, 'name', 1, 120);
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;

    const { data, error } = await supabaseAdmin.from('task_spaces')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select('id, name, position, version, archived_at');
    if (error) throw mapDbError(error, 'update space');
    if (!data || data.length === 0) {
      // Either the row is gone or someone else changed it first.
      const { data: exists } = await supabaseAdmin.from('task_spaces')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
      throw exists ? versionConflict() : notFound('Space');
    }
    await recordActivity(ctx, 'space', id, 'SPACE_UPDATED');
    ok(res, data[0]);
  }));

  // ── Lists ───────────────────────────────────────────────────────────────────────────
  router.post('/lists', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const name = v.requireString(req.body?.name, 'name', 1, 120);
    const actor = requireResolvedActor(ctx.actor);

    const { data, error } = await supabaseAdmin.from('task_lists')
      .insert({
        workspace_id: ctx.workspaceId, space_id: spaceId, name,
        position: Number(req.body?.position ?? 1000),
        created_by: actor.actorId, updated_by: actor.actorId
      })
      .select('id, space_id, name, position, is_default, version, archived_at').single();
    if (error) throw mapDbError(error, 'create list');
    await recordActivity(ctx, 'list', data.id, 'LIST_CREATED', { name });
    ok(res, data);
  }));

  router.patch('/lists/:id', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const id = v.requireUuid(req.params.id, 'id');
    const version = v.requireVersion(req.body?.version);
    const actor = requireResolvedActor(ctx.actor);

    const patch: Record<string, unknown> = { updated_by: actor.actorId, version: version + 1 };
    if (req.body?.name !== undefined) patch.name = v.requireString(req.body.name, 'name', 1, 120);
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;

    const { data, error } = await supabaseAdmin.from('task_lists')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select('id, space_id, name, position, is_default, version, archived_at');
    if (error) throw mapDbError(error, 'update list');
    if (!data || data.length === 0) {
      const { data: exists } = await supabaseAdmin.from('task_lists')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
      throw exists ? versionConflict() : notFound('List');
    }
    await recordActivity(ctx, 'list', id, 'LIST_UPDATED');
    ok(res, data[0]);
  }));

  // ── Statuses ────────────────────────────────────────────────────────────────────────
  router.get('/statuses', guard('read', async (req, res, ctx) => {
    const spaceId = v.requireUuid(req.query?.spaceId, 'spaceId');
    const { data, error } = await supabaseAdmin.from('task_statuses')
      .select('id, space_id, name, category, color, position, is_default, version, archived_at')
      .eq('workspace_id', ctx.workspaceId).eq('space_id', spaceId).order('position');
    if (error) throw mapDbError(error, 'list statuses');
    ok(res, data ?? []);
  }));

  router.post('/statuses', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const name = v.requireString(req.body?.name, 'name', 1, 60);
    const category = v.requireEnum(req.body?.category, 'category', v.STATUS_CATEGORIES);
    const color = v.optionalString(req.body?.color, 'color', 7);

    const { data, error } = await supabaseAdmin.from('task_statuses')
      .insert({
        workspace_id: ctx.workspaceId, space_id: spaceId, name, category, color,
        position: Number(req.body?.position ?? 1000)
      })
      .select('id, space_id, name, category, color, position, is_default, version').single();
    if (error) throw mapDbError(error, 'create status');
    await recordActivity(ctx, 'status', data.id, 'STATUS_CREATED', { name, category });
    ok(res, data);
  }));

  router.patch('/statuses/:id', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const id = v.requireUuid(req.params.id, 'id');
    const version = v.requireVersion(req.body?.version);

    const patch: Record<string, unknown> = { version: version + 1 };
    if (req.body?.name !== undefined) patch.name = v.requireString(req.body.name, 'name', 1, 60);
    if (req.body?.category !== undefined) {
      patch.category = v.requireEnum(req.body.category, 'category', v.STATUS_CATEGORIES);
    }
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;

    const { data, error } = await supabaseAdmin.from('task_statuses')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select('id, space_id, name, category, color, position, version, archived_at');
    if (error) throw mapDbError(error, 'update status');
    if (!data || data.length === 0) {
      const { data: exists } = await supabaseAdmin.from('task_statuses')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
      throw exists ? versionConflict() : notFound('Status');
    }
    ok(res, data[0]);
  }));

  // ── Timer (static paths BEFORE /:id so they are not captured as a task id) ──────────
  router.get('/timer/active', guard('read', async (_req, res, ctx) => {
    if (!isTaskTimeTrackingEnabled()) return ok(res, { activeTimer: null });
    if (!ctx.actor) return ok(res, { activeTimer: null });
    // Recovery is keyed on the GLOBAL principal, so the timer survives refresh, logout,
    // re-login and workspace switching — it is not tied to a browser session.
    const { data, error } = await supabaseAdmin.from('task_time_entries')
      .select('id, task_id, workspace_id, started_at')
      .eq('principal_id', ctx.actor.principalId).is('ended_at', null).maybeSingle();
    if (error) throw mapDbError(error, 'active timer');
    ok(res, { activeTimer: data ?? null, serverTime: new Date().toISOString() });
  }));

  router.post('/timer/start', guard('mutate', async (req, res, ctx) => {
    perm.assertCanTrackTime(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const taskId = v.requireUuid(req.body?.taskId, 'taskId');
    const clientToken = v.optionalUuid(req.body?.clientToken, 'clientToken');

    const { data, error } = await supabaseAdmin.rpc('task_timer_start', {
      p_workspace_id: ctx.workspaceId,
      p_task_id: taskId,
      p_principal_id: actor.principalId,
      p_actor_id: actor.actorId,
      p_client_token: clientToken
    });
    if (error) throw mapDbError(error, 'timer start');
    const row: any = Array.isArray(data) ? data[0] : data;
    if (!row) throw notFound('Task');

    if (row.outcome === 'conflict_other_task') {
      // 409 with only the caller's own timer info — never anything about another tenant.
      return fail(res, 409, 'TASK_TIMER_CONFLICT',
        'A timer is already running on a different task.', {
          data: { entryId: row.entry_id, taskId: row.task_id, startedAt: row.started_at },
          serverTime: new Date().toISOString()
        });
    }
    if (row.outcome === 'started') {
      await recordActivity(ctx, 'time_entry', row.entry_id, 'TIMER_STARTED', { taskId });
    }
    ok(res, {
      entryId: row.entry_id, taskId: row.task_id, startedAt: row.started_at,
      outcome: row.outcome, serverTime: new Date().toISOString()
    });
  }, { requiresTimeTracking: true }));

  // Stopping is permitted even for an expired tenant (D4), so it uses the 'timer.stop' class.
  router.post('/timer/stop', guard('timer.stop', async (req, res, ctx) => {
    perm.assertCanTrackTime(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const entryId = v.optionalUuid(req.body?.entryId, 'entryId');

    const { data, error } = await supabaseAdmin.rpc('task_timer_stop', {
      p_workspace_id: ctx.workspaceId,
      p_principal_id: actor.principalId,
      p_entry_id: entryId
    });
    if (error) throw mapDbError(error, 'timer stop');
    const row: any = Array.isArray(data) ? data[0] : data;
    if (!row) throw new TaskError(404, 'TASK_NO_ACTIVE_TIMER', 'No running timer to stop.');
    if (row.outcome === 'stopped') {
      await recordActivity(ctx, 'time_entry', row.entry_id, 'TIMER_STOPPED',
        { taskId: row.task_id, durationSeconds: row.duration_seconds });
    }
    ok(res, {
      entryId: row.entry_id, taskId: row.task_id, startedAt: row.started_at,
      endedAt: row.ended_at, durationSeconds: Number(row.duration_seconds ?? 0),
      outcome: row.outcome
    });
  }, { requiresTimeTracking: true }));

  // ── Manual time entries ─────────────────────────────────────────────────────────────
  router.post('/time-entries', guard('mutate', async (req, res, ctx) => {
    perm.assertCanTrackTime(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const taskId = v.requireUuid(req.body?.taskId, 'taskId');
    const startedAt = v.optionalTimestamp(req.body?.startedAt, 'startedAt');
    const endedAt = v.optionalTimestamp(req.body?.endedAt, 'endedAt');
    const note = v.optionalString(req.body?.note, 'note', 2000);

    if (!startedAt || !endedAt) throw invalid('Manual entries require startedAt and endedAt.');
    if (Date.parse(endedAt) <= Date.parse(startedAt)) {
      throw invalid('endedAt must be after startedAt.');
    }

    const { data, error } = await supabaseAdmin.from('task_time_entries')
      .insert({
        workspace_id: ctx.workspaceId, task_id: taskId,
        principal_id: actor.principalId, actor_id: actor.actorId,
        started_at: startedAt, ended_at: endedAt, source: 'manual', note
      })
      .select('id, task_id, actor_id, started_at, ended_at, source, note').single();
    if (error) throw mapDbError(error, 'create manual entry');
    await recordActivity(ctx, 'time_entry', data.id, 'MANUAL_TIME_ADDED', { taskId });
    ok(res, data);
  }, { requiresTimeTracking: true }));

  router.patch('/time-entries/:id', guard('mutate', async (req, res, ctx) => {
    const actor = requireResolvedActor(ctx.actor);
    const id = v.requireUuid(req.params.id, 'id');

    const { data: entry, error: loadErr } = await supabaseAdmin.from('task_time_entries')
      .select('id, actor_id, started_at, ended_at, source')
      .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
    if (loadErr) throw mapDbError(loadErr, 'load time entry');
    if (!entry) throw notFound('Time entry');
    perm.assertCanMutateTimeEntry(ctx.role, actor.actorId, entry as any);

    const patch: Record<string, unknown> = {};
    if (req.body?.note !== undefined) patch.note = v.optionalString(req.body.note, 'note', 2000);
    if (req.body?.startedAt !== undefined) {
      patch.started_at = v.optionalTimestamp(req.body.startedAt, 'startedAt');
    }
    if (req.body?.endedAt !== undefined) {
      patch.ended_at = v.optionalTimestamp(req.body.endedAt, 'endedAt');
    }
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;
    if (Object.keys(patch).length === 0) throw invalid('No supported fields supplied.');

    const { data, error } = await supabaseAdmin.from('task_time_entries')
      .update(patch).eq('workspace_id', ctx.workspaceId).eq('id', id)
      .select('id, task_id, actor_id, started_at, ended_at, source, note, archived_at').single();
    if (error) throw mapDbError(error, 'update time entry');
    await recordActivity(ctx, 'time_entry', id, 'TIME_ENTRY_UPDATED');
    ok(res, data);
  }, { requiresTimeTracking: true }));

  // ── Time summary (D7 visibility) ────────────────────────────────────────────────────
  router.get('/time/summary', guard('read', async (req, res, ctx) => {
    const visibility = perm.timeVisibilityFor(ctx.role);
    const taskId = v.optionalUuid(req.query?.taskId, 'taskId');

    let q = supabaseAdmin.from('task_time_entries')
      .select('task_id, actor_id, started_at, ended_at')
      .eq('workspace_id', ctx.workspaceId).is('archived_at', null);
    if (taskId) q = q.eq('task_id', taskId);
    // Contributors only ever see their own rows — enforced in the QUERY, not by filtering
    // a wider result set after the fact.
    if (visibility === 'own' && ctx.actor) q = q.eq('actor_id', ctx.actor.actorId);
    if (visibility === 'own' && !ctx.actor) return ok(res, { byTask: [], byMember: [] });

    const { data, error } = await q;
    if (error) throw mapDbError(error, 'time summary');

    const now = Date.now();
    const seconds = (r: any) =>
      Math.max(0, Math.floor(((r.ended_at ? Date.parse(r.ended_at) : now) - Date.parse(r.started_at)) / 1000));

    const byTask = new Map<string, number>();
    const byMember = new Map<string, number>();
    for (const r of data ?? []) {
      byTask.set(r.task_id, (byTask.get(r.task_id) ?? 0) + seconds(r));
      byMember.set(r.actor_id, (byMember.get(r.actor_id) ?? 0) + seconds(r));
    }

    ok(res, {
      byTask: [...byTask].map(([id, s]) => ({ taskId: id, trackedSeconds: s })),
      // READ_ONLY receives task-level aggregate only — never per-person rows or identities.
      byMember: visibility === 'aggregate_only'
        ? []
        : [...byMember].map(([id, s]) => ({ actorId: id, trackedSeconds: s })),
      visibility
    });
  }, { requiresTimeTracking: true }));

  // ── Tasks ───────────────────────────────────────────────────────────────────────────
  router.get('/', guard('read', async (req, res, ctx) => {
    const { page, pageSize, offset } = v.parsePagination(req.query);
    const { column, ascending } = v.parseSort(req.query);

    let q = supabaseAdmin.from('task_items')
      .select(TASK_COLUMNS, { count: 'exact' })
      .eq('workspace_id', ctx.workspaceId);

    const listId = v.optionalUuid(req.query?.listId, 'listId');
    const statusId = v.optionalUuid(req.query?.statusId, 'statusId');
    const parentId = v.optionalUuid(req.query?.parentTaskId, 'parentTaskId');
    const priority = v.optionalEnum(req.query?.priority, 'priority', v.PRIORITIES);
    const search = v.optionalString(req.query?.q, 'q', 200);

    if (listId) q = q.eq('list_id', listId);
    if (statusId) q = q.eq('status_id', statusId);
    if (priority) q = q.eq('priority', priority);
    if (parentId) q = q.eq('parent_task_id', parentId);
    if (req.query?.rootOnly === 'true') q = q.is('parent_task_id', null);
    if (req.query?.includeArchived !== 'true') q = q.is('archived_at', null);
    if (search) q = q.ilike('title', `%${search.replace(/[%_]/g, '\\$&')}%`);
    if (req.query?.dueBefore) {
      q = q.lte('due_date', v.optionalTimestamp(req.query.dueBefore, 'dueBefore')!);
    }

    const { data, error, count } = await q
      .order(column, { ascending }).range(offset, offset + pageSize - 1);
    if (error) throw mapDbError(error, 'list tasks');

    // Assignees fetched in ONE additional query for the whole page, never per task.
    const ids = (data ?? []).map((t: any) => t.id);
    let assignments: any[] = [];
    if (ids.length) {
      const { data: a, error: aErr } = await supabaseAdmin.from('task_assignments')
        .select('task_id, actor_id').eq('workspace_id', ctx.workspaceId).in('task_id', ids);
      if (aErr) throw mapDbError(aErr, 'list assignments');
      assignments = a ?? [];
    }
    const byTask = new Map<string, string[]>();
    for (const a of assignments) {
      byTask.set(a.task_id, [...(byTask.get(a.task_id) ?? []), a.actor_id]);
    }

    ok(res,
      (data ?? []).map((t: any) => ({ ...t, assigneeActorIds: byTask.get(t.id) ?? [] })),
      { page: { page, pageSize, total: count ?? 0 } }
    );
  }));

  router.post('/', guard('mutate', async (req, res, ctx) => {
    perm.assertCanCreateTask(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const listId = v.requireUuid(req.body?.listId, 'listId');
    const statusId = v.requireUuid(req.body?.statusId, 'statusId');
    const title = v.requireString(req.body?.title, 'title', 1, 500);
    const parentTaskId = v.optionalUuid(req.body?.parentTaskId, 'parentTaskId');
    const startDate = v.optionalTimestamp(req.body?.startDate, 'startDate');
    const dueDate = v.optionalTimestamp(req.body?.dueDate, 'dueDate');
    if (startDate && dueDate && Date.parse(dueDate) < Date.parse(startDate)) {
      throw invalid('dueDate cannot be earlier than startDate.');
    }

    const { data, error } = await supabaseAdmin.from('task_items')
      .insert({
        workspace_id: ctx.workspaceId, list_id: listId, status_id: statusId,
        parent_task_id: parentTaskId, title,
        description: v.optionalString(req.body?.description, 'description', 20000),
        priority: v.optionalEnum(req.body?.priority, 'priority', v.PRIORITIES) ?? 'normal',
        start_date: startDate, due_date: dueDate,
        time_estimate_seconds:
          v.optionalNonNegativeInt(req.body?.timeEstimateSeconds, 'timeEstimateSeconds', 3153600000),
        position: Number(req.body?.position ?? 1000),
        created_by: actor.actorId, updated_by: actor.actorId
      })
      // TASK_COLUMNS is a runtime string, so supabase-js cannot infer the row shape and
      // widens it to a union. The cast narrows it back; `error` is still checked below.
      .select(TASK_COLUMNS).single() as { data: any; error: any };
    if (error) throw mapDbError(error, 'create task');
    await recordActivity(ctx, 'task', data.id, 'TASK_CREATED', { title });
    ok(res, { ...data, assigneeActorIds: [] });
  }));

  router.get('/:id', guard('read', async (req, res, ctx) => {
    const id = v.requireUuid(req.params.id, 'id');
    const task = await loadTask(ctx, id);
    const [assignees, subtasks] = await Promise.all([
      loadAssigneeIds(ctx, id),
      supabaseAdmin.from('task_items').select(TASK_COLUMNS)
        .eq('workspace_id', ctx.workspaceId).eq('parent_task_id', id).order('position')
    ]);
    ok(res, { ...task, assigneeActorIds: assignees, subtasks: subtasks.data ?? [] });
  }));

  router.patch('/:id', guard('mutate', async (req, res, ctx) => {
    const actor = requireResolvedActor(ctx.actor);
    const id = v.requireUuid(req.params.id, 'id');
    const version = v.requireVersion(req.body?.version);

    const task = await loadTask(ctx, id);
    const assignees = await loadAssigneeIds(ctx, id);
    perm.assertCanMutateTask(ctx.role, actor.actorId, task, assignees);

    const patch: Record<string, unknown> = { updated_by: actor.actorId, version: version + 1 };
    if (req.body?.title !== undefined) patch.title = v.requireString(req.body.title, 'title', 1, 500);
    if (req.body?.description !== undefined) {
      patch.description = v.optionalString(req.body.description, 'description', 20000);
    }
    if (req.body?.statusId !== undefined) patch.status_id = v.requireUuid(req.body.statusId, 'statusId');
    if (req.body?.listId !== undefined) patch.list_id = v.requireUuid(req.body.listId, 'listId');
    if (req.body?.priority !== undefined) {
      patch.priority = v.requireEnum(req.body.priority, 'priority', v.PRIORITIES);
    }
    if (req.body?.startDate !== undefined) {
      patch.start_date = v.optionalTimestamp(req.body.startDate, 'startDate');
    }
    if (req.body?.dueDate !== undefined) {
      patch.due_date = v.optionalTimestamp(req.body.dueDate, 'dueDate');
    }
    if (req.body?.timeEstimateSeconds !== undefined) {
      patch.time_estimate_seconds =
        v.optionalNonNegativeInt(req.body.timeEstimateSeconds, 'timeEstimateSeconds', 3153600000);
    }
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);

    const { data, error } = await supabaseAdmin.from('task_items')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select(TASK_COLUMNS);
    if (error) throw mapDbError(error, 'update task');
    if (!data || data.length === 0) throw versionConflict();
    await recordActivity(ctx, 'task', id, 'TASK_UPDATED');
    ok(res, data[0]);
  }));

  // Archive / restore are soft only — nothing in this module is ever hard-deleted via the UI.
  for (const [suffix, archived] of [['archive', true], ['restore', false]] as const) {
    router.post(`/:id/${suffix}`, guard('mutate', async (req, res, ctx) => {
      const actor = requireResolvedActor(ctx.actor);
      const id = v.requireUuid(req.params.id, 'id');
      const version = v.requireVersion(req.body?.version);
      const task = await loadTask(ctx, id);
      perm.assertCanMutateTask(ctx.role, actor.actorId, task, await loadAssigneeIds(ctx, id));

      const { data, error } = await supabaseAdmin.from('task_items')
        .update({
          archived_at: archived ? new Date().toISOString() : null,
          updated_by: actor.actorId, version: version + 1
        })
        .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
        .select(TASK_COLUMNS);
      if (error) throw mapDbError(error, 'archive task');
      if (!data || data.length === 0) throw versionConflict();
      await recordActivity(ctx, 'task', id, archived ? 'TASK_ARCHIVED' : 'TASK_RESTORED');
      ok(res, data[0]);
    }));
  }

  // Assignment replacement — the submitted set becomes the complete assignee list.
  router.put('/:id/assignees', guard('mutate', async (req, res, ctx) => {
    const actor = requireResolvedActor(ctx.actor);
    const id = v.requireUuid(req.params.id, 'id');
    const raw = req.body?.actorIds;
    if (!Array.isArray(raw)) throw invalid('actorIds must be an array.');
    if (raw.length > 50) throw invalid('A task may have at most 50 assignees.');
    const next = [...new Set(raw.map((x: unknown) => v.requireUuid(x, 'actorIds[]')))];

    const task = await loadTask(ctx, id);
    const current = await loadAssigneeIds(ctx, id);
    perm.assertCanMutateTask(ctx.role, actor.actorId, task, current);
    perm.assertCanApplyAssignments(ctx.role, actor.actorId, current, next);

    const toAdd = next.filter(a => !current.includes(a));
    const toRemove = current.filter(a => !next.includes(a));

    if (toRemove.length) {
      const { error } = await supabaseAdmin.from('task_assignments').delete()
        .eq('workspace_id', ctx.workspaceId).eq('task_id', id).in('actor_id', toRemove);
      if (error) throw mapDbError(error, 'remove assignees');
    }
    if (toAdd.length) {
      // The composite FK guarantees every actor belongs to THIS workspace; a foreign actor
      // id fails as a 404 rather than silently attaching.
      const { error } = await supabaseAdmin.from('task_assignments').insert(
        toAdd.map(a => ({
          workspace_id: ctx.workspaceId, task_id: id, actor_id: a, assigned_by: actor.actorId
        }))
      );
      if (error) throw mapDbError(error, 'add assignees');
    }
    await recordActivity(ctx, 'assignment', id, 'ASSIGNEES_REPLACED',
      { added: toAdd.length, removed: toRemove.length });
    ok(res, { taskId: id, assigneeActorIds: next });
  }));

  return router;
}
