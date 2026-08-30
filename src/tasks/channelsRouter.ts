/**
 * Channels: workspace messaging routes.
 *
 * Registered onto the SAME express router as the rest of the module, so every route here
 * inherits the full guard chain unchanged: module flag -> channels flag -> client-workspace-id
 * rejection -> rollout gate -> entitlement -> resolved actor. Nothing in this file re-derives
 * identity or workspace; both arrive in `ctx` already established by that chain.
 *
 * Invariants this file is responsible for, restated because they are the security contract:
 *   * EVERY query is filtered by ctx.workspaceId. There is no query here without it.
 *   * The author of a message is ALWAYS ctx.actor.actorId. No route reads an author, actor or
 *     workspace id from the request body.
 *   * Timestamps are always the database's (`now()` / column defaults). No route accepts a
 *     client-supplied created_at, updated_at or edited_at.
 *   * Nothing is ever hard-deleted.
 */

import type express from 'express';
import { supabaseAdmin } from '../supabase.js';
import { UserRole } from '../types.js';
import {
  ok, notFound, invalid, versionConflict, mapDbError, TaskError,
  channelsDisabled, rateLimited, channelArchived, editWindowClosed, messageDeleted
} from './http.js';
import { isTaskChannelsEnabled } from './config.js';
import { requireResolvedActor, ResolvedActor } from './actors.js';
import * as perm from './permissions.js';
import * as v from './validation.js';
import {
  CHANNEL_NAME_MAX, CHANNEL_DESCRIPTION_MAX, CHANNEL_VISIBILITIES, CHANNEL_MEMBER_ROLES,
  EDIT_WINDOW_MS, RATE_LIMIT_MAX_SENDS, RATE_LIMIT_WINDOW_MS,
  SlidingWindowRateLimiter, rateLimitKey,
  slugifyChannelName, sanitizeMessageBody, optionalClientToken,
  decodeCursor, encodeCursor, cursorOf, trimToStrictlyAfter, trimToStrictlyBefore,
  parseMessageLimit, isWithinEditWindow
} from './channels.js';

interface Ctx {
  workspaceId: string;
  role: UserRole;
  actor: ResolvedActor | null;
}

type GuardFactory = (
  operation: 'read' | 'mutate' | 'timer.stop',
  fn: (req: any, res: any, ctx: Ctx) => Promise<void>,
  opts?: { requiresTimeTracking?: boolean }
) => any;

type RecordActivity = (
  ctx: Ctx, entityType: string, entityId: string, action: string, detail?: Record<string, unknown>
) => Promise<void>;

const CHANNEL_COLUMNS =
  'id, space_id, name, slug, description, visibility, position, version, archived_at,' +
  ' created_at, updated_at';

/** Columns safe to return for a message. Never exposes principal ids or internal state. */
const MESSAGE_COLUMNS =
  'id, channel_id, author_actor_id, body, parent_message_id, edited_at, deleted_at,' +
  ' deleted_by, created_at, updated_at';

/**
 * Process-local first line of rate-limit defence. See SlidingWindowRateLimiter for why this is
 * explicitly NOT the authoritative check on a serverless platform — the database count in the
 * send route is.
 */
const sendLimiter = new SlidingWindowRateLimiter();

/**
 * Over-fetch added to every keyset page.
 *
 * The query bounds created_at INCLUSIVELY and the exact boundary rows are discarded in memory
 * (see trimToStrictlyAfter). This slack covers the discarded rows. Postgres `now()` has
 * microsecond resolution and each INSERT is its own statement, so more than a handful of
 * messages sharing one exact timestamp is not reachable in practice; 50 is far beyond it.
 */
const CURSOR_OVERLAP = 50;

export function registerChannelRoutes(
  router: express.Router,
  guard: GuardFactory,
  recordActivity: RecordActivity
): void {

  /** Channels have their own fail-closed flag on top of the module flag. */
  function assertChannelsEnabled(): void {
    if (!isTaskChannelsEnabled()) throw channelsDisabled();
  }

  async function loadChannel(ctx: Ctx, channelId: string) {
    const { data, error } = await supabaseAdmin.from('task_channels')
      .select(CHANNEL_COLUMNS)
      .eq('workspace_id', ctx.workspaceId).eq('id', channelId).maybeSingle();
    if (error) throw mapDbError(error, 'load channel');
    if (!data) throw notFound('Channel');
    return data as any;
  }

  /** Membership of the CURRENT actor in a channel, read fresh. Never taken from the request. */
  async function membershipOf(ctx: Ctx, channelId: string): Promise<{ isMember: boolean; role: string | null }> {
    if (!ctx.actor) return { isMember: false, role: null };
    const { data, error } = await supabaseAdmin.from('task_channel_members')
      .select('role')
      .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId)
      .eq('actor_id', ctx.actor.actorId).maybeSingle();
    if (error) throw mapDbError(error, 'channel membership');
    return { isMember: !!data, role: (data as any)?.role ?? null };
  }

  /** Loads a channel and asserts the caller may read it. Every message route starts here. */
  async function loadReadableChannel(ctx: Ctx, channelId: string) {
    const channel = await loadChannel(ctx, channelId);
    const { isMember } = await membershipOf(ctx, channelId);
    perm.assertCanReadChannel(ctx.role, channel, isMember);
    return channel;
  }

  /**
   * A deleted message is returned as a tombstone: the row survives so threads keep their
   * shape, but the body is withheld from EVERYONE, the author included. Moderation that left
   * the text retrievable through the API would not be moderation.
   */
  function presentMessage(row: any) {
    const deleted = !!row.deleted_at;
    return {
      id: row.id,
      channelId: row.channel_id,
      authorActorId: deleted ? null : row.author_actor_id,
      body: deleted ? null : row.body,
      parentMessageId: row.parent_message_id,
      editedAt: row.edited_at,
      deletedAt: row.deleted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      cursor: encodeCursor(cursorOf(row))
    };
  }

  // ── Channels ─────────────────────────────────────────────────────────────────────────

  /**
   * Unread counts. Registered BEFORE '/channels/:channelId' so the literal path is not
   * captured as a channel id — the same ordering rule the timer and status routes follow.
   */
  router.get('/channels/unread', guard('read', async (_req, res, ctx) => {
    assertChannelsEnabled();
    ok(res, await unreadCounts(ctx));
  }));

  router.get('/channels', guard('read', async (req, res, ctx) => {
    assertChannelsEnabled();
    const includeArchived = req.query?.includeArchived === 'true';

    let q = supabaseAdmin.from('task_channels')
      .select(CHANNEL_COLUMNS).eq('workspace_id', ctx.workspaceId);
    if (!includeArchived) q = q.is('archived_at', null);
    const { data, error } = await q.order('position').order('created_at');
    if (error) throw mapDbError(error, 'list channels');

    const rows = (data ?? []) as any[];

    // Restricted channels are filtered by the SAME predicate the read guard enforces, so a
    // channel a caller cannot open never appears in their list either.
    const memberships = await memberChannelIds(ctx);
    const visible = rows.filter(c =>
      c.visibility !== 'restricted' ||
      perm.isManager(ctx.role) ||
      memberships.has(c.id)
    );

    const unread = await unreadCounts(ctx, visible.map(c => c.id));
    const unreadById = new Map(unread.map(u => [u.channelId, u]));

    ok(res, visible.map(c => ({
      ...c,
      unreadCount: unreadById.get(c.id)?.unreadCount ?? 0,
      lastReadAt: unreadById.get(c.id)?.lastReadAt ?? null
    })));
  }));

  router.post('/channels', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    perm.assertCanManageChannels(ctx.role);
    const actor = requireResolvedActor(ctx.actor);

    const name = v.requireString(req.body?.name, 'name', 1, CHANNEL_NAME_MAX);
    // Always derived from the display name; a client-supplied slug is never honoured.
    const slug = slugifyChannelName(name);
    const description = v.optionalString(req.body?.description, 'description', CHANNEL_DESCRIPTION_MAX);
    const visibility = v.optionalEnum(req.body?.visibility, 'visibility', CHANNEL_VISIBILITIES)
      ?? 'workspace';
    const spaceId = v.optionalUuid(req.body?.spaceId, 'spaceId');
    const position = Number(req.body?.position ?? 1000);

    const { data, error } = await supabaseAdmin.from('task_channels')
      .insert({
        workspace_id: ctx.workspaceId, space_id: spaceId, name, slug, description,
        visibility, position, created_by: actor.actorId, updated_by: actor.actorId
      })
      .select(CHANNEL_COLUMNS).single();
    if (error) {
      if (error.code === '23505') {
        throw invalid('A channel with that name already exists in this workspace.');
      }
      throw mapDbError(error, 'create channel');
    }

    // The creator of a restricted channel is added to it, otherwise a manager could create a
    // channel that even they are only inside by virtue of being a manager.
    if (visibility === 'restricted') {
      await supabaseAdmin.from('task_channel_members').insert({
        workspace_id: ctx.workspaceId, channel_id: (data as any).id,
        actor_id: actor.actorId, role: 'moderator', added_by: actor.actorId
      });
    }

    await recordActivity(ctx, 'channel', (data as any).id, 'CHANNEL_CREATED', { name, visibility });
    ok(res, data);
  }));

  /**
   * Update, reorder, archive and restore are one route because they are one operation on one
   * row under one version check — splitting them would let two of them race each other.
   */
  router.patch('/channels/:channelId', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    perm.assertCanManageChannels(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    const version = v.requireVersion(req.body?.version);

    const patch: Record<string, unknown> = {
      version: version + 1, updated_by: actor.actorId, updated_at: new Date().toISOString()
    };
    if (req.body?.name !== undefined) {
      const name = v.requireString(req.body.name, 'name', 1, CHANNEL_NAME_MAX);
      patch.name = name;
      patch.slug = slugifyChannelName(name);
    }
    if (req.body?.description !== undefined) {
      patch.description = v.optionalString(req.body.description, 'description', CHANNEL_DESCRIPTION_MAX);
    }
    if (req.body?.visibility !== undefined) {
      patch.visibility = v.requireEnum(req.body.visibility, 'visibility', CHANNEL_VISIBILITIES);
    }
    if (req.body?.spaceId !== undefined) {
      patch.space_id = v.optionalUuid(req.body.spaceId, 'spaceId');
    }
    if (req.body?.position !== undefined) patch.position = Number(req.body.position);
    if (req.body?.archived === true) patch.archived_at = new Date().toISOString();
    if (req.body?.archived === false) patch.archived_at = null;

    const { data, error } = await supabaseAdmin.from('task_channels')
      .update(patch)
      .eq('workspace_id', ctx.workspaceId).eq('id', channelId).eq('version', version)
      .select(CHANNEL_COLUMNS);
    if (error) {
      if (error.code === '23505') {
        throw invalid('A channel with that name already exists in this workspace.');
      }
      throw mapDbError(error, 'update channel');
    }
    if (!data || data.length === 0) {
      // Distinguish "gone" from "stale" without leaking anything: both are scoped to this
      // workspace, so a channel in another tenant reads as not-found either way.
      const { data: exists } = await supabaseAdmin.from('task_channels')
        .select('id').eq('workspace_id', ctx.workspaceId).eq('id', channelId).maybeSingle();
      throw exists ? versionConflict() : notFound('Channel');
    }

    await recordActivity(ctx, 'channel', channelId, 'CHANNEL_UPDATED',
      { fields: Object.keys(patch).filter(k => k !== 'version' && k !== 'updated_by') });
    ok(res, data[0]);
  }));

  /**
   * Replaces a restricted channel's membership set. Manager-only.
   *
   * Not in the original route list, but a restricted channel is unusable without it: the
   * visibility mode is specified, and something has to be able to populate it.
   */
  router.put('/channels/:channelId/members', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    perm.assertCanManageChannels(ctx.role);
    const actor = requireResolvedActor(ctx.actor);
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    await loadChannel(ctx, channelId);

    const raw = Array.isArray(req.body?.members) ? req.body.members : null;
    if (!raw) throw invalid('members must be an array.');
    if (raw.length > 500) throw invalid('A channel may have at most 500 members.');

    const next = raw.map((m: any, i: number) => ({
      actorId: v.requireUuid(m?.actorId, `members[${i}].actorId`),
      role: v.optionalEnum(m?.role, `members[${i}].role`, CHANNEL_MEMBER_ROLES) ?? 'member'
    }));
    const seen = new Set<string>();
    for (const m of next) {
      if (seen.has(m.actorId)) throw invalid('members contains a duplicate actorId.');
      seen.add(m.actorId);
    }

    // Replace rather than merge, so the submitted set IS the membership. Scoped to the
    // workspace and the channel on both statements.
    const del = await supabaseAdmin.from('task_channel_members').delete()
      .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId);
    if (del.error) throw mapDbError(del.error, 'replace channel members');

    if (next.length) {
      const ins = await supabaseAdmin.from('task_channel_members').insert(
        next.map(m => ({
          workspace_id: ctx.workspaceId, channel_id: channelId,
          actor_id: m.actorId, role: m.role, added_by: actor.actorId
        }))
      );
      // A 23503 here means an actorId that does not belong to this workspace: the composite FK
      // to task_workspace_actors (workspace_id, id) has nothing to resolve against.
      if (ins.error) throw mapDbError(ins.error, 'add channel members');
    }

    await recordActivity(ctx, 'channel', channelId, 'CHANNEL_MEMBERS_REPLACED',
      { count: next.length });
    ok(res, { channelId, members: next });
  }));

  // ── Messages ─────────────────────────────────────────────────────────────────────────

  /**
   * Message history and polling in one route.
   *
   *   ?after=<cursor>   -> everything strictly after the cursor, oldest first. The poll path.
   *   ?before=<cursor>  -> the page immediately before the cursor. The scroll-back path.
   *   (neither)         -> the most recent page.
   *
   * Both directions return messages in ascending order so a client always appends or prepends
   * a contiguous, already-sorted run.
   */
  router.get('/channels/:channelId/messages', guard('read', async (req, res, ctx) => {
    assertChannelsEnabled();
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    await loadReadableChannel(ctx, channelId);

    const limit = parseMessageLimit(req.query?.limit);
    const after = decodeCursor(req.query?.after, 'after');
    const before = decodeCursor(req.query?.before, 'before');
    if (after && before) throw invalid('Provide only one of `after` or `before`.');

    const base = () => supabaseAdmin.from('task_channel_messages')
      .select(MESSAGE_COLUMNS)
      .eq('workspace_id', ctx.workspaceId)
      .eq('channel_id', channelId);

    let rows: any[];
    let hasMoreBefore = false;

    if (after) {
      const { data, error } = await base()
        .gte('created_at', after.createdAt)
        .order('created_at', { ascending: true }).order('id', { ascending: true })
        .limit(limit + CURSOR_OVERLAP);
      if (error) throw mapDbError(error, 'poll messages');
      rows = trimToStrictlyAfter((data ?? []) as any[], after).slice(0, limit);
    } else {
      // Newest-first window, then reversed, so "the last N" is one index range scan.
      let q = base()
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .limit(limit + CURSOR_OVERLAP + 1);
      if (before) q = q.lte('created_at', before.createdAt);
      const { data, error } = await q;
      if (error) throw mapDbError(error, 'list messages');
      const trimmed = trimToStrictlyBefore((data ?? []) as any[], before);
      hasMoreBefore = trimmed.length > limit;
      rows = trimmed.slice(0, limit).reverse();
    }

    const messages = rows.map(presentMessage);
    ok(res, messages, {
      page: {
        limit,
        // The cursor a poller should send next. Unchanged when the page is empty, so an idle
        // poll never advances past a message it has not seen.
        nextAfter: messages.length ? messages[messages.length - 1].cursor : (after ? encodeCursor(after) : null),
        // The cursor to scroll back from, and whether anything remains behind it.
        nextBefore: messages.length ? messages[0].cursor : (before ? encodeCursor(before) : null),
        hasMoreBefore
      }
    });
  }));

  router.post('/channels/:channelId/messages', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    const actor = requireResolvedActor(ctx.actor);
    perm.assertCanPostMessage(ctx.role);

    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    const channel = await loadReadableChannel(ctx, channelId);
    if (channel.archived_at) throw channelArchived();

    const body = sanitizeMessageBody(req.body?.body);
    const clientToken = optionalClientToken(req.body?.clientToken);
    const parentMessageId = v.optionalUuid(req.body?.parentMessageId, 'parentMessageId');

    // Cheap, process-local rejection first so a runaway client is refused without a query.
    const verdict = sendLimiter.check(rateLimitKey(ctx.workspaceId, actor.actorId));
    if (!verdict.allowed) throw rateLimited(verdict.retryAfterMs);

    // Authoritative, instance-independent backstop: the limiter above lives in one serverless
    // instance's memory, so on its own it can be bypassed simply by being load-balanced onto
    // a cold one. This counts what actually landed in the table.
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentCount, error: rlErr } = await supabaseAdmin
      .from('task_channel_messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ctx.workspaceId)
      .eq('author_actor_id', actor.actorId)
      .gte('created_at', since);
    if (rlErr) throw mapDbError(rlErr, 'rate limit check');
    if ((recentCount ?? 0) >= RATE_LIMIT_MAX_SENDS) throw rateLimited(RATE_LIMIT_WINDOW_MS);

    if (parentMessageId) {
      // Read the parent within this workspace AND channel. The composite FK would reject a
      // cross-channel parent anyway, but checking first turns a constraint violation into a
      // precise 404/409 rather than a generic one.
      const { data: parent, error: pErr } = await supabaseAdmin.from('task_channel_messages')
        .select('id, deleted_at, parent_message_id')
        .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId)
        .eq('id', parentMessageId).maybeSingle();
      if (pErr) throw mapDbError(pErr, 'load parent message');
      if (!parent) throw notFound('Message');
      if ((parent as any).deleted_at) throw messageDeleted();
      // One level of threading, matching the subtask rule elsewhere in the module: a reply
      // to a reply attaches to the same root, so a thread can never become a deep tree.
      if ((parent as any).parent_message_id) {
        throw invalid('Replies are one level deep. Reply to the original message instead.');
      }
    }

    // created_at/updated_at are column defaults: the server clock is the only clock.
    const insert = {
      workspace_id: ctx.workspaceId, channel_id: channelId,
      author_actor_id: actor.actorId, body,
      parent_message_id: parentMessageId, client_token: clientToken
    };

    const { data, error } = await supabaseAdmin.from('task_channel_messages')
      .insert(insert).select(MESSAGE_COLUMNS).single();

    if (error) {
      // Idempotency. A retry of the same intent returns the ORIGINAL message rather than
      // creating a second one, and reports which happened so a client can tell them apart.
      if (error.code === '23505' && clientToken) {
        const { data: existing, error: exErr } = await supabaseAdmin.from('task_channel_messages')
          .select(MESSAGE_COLUMNS)
          .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId)
          .eq('author_actor_id', actor.actorId).eq('client_token', clientToken)
          .maybeSingle();
        if (exErr) throw mapDbError(exErr, 'resolve duplicate message');
        if (existing) {
          return ok(res, presentMessage(existing), { outcome: 'duplicate' });
        }
      }
      throw mapDbError(error, 'send message');
    }

    await recordActivity(ctx, 'channel_message', (data as any).id, 'CHANNEL_MESSAGE_SENT',
      { channelId, isReply: !!parentMessageId });
    ok(res, presentMessage(data), { outcome: 'created' });
  }));

  /** Loads a message scoped to workspace AND channel. There is no unscoped message lookup. */
  async function loadMessage(ctx: Ctx, channelId: string, messageId: string) {
    const { data, error } = await supabaseAdmin.from('task_channel_messages')
      .select(MESSAGE_COLUMNS)
      .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId)
      .eq('id', messageId).maybeSingle();
    if (error) throw mapDbError(error, 'load message');
    if (!data) throw notFound('Message');
    return data as any;
  }

  router.patch('/channels/:channelId/messages/:messageId', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    const actor = requireResolvedActor(ctx.actor);
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    const messageId = v.requireUuid(req.params.messageId, 'messageId');
    const channel = await loadReadableChannel(ctx, channelId);
    if (channel.archived_at) throw channelArchived();

    const message = await loadMessage(ctx, channelId, messageId);
    if (message.deleted_at) throw messageDeleted();

    perm.assertCanEditMessage(ctx.role, actor.actorId, message);
    if (!isWithinEditWindow(message.created_at)) {
      throw editWindowClosed(Math.round(EDIT_WINDOW_MS / 60000));
    }

    const body = sanitizeMessageBody(req.body?.body);
    const now = new Date().toISOString();

    // author_actor_id is re-asserted in the WHERE clause, not just checked above: even if a
    // future refactor weakened the permission call, the statement itself can only ever touch
    // a row this actor authored.
    const { data, error } = await supabaseAdmin.from('task_channel_messages')
      .update({ body, edited_at: now, updated_at: now })
      .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId)
      .eq('id', messageId).eq('author_actor_id', actor.actorId)
      .is('deleted_at', null)
      .select(MESSAGE_COLUMNS);
    if (error) throw mapDbError(error, 'edit message');
    if (!data || data.length === 0) throw notFound('Message');

    await recordActivity(ctx, 'channel_message', messageId, 'CHANNEL_MESSAGE_EDITED', { channelId });
    ok(res, presentMessage(data[0]));
  }));

  /** Soft delete. The row and its thread position survive; the body does not. */
  router.delete('/channels/:channelId/messages/:messageId', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    const actor = requireResolvedActor(ctx.actor);
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    const messageId = v.requireUuid(req.params.messageId, 'messageId');
    await loadReadableChannel(ctx, channelId);

    const message = await loadMessage(ctx, channelId, messageId);
    if (message.deleted_at) {
      // Already gone. Idempotent rather than an error: a retried delete is not a failure.
      return ok(res, presentMessage(message), { outcome: 'already_deleted' });
    }
    perm.assertCanDeleteMessage(ctx.role, actor.actorId, message);

    const moderated = message.author_actor_id !== actor.actorId;
    const now = new Date().toISOString();

    let q = supabaseAdmin.from('task_channel_messages')
      .update({ deleted_at: now, deleted_by: actor.actorId, updated_at: now })
      .eq('workspace_id', ctx.workspaceId).eq('channel_id', channelId).eq('id', messageId)
      .is('deleted_at', null);
    // A non-manager can only ever address their own row, enforced in the statement as well as
    // in the permission check above.
    if (!perm.isManager(ctx.role)) q = q.eq('author_actor_id', actor.actorId);

    const { data, error } = await q.select(MESSAGE_COLUMNS);
    if (error) throw mapDbError(error, 'delete message');
    if (!data || data.length === 0) throw notFound('Message');

    await recordActivity(ctx, 'channel_message', messageId,
      moderated ? 'CHANNEL_MESSAGE_MODERATED' : 'CHANNEL_MESSAGE_DELETED', { channelId });
    ok(res, presentMessage(data[0]), { outcome: moderated ? 'moderated' : 'deleted' });
  }));

  // ── Read state ───────────────────────────────────────────────────────────────────────

  router.post('/channels/:channelId/read', guard('mutate', async (req, res, ctx) => {
    assertChannelsEnabled();
    const actor = requireResolvedActor(ctx.actor);
    const channelId = v.requireUuid(req.params.channelId, 'channelId');
    await loadReadableChannel(ctx, channelId);

    // The caller may name the message they have read up to; the TIMESTAMP is always taken
    // from that message's own server-assigned created_at, never from the request. Without a
    // message id the cursor advances to now().
    const messageId = v.optionalUuid(req.body?.lastReadMessageId, 'lastReadMessageId');
    let lastReadAt = new Date().toISOString();
    if (messageId) {
      const m = await loadMessage(ctx, channelId, messageId);
      lastReadAt = m.created_at;
    }

    const { data, error } = await supabaseAdmin.from('task_channel_reads')
      .upsert({
        workspace_id: ctx.workspaceId, channel_id: channelId, actor_id: actor.actorId,
        last_read_at: lastReadAt, last_read_message_id: messageId,
        updated_at: new Date().toISOString()
      }, { onConflict: 'workspace_id,channel_id,actor_id' })
      .select('channel_id, last_read_at, last_read_message_id').single();
    if (error) throw mapDbError(error, 'mark channel read');

    ok(res, {
      channelId,
      lastReadAt: (data as any).last_read_at,
      lastReadMessageId: (data as any).last_read_message_id,
      unreadCount: 0
    });
  }));

  /** Channel ids the current actor holds a membership row for. */
  async function memberChannelIds(ctx: Ctx): Promise<Set<string>> {
    if (!ctx.actor) return new Set();
    const { data, error } = await supabaseAdmin.from('task_channel_members')
      .select('channel_id')
      .eq('workspace_id', ctx.workspaceId).eq('actor_id', ctx.actor.actorId);
    if (error) throw mapDbError(error, 'channel memberships');
    return new Set((data ?? []).map((r: any) => r.channel_id));
  }

  /**
   * Unread counts for the channels the caller can see.
   *
   * One head-count per channel, fanned out in parallel. The channel set is small and
   * manager-curated, so this stays a handful of index-only counts rather than growing with
   * the message table. A caller's own messages are excluded (sending is reading) and deleted
   * messages are excluded, so moderating a message clears the badge it created rather than
   * leaving an unread nobody can ever dismiss.
   */
  async function unreadCounts(ctx: Ctx, restrictTo?: string[]) {
    if (!ctx.actor) return [];

    let cq = supabaseAdmin.from('task_channels')
      .select('id, visibility')
      .eq('workspace_id', ctx.workspaceId).is('archived_at', null);
    if (restrictTo) {
      if (restrictTo.length === 0) return [];
      cq = cq.in('id', restrictTo);
    }
    const { data: channels, error: cErr } = await cq;
    if (cErr) throw mapDbError(cErr, 'unread channels');

    /**
     * When `restrictTo` is given the caller has ALREADY applied the visibility filter (see
     * GET /channels), so re-applying it here would be duplicated work. When it is absent —
     * the GET /channels/unread path — this is the only place the filter runs, so it must,
     * otherwise unread badges would reveal the existence and traffic of restricted channels
     * the caller cannot open.
     */
    let visible = (channels ?? []) as any[];
    if (!restrictTo) {
      const memberships = await memberChannelIds(ctx);
      visible = visible.filter(c =>
        c.visibility !== 'restricted' ||
        perm.isManager(ctx.role) ||
        memberships.has(c.id)
      );
    }
    if (!visible.length) return [];

    const { data: reads, error: rErr } = await supabaseAdmin.from('task_channel_reads')
      .select('channel_id, last_read_at')
      .eq('workspace_id', ctx.workspaceId).eq('actor_id', ctx.actor.actorId)
      .in('channel_id', visible.map((c: any) => c.id));
    if (rErr) throw mapDbError(rErr, 'read cursors');
    const readAt = new Map((reads ?? []).map((r: any) => [r.channel_id, r.last_read_at]));

    return Promise.all(visible.map(async (c: any) => {
      let q = supabaseAdmin.from('task_channel_messages')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('channel_id', c.id)
        .is('deleted_at', null)
        .neq('author_actor_id', ctx.actor!.actorId);
      const since = readAt.get(c.id);
      if (since) q = q.gt('created_at', since);
      const { count, error } = await q;
      if (error) throw mapDbError(error, 'unread count');
      return { channelId: c.id, unreadCount: count ?? 0, lastReadAt: since ?? null };
    }));
  }
}

/** Test seam: lets the pure-logic suite exercise limiter state without a server. */
export const __sendLimiterForTests = sendLimiter;

/** Re-exported so a caller can assert the guard chain refused before any query ran. */
export { TaskError };
