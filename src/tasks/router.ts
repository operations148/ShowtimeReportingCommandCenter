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
  ok, fail, handler, TaskError, notFound, invalid, versionConflict, mapDbError, applyNoStore,
  folderNotEmpty, folderCrossSpace
} from './http.js';
import { isTaskManagementEnabled, isTaskTimeTrackingEnabled } from './config.js';
import { assertWorkspaceInRollout, RolloutExemptOperation } from './rollout.js';
import { resolveActor, requireResolvedActor, ResolvedActor } from './actors.js';
import {
  assertTaskEntitlement, closeActiveTimersForWorkspace, TaskOperation
} from './entitlement.js';
import * as perm from './permissions.js';
import * as v from './validation.js';
import {
  findStatusTemplate, planStatusTemplate, STATUS_TEMPLATES, ExistingStatus
} from './statusTemplates.js';
import { registerChannelRoutes } from './channelsRouter.js';

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
  opts: {
    requiresTimeTracking?: boolean;
    /**
     * Marks a route that must keep working while a workspace is being taken OUT of the
     * rollout, so an already-running timer can still be seen and stopped. Only ever set on
     * the two timer-recovery routes; neither can create data.
     */
    rolloutExempt?: RolloutExemptOperation;
  } = {}
) {
  return handler(async (req: any, res: any) => {
    if (!isTaskManagementEnabled()) {
      throw new TaskError(403, 'TASK_MODULE_DISABLED', 'Task Management is not enabled.');
    }
    if (opts.requiresTimeTracking && !isTaskTimeTrackingEnabled()) {
      throw new TaskError(403, 'TASK_TIME_TRACKING_DISABLED', 'Time tracking is not enabled.');
    }
    v.rejectClientWorkspaceId(req.body, req.query);

    // Staged rollout. Checked before entitlement and RBAC so a workspace outside the rollout
    // is refused without the module doing any tenant work on its behalf. The id comes from
    // the session via requireAuth — never from the request body or query.
    assertWorkspaceInRollout(req.workspace?.id, { exemptOperation: opts.rolloutExempt });

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

/**
 * Verifies a Folder exists in this workspace, belongs to the given Space, and is not
 * archived — before it can be used as a List's parent. The Space is always the caller's
 * List's CURRENT space_id, loaded fresh, never trusted from the request body: a List's Space
 * is immutable through this API, so the only question is whether the named Folder lives in
 * that same Space. This is the database's own composite FK (task_lists_folder_fk in
 * migration 0009) enforced again here, earlier, so a mismatch is a clean, specific error
 * rather than a raw constraint violation surfacing through mapDbError as a generic 404.
 */
async function loadFolderInSpace(ctx: Ctx, folderId: string, spaceId: string) {
  const { data, error } = await supabaseAdmin.from('task_folders')
    .select('id, space_id, archived_at')
    .eq('workspace_id', ctx.workspaceId).eq('id', folderId).maybeSingle();
  if (error) throw mapDbError(error, 'load folder');
  if (!data) throw notFound('Folder');
  if (data.space_id !== spaceId) throw folderCrossSpace();
  if (data.archived_at) throw invalid('Cannot use an archived Folder. Restore it first.');
  return data;
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
    const [spaces, folders, lists, statuses] = await Promise.all([
      supabaseAdmin.from('task_spaces')
        .select('id, name, position, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position'),
      supabaseAdmin.from('task_folders')
        .select('id, space_id, name, description, position, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position'),
      supabaseAdmin.from('task_lists')
        .select('id, space_id, folder_id, name, position, is_default, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position'),
      supabaseAdmin.from('task_statuses')
        .select('id, space_id, name, category, color, position, is_default, version, archived_at')
        .eq('workspace_id', ctx.workspaceId).order('position')
    ]);
    for (const r of [spaces, folders, lists, statuses]) {
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
      folders: folders.data ?? [],
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

  // ── Workspace actors (assignee directory) ───────────────────────────────────────────
  // The task payloads carry assigneeActorIds only; without this the UI cannot render a
  // name for an assignee or offer a picker. Returns UI snapshots for THIS workspace only —
  // never a principal id, external id, or any cross-tenant record.
  //
  // Visible to every role that can view the module: an assignee is task metadata, not
  // time data. D7's restriction on "employee-level identities" governs TIME entries, which
  // are filtered separately below.
  router.get('/actors', guard('read', async (_req, res, ctx) => {
    const { data, error } = await supabaseAdmin
      .from('task_workspace_actors')
      .select('id, display_name, email, archived_at')
      .eq('workspace_id', ctx.workspaceId)
      .order('display_name', { nullsFirst: false });
    if (error) throw mapDbError(error, 'list actors');
    ok(res, (data ?? []).map((a: any) => ({
      actorId: a.id,
      displayName: a.display_name,
      email: a.email,
      archived: a.archived_at !== null,
      isSelf: ctx.actor?.actorId === a.id
    })));
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

  // ── Folders ─────────────────────────────────────────────────────────────────────────
  // Optional grouping level between Space and List (migration 0009). A List with
  // folder_id = NULL is a direct child of its Space — every List that existed before this
  // feature, and every List a manager never explicitly moves, stays exactly there.
  router.post('/folders', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const name = v.requireString(req.body?.name, 'name', 1, 120);
    const description = v.optionalString(req.body?.description, 'description', 2000);
    const actor = requireResolvedActor(ctx.actor);

    const { data, error } = await supabaseAdmin.from('task_folders')
      .insert({
        workspace_id: ctx.workspaceId, space_id: spaceId, name, description,
        position: Number(req.body?.position ?? 1000),
        created_by: actor.actorId, updated_by: actor.actorId
      })
      .select('id, space_id, name, description, position, version, archived_at').single();
    if (error) throw mapDbError(error, 'create folder');
    await recordActivity(ctx, 'folder', data.id, 'FOLDER_CREATED', { name });
    ok(res, data);
  }));

  router.patch('/folders/:id', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const id = v.requireUuid(req.params.id, 'id');
    const version = v.requireVersion(req.body?.version);
    const actor = requireResolvedActor(ctx.actor);

    // Archiving is refused while the Folder still has live Lists in it. This is an explicit,
    // visible precondition rather than an implicit cascade — a cascade would either archive
    // Lists (and everything under them) the caller never asked to touch, or silently orphan
    // them, neither of which this module does anywhere else for Spaces or Lists either.
    // (There is a narrow theoretical race between this count and the update below — a List
    // could be created into this Folder in between — but the outcome is a List that becomes
    // hard to find until the Folder is restored, never data loss, and no other archive check
    // in this module is transactionally locked either.)
    if (req.body?.archived === true) {
      const { count, error: cErr } = await supabaseAdmin.from('task_lists')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('folder_id', id).is('archived_at', null);
      if (cErr) throw mapDbError(cErr, 'check folder contents');
      if ((count ?? 0) > 0) throw folderNotEmpty(count!);
    }

    const patch: Record<string, unknown> = { updated_by: actor.actorId, version: version + 1 };
    if (req.body?.name !== undefined) patch.name = v.requireString(req.body.name, 'name', 1, 120);
    if (req.body?.description !== undefined) {
      patch.description = v.optionalString(req.body.description, 'description', 2000);
    }
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;

    const { data, error } = await supabaseAdmin.from('task_folders')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select('id, space_id, name, description, position, version, archived_at');
    if (error) throw mapDbError(error, 'update folder');
    if (!data || data.length === 0) {
      const { data: exists } = await supabaseAdmin.from('task_folders')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
      throw exists ? versionConflict() : notFound('Folder');
    }
    await recordActivity(ctx, 'folder', id, 'FOLDER_UPDATED');
    ok(res, data[0]);
  }));

  // ── Lists ───────────────────────────────────────────────────────────────────────────
  router.post('/lists', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const name = v.requireString(req.body?.name, 'name', 1, 120);
    const actor = requireResolvedActor(ctx.actor);

    // Optional at creation: omitted or null -> a direct child of the Space (unchanged
    // default behaviour). A supplied id must be a Folder that already lives in this Space.
    let folderId: string | null = null;
    if (req.body?.folderId !== undefined && req.body.folderId !== null) {
      folderId = v.requireUuid(req.body.folderId, 'folderId');
      await loadFolderInSpace(ctx, folderId, spaceId);
    }

    const { data, error } = await supabaseAdmin.from('task_lists')
      .insert({
        workspace_id: ctx.workspaceId, space_id: spaceId, folder_id: folderId, name,
        position: Number(req.body?.position ?? 1000),
        created_by: actor.actorId, updated_by: actor.actorId
      })
      .select('id, space_id, folder_id, name, position, is_default, version, archived_at').single();
    if (error) throw mapDbError(error, 'create list');
    await recordActivity(ctx, 'list', data.id, 'LIST_CREATED', { name, folderId });
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

    // Move into a Folder, or back to the Space root. A List's Space is immutable through this
    // API, so the Folder (if any) must belong to the List's CURRENT space_id — loaded fresh
    // here, never taken from the request, exactly like every other cross-reference check in
    // this module.
    if (req.body?.folderId !== undefined) {
      if (req.body.folderId === null) {
        patch.folder_id = null;
      } else {
        const folderId = v.requireUuid(req.body.folderId, 'folderId');
        const { data: current, error: lErr } = await supabaseAdmin.from('task_lists')
          .select('space_id').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle();
        if (lErr) throw mapDbError(lErr, 'load list');
        if (!current) throw notFound('List');
        await loadFolderInSpace(ctx, folderId, current.space_id);
        patch.folder_id = folderId;
      }
    }

    const { data, error } = await supabaseAdmin.from('task_lists')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', id).eq('version', version)
      .select('id, space_id, folder_id, name, position, is_default, version, archived_at');
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
    // Colour was settable on create but not on update, so an existing status could never be
    // recoloured. Validated here against the same 6-digit hex shape the CHECK constraint
    // enforces, so a bad value fails as a clean 422 rather than a database violation.
    if (req.body?.color !== undefined) {
      const color = v.optionalString(req.body.color, 'color', 7);
      if (color !== null && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        throw invalid('color must be a 6-digit hex value such as #2563EB.');
      }
      patch.color = color;
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

  // ── Status templates ────────────────────────────────────────────────────────────────
  /**
   * A template is NEVER applied implicitly. Space creation seeds its own defaults and is not
   * touched by any of this; the only way a template reaches a Space is a manager calling
   * /statuses/template/apply, and the UI only offers that after showing the dry-run below.
   */

  router.get('/statuses/templates', guard('read', async (_req, res, _ctx) => {
    ok(res, STATUS_TEMPLATES.map(t => ({
      key: t.key, label: t.label, description: t.description, entries: t.entries
    })));
  }));

  /** Loads the Space's statuses plus a task count per status — the input the planner needs. */
  async function loadTemplateInputs(ctx: Ctx, spaceId: string) {
    const { data: statuses, error } = await supabaseAdmin.from('task_statuses')
      .select('id, space_id, name, category, color, position, is_default, version, archived_at')
      .eq('workspace_id', ctx.workspaceId).eq('space_id', spaceId).order('position');
    if (error) throw mapDbError(error, 'load statuses');
    const rows = (statuses ?? []) as any[];

    const counts = new Map<string, number>();
    await Promise.all(rows.map(async (s: any) => {
      const { count, error: cErr } = await supabaseAdmin.from('task_items')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('status_id', s.id);
      if (cErr) throw mapDbError(cErr, 'status task count');
      counts.set(s.id, count ?? 0);
    }));

    return { rows, counts };
  }

  function requireTemplate(raw: unknown) {
    const tpl = findStatusTemplate(raw ?? 'operations');
    if (!tpl) throw invalid('Unknown status template.');
    return tpl;
  }

  // Dry-run. Reads only — this route performs no writes under any input.
  router.post('/statuses/template/preview', guard('read', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const tpl = requireTemplate(req.body?.template);
    const { rows, counts } = await loadTemplateInputs(ctx, spaceId);
    ok(res, { dryRun: true, ...planStatusTemplate(rows as ExistingStatus[], tpl, counts) });
  }));

  router.post('/statuses/template/apply', guard('mutate', async (req, res, ctx) => {
    perm.assertCanManageHierarchy(ctx.role);
    const spaceId = v.requireUuid(req.body?.spaceId, 'spaceId');
    const tpl = requireTemplate(req.body?.template);

    const { rows, counts } = await loadTemplateInputs(ctx, spaceId);
    const plan = planStatusTemplate(rows as ExistingStatus[], tpl, counts);

    // Inserts first, so a failure part-way leaves extra statuses rather than a Space whose
    // ordering was rewritten to match a template that was never fully created.
    for (const item of plan.items) {
      if (item.action !== 'create') continue;
      const { error } = await supabaseAdmin.from('task_statuses').insert({
        workspace_id: ctx.workspaceId, space_id: spaceId,
        name: item.name, category: item.category, color: item.color, position: item.position
      });
      if (error) throw mapDbError(error, 'create status from template');
    }

    /**
     * Reused rows are re-ordered (and un-archived) in place by id. Nothing is deleted, no
     * status_id changes, and no task row is written — so every task already sitting in a
     * reused status keeps pointing at exactly the same status it did before.
     *
     * `keep` items are deliberately NOT written at all: a status outside the template is left
     * completely untouched, including its position, whether or not it holds tasks.
     */
    for (const item of plan.items) {
      if (item.action !== 'reuse' || !item.statusId) continue;
      const current = rows.find((r: any) => r.id === item.statusId);
      if (!current) continue;
      if (current.position === item.position && !current.archived_at) continue;
      const { error } = await supabaseAdmin.from('task_statuses')
        .update({ position: item.position, archived_at: null, version: current.version + 1 })
        .eq('workspace_id', ctx.workspaceId).eq('id', item.statusId);
      if (error) throw mapDbError(error, 'reorder status from template');
    }

    // Logged against the SPACE, not a status: the event describes the Space's status set as a
    // whole, and 'space' is already an allowed entity_type — so this needs no migration.
    await recordActivity(ctx, 'space', spaceId, 'STATUS_TEMPLATE_APPLIED', {
      template: tpl.key, created: plan.createCount, reused: plan.reuseCount, kept: plan.keepCount
    });

    const { rows: after } = await loadTemplateInputs(ctx, spaceId);
    ok(res, { applied: true, plan, statuses: after });
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
  }, { rolloutExempt: 'timer.active' }));

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
      // Filed against the TASK, not the time entry. GET /:id/activity looks events up by the
      // task's id, so an event stored under the entry's id is recorded but permanently
      // unreachable — the drawer's Activity section would never show any timer history.
      // The entry id is preserved in `detail` so the audit trail keeps the exact link.
      await recordActivity(ctx, 'task', taskId, 'TIMER_STARTED', { entryId: row.entry_id });
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
      await recordActivity(ctx, 'task', row.task_id, 'TIMER_STOPPED',
        { entryId: row.entry_id, durationSeconds: row.duration_seconds });
    }
    ok(res, {
      entryId: row.entry_id, taskId: row.task_id, startedAt: row.started_at,
      endedAt: row.ended_at, durationSeconds: Number(row.duration_seconds ?? 0),
      outcome: row.outcome
    });
  }, { requiresTimeTracking: true, rolloutExempt: 'timer.stop' }));

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
    await recordActivity(ctx, 'task', taskId, 'MANUAL_TIME_ADDED', { entryId: data.id });
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
    await recordActivity(ctx, 'task', data.task_id, 'TIME_ENTRY_UPDATED', { entryId: id });
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

  // ── Channels ────────────────────────────────────────────────────────────────────────
  // Registered BEFORE the '/:id' task route below, for the same reason the timer and status
  // routes are: Express matches in registration order, so '/channels' declared after '/:id'
  // would be captured as a task id and never reach these handlers. They share this router, and
  // therefore the identical guard chain — the flag, rollout, entitlement and actor resolution
  // above all apply to every channel route without being restated.
  registerChannelRoutes(router, guard, recordActivity);

  // ── Tasks ───────────────────────────────────────────────────────────────────────────
  router.get('/', guard('read', async (req, res, ctx) => {
    const { page, pageSize, offset } = v.parsePagination(req.query);
    const { column, ascending } = v.parseSort(req.query);

    const listId = v.optionalUuid(req.query?.listId, 'listId');
    const statusId = v.optionalUuid(req.query?.statusId, 'statusId');
    const parentId = v.optionalUuid(req.query?.parentTaskId, 'parentTaskId');
    const priority = v.optionalEnum(req.query?.priority, 'priority', v.PRIORITIES);
    const search = v.optionalString(req.query?.q, 'q', 200);
    const assigneeActorId = v.optionalUuid(req.query?.assigneeActorId, 'assigneeActorId');
    const dueBefore = req.query?.dueBefore
      ? v.optionalTimestamp(req.query.dueBefore, 'dueBefore')
      : null;

    /**
     * Assignee is stored in a join table, so it cannot be a column predicate. Resolving it to
     * an id set FIRST and filtering on it keeps the filter server-side, which is what makes
     * `count` (and therefore pagination and the group counts below) actually correct. It was
     * previously applied in the browser to the current page only, so page 2 of an
     * assignee-filtered list silently dropped rows and every total was the unfiltered total.
     */
    let assignedTaskIds: string[] | null = null;
    if (assigneeActorId) {
      const { data: rows, error: aErr } = await supabaseAdmin.from('task_assignments')
        .select('task_id')
        .eq('workspace_id', ctx.workspaceId).eq('actor_id', assigneeActorId);
      if (aErr) throw mapDbError(aErr, 'assignee filter');
      assignedTaskIds = [...new Set((rows ?? []).map((r: any) => r.task_id))];
    }

    /** The single definition of "the active query", shared by the page and every group count. */
    const applyFilters = (builder: any) => {
      let b = builder.eq('workspace_id', ctx.workspaceId);
      if (listId) b = b.eq('list_id', listId);
      if (statusId) b = b.eq('status_id', statusId);
      if (priority) b = b.eq('priority', priority);
      if (parentId) b = b.eq('parent_task_id', parentId);
      if (req.query?.rootOnly === 'true') b = b.is('parent_task_id', null);
      if (req.query?.includeArchived !== 'true') b = b.is('archived_at', null);
      if (search) b = b.ilike('title', `%${search.replace(/[%_]/g, '\\$&')}%`);
      if (dueBefore) b = b.lte('due_date', dueBefore);
      if (assignedTaskIds) b = b.in('id', assignedTaskIds);
      return b;
    };

    // An assignee with nothing assigned matches no task at all; `.in('id', [])` is valid but
    // short-circuiting here also skips the group-count fan-out for a guaranteed-empty result.
    const impossible = assignedTaskIds !== null && assignedTaskIds.length === 0;

    const q = applyFilters(
      supabaseAdmin.from('task_items').select(TASK_COLUMNS, { count: 'exact' })
    );

    const { data, error, count } = impossible
      ? { data: [] as any[], error: null, count: 0 }
      : await q.order(column, { ascending }).range(offset, offset + pageSize - 1);
    if (error) throw mapDbError(error, 'list tasks');

    /**
     * Per-status totals for the status-grouped List view.
     *
     * Computed over the WHOLE active query rather than the current page, so a group's count is
     * the number of tasks that actually match the filters — not however many of them happen to
     * have landed on the page being viewed. One exact head-count per status, fanned out in
     * parallel; the set is the Space's own statuses, which is a small manager-curated list, so
     * this stays a handful of index-only counts rather than growing with the task table.
     */
    let groups: { statusId: string; total: number }[] | undefined;
    if (req.query?.groupBy === 'status') {
      const groupSpaceId = v.requireUuid(req.query?.spaceId, 'spaceId');
      const { data: sts, error: sErr } = await supabaseAdmin.from('task_statuses')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('space_id', groupSpaceId)
        .is('archived_at', null).order('position');
      if (sErr) throw mapDbError(sErr, 'group statuses');
      const statusIds = (sts ?? []).map((r: any) => r.id);
      groups = impossible
        ? statusIds.map((id: string) => ({ statusId: id, total: 0 }))
        : await Promise.all(statusIds.map(async (id: string) => {
            const { count: c, error: cErr } = await applyFilters(
              supabaseAdmin.from('task_items').select('id', { count: 'exact', head: true })
            ).eq('status_id', id);
            if (cErr) throw mapDbError(cErr, 'group count');
            return { statusId: id, total: c ?? 0 };
          }));
    }

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

    // Subtask counts for the whole page in ONE query (never one per row). Only root tasks
    // can have children, so this is skipped entirely when the page has none.
    const subtaskCounts = new Map<string, number>();
    const rootIds = (data ?? []).filter((t: any) => t.parent_task_id === null).map((t: any) => t.id);
    if (rootIds.length) {
      const { data: subs, error: sErr } = await supabaseAdmin.from('task_items')
        .select('parent_task_id')
        .eq('workspace_id', ctx.workspaceId)
        .in('parent_task_id', rootIds)
        .is('archived_at', null);
      if (sErr) throw mapDbError(sErr, 'subtask counts');
      for (const s of subs ?? []) {
        subtaskCounts.set(s.parent_task_id, (subtaskCounts.get(s.parent_task_id) ?? 0) + 1);
      }
    }

    ok(res,
      (data ?? []).map((t: any) => ({
        ...t,
        assigneeActorIds: byTask.get(t.id) ?? [],
        subtaskCount: subtaskCounts.get(t.id) ?? 0
      })),
      { page: { page, pageSize, total: count ?? 0 }, ...(groups ? { groups } : {}) }
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

  // Activity history for one task. Read-scoped to the workspace; `detail` is a curated
  // summary written by recordActivity and never contains tokens or other tenants' ids.
  router.get('/:id/activity', guard('read', async (req, res, ctx) => {
    const id = v.requireUuid(req.params.id, 'id');
    await loadTask(ctx, id); // 404s if the task is not in this workspace
    const { pageSize, offset } = v.parsePagination(req.query);
    const { data, error } = await supabaseAdmin
      .from('task_activity_events')
      .select('id, actor_id, entity_type, action, detail, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .eq('entity_id', id)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw mapDbError(error, 'task activity');
    ok(res, data ?? []);
  }));

  // Time entries for one task, filtered by D7 visibility:
  //   manager     -> every entry
  //   contributor -> only their own
  //   read_only   -> none; they get the aggregate from /time/summary instead, and must not
  //                  see employee-level entries, identities or notes.
  router.get('/:id/time-entries', guard('read', async (req, res, ctx) => {
    const id = v.requireUuid(req.params.id, 'id');
    await loadTask(ctx, id);
    const visibility = perm.timeVisibilityFor(ctx.role);
    if (visibility === 'aggregate_only') {
      return ok(res, { entries: [], visibility });
    }
    let q = supabaseAdmin.from('task_time_entries')
      .select('id, task_id, actor_id, started_at, ended_at, source, note, archived_at')
      .eq('workspace_id', ctx.workspaceId).eq('task_id', id).is('archived_at', null);
    // Filtered in the QUERY, not by trimming a wider result set afterwards.
    if (visibility === 'own') {
      if (!ctx.actor) return ok(res, { entries: [], visibility });
      q = q.eq('actor_id', ctx.actor.actorId);
    }
    const { data, error } = await q.order('started_at', { ascending: false }).limit(200);
    if (error) throw mapDbError(error, 'task time entries');
    ok(res, { entries: data ?? [], visibility });
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
