-- 0008_task_rls_grants_indexes.sql
--
-- Security posture and access-path indexes for the Task Management module.
--
-- SECURITY MODEL — identical to the pattern established by migrations 0001-0003:
--   * RLS enabled on every table, with NO policies. Enabled-with-no-policies is deny-all
--     for anon/authenticated; service_role bypasses RLS and is the only accessor.
--   * Table privileges granted ONLY to service_role and postgres.
--   * anon/authenticated explicitly revoked, INCLUDING TRUNCATE. This is not redundant:
--     RLS does not gate TRUNCATE, and Supabase's default privileges leave those roles
--     holding it. Migration 0003 exists solely because that was missed the first time.
--   * Function EXECUTE revoked from public/anon/authenticated and granted only to
--     service_role, so no browser role can invoke the timer or space RPCs directly.

-- ── RLS: enable everywhere, define no policies ────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'task_principals','task_workspace_actors','task_spaces','task_lists','task_statuses',
    'task_items','task_assignments','task_time_entries','task_activity_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ── Table privileges ──────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'task_principals','task_workspace_actors','task_spaces','task_lists','task_statuses',
    'task_items','task_assignments','task_time_entries','task_activity_events'
  ] loop
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
    execute format('grant all on table public.%I to postgres', t);
  end loop;
end $$;

-- ── Function privileges ───────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.task_create_space(text, text, uuid)',
    'public.task_timer_start(text, uuid, uuid, uuid, uuid)',
    'public.task_timer_stop(text, uuid, uuid)',
    'public.task_close_active_timers(text, text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('revoke all on function %s from authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- INDEXES — one per real access path used by the router.
-- ══════════════════════════════════════════════════════════════════════════════════════

-- Hierarchy navigation and ordering (sidebar tree).
create index if not exists task_spaces_ws_position_idx
  on public.task_spaces (workspace_id, position) where archived_at is null;
create index if not exists task_spaces_ws_archived_idx
  on public.task_spaces (workspace_id, archived_at);

create index if not exists task_lists_ws_space_position_idx
  on public.task_lists (workspace_id, space_id, position) where archived_at is null;
create index if not exists task_lists_ws_archived_idx
  on public.task_lists (workspace_id, archived_at);

create index if not exists task_statuses_space_position_idx
  on public.task_statuses (space_id, position) where archived_at is null;
create index if not exists task_statuses_ws_idx
  on public.task_statuses (workspace_id);

-- List view: default ordering within a list.
create index if not exists task_items_ws_list_position_idx
  on public.task_items (workspace_id, list_id, position) where archived_at is null;
-- Board view: grouping by status column.
create index if not exists task_items_ws_status_position_idx
  on public.task_items (workspace_id, status_id, position) where archived_at is null;
-- Subtask expansion.
create index if not exists task_items_parent_idx
  on public.task_items (parent_task_id) where parent_task_id is not null;
-- Filters and sorts.
create index if not exists task_items_ws_due_idx
  on public.task_items (workspace_id, due_date) where archived_at is null and due_date is not null;
create index if not exists task_items_ws_updated_idx
  on public.task_items (workspace_id, updated_at desc);
create index if not exists task_items_ws_priority_idx
  on public.task_items (workspace_id, priority) where archived_at is null;
-- Archive browsing / restore.
create index if not exists task_items_ws_archived_idx
  on public.task_items (workspace_id, archived_at) where archived_at is not null;
-- Free-text search on title. Trigram would need pg_trgm; a tsvector index covers the
-- prefix/word search the UI performs without adding an extension dependency.
create index if not exists task_items_title_search_idx
  on public.task_items using gin (to_tsvector('simple', coalesce(title, '')));

-- Assignment lookups in both directions ("tasks assigned to me" / "who is on this task").
create index if not exists task_assignments_actor_idx
  on public.task_assignments (workspace_id, actor_id);
create index if not exists task_assignments_task_idx
  on public.task_assignments (task_id);

-- Time summaries: by member, by task, and live-timer recovery.
create index if not exists task_time_entries_ws_actor_started_idx
  on public.task_time_entries (workspace_id, actor_id, started_at desc) where archived_at is null;
create index if not exists task_time_entries_ws_task_idx
  on public.task_time_entries (workspace_id, task_id) where archived_at is null;
create index if not exists task_time_entries_principal_idx
  on public.task_time_entries (principal_id, started_at desc);

-- Activity feed.
create index if not exists task_activity_ws_created_idx
  on public.task_activity_events (workspace_id, created_at desc);
create index if not exists task_activity_entity_idx
  on public.task_activity_events (entity_type, entity_id);
