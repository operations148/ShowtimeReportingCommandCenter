-- 0006_task_hierarchy.sql
--
-- Spaces -> Lists -> Tasks -> Subtasks (one level), plus per-Space statuses and assignments.
-- Folders are deliberately out of scope for V1.
--
-- TENANT SAFETY IS STRUCTURAL, NOT PROCEDURAL.
-- Every child references its parent through a COMPOSITE key that includes workspace_id, so
-- a row in Workspace A physically cannot reference a Space/List/status/task/actor from
-- Workspace B — even if application code forgot a filter or a caller supplied a foreign id.
-- Each parent therefore carries a redundant-looking UNIQUE (workspace_id, id); that
-- constraint exists purely to be the target of those composite foreign keys.
--
-- OPTIMISTIC CONCURRENCY: every mutable table carries `version int`. PATCH supplies the
-- expected version, the UPDATE matches on it, and a 0-row result becomes HTTP 409. This
-- prevents two editors silently overwriting each other in a board/list UI.
--
-- ACTOR FOREIGN KEYS USE NO ON DELETE ACTION, DELIBERATELY.
-- These are composite keys of the form (workspace_id, created_by). ON DELETE SET NULL would
-- null EVERY referencing column, including workspace_id, which is NOT NULL — so deleting an
-- actor would raise a not-null violation rather than clearing the reference. (Postgres 15+
-- can restrict which columns are nulled, but depending on that would tie these migrations to
-- a server version.) Actors are soft-archived via archived_at and are never hard-deleted, so
-- the default NO ACTION is both correct and version-independent: it simply refuses to delete
-- an actor that still owns records.

-- ── Spaces ────────────────────────────────────────────────────────────────────────────
create table if not exists public.task_spaces (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  position      numeric not null default 1000,
  version       integer not null default 1 check (version > 0),
  archived_at   timestamptz,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint task_spaces_tenant_key unique (workspace_id, id),
  constraint task_spaces_created_by_fk foreign key (workspace_id, created_by)
    references public.task_workspace_actors (workspace_id, id),
  constraint task_spaces_updated_by_fk foreign key (workspace_id, updated_by)
    references public.task_workspace_actors (workspace_id, id)
);

-- Case-insensitive name uniqueness among LIVE spaces only, so an archived space never
-- blocks reuse of its name.
create unique index if not exists task_spaces_unique_live_name
  on public.task_spaces (workspace_id, lower(name)) where archived_at is null;

-- ── Lists ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.task_lists (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  space_id      uuid not null,
  name          text not null check (length(trim(name)) between 1 and 120),
  position      numeric not null default 1000,
  is_default    boolean not null default false,
  version       integer not null default 1 check (version > 0),
  archived_at   timestamptz,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint task_lists_tenant_key unique (workspace_id, id),
  -- Composite: the parent Space must live in the SAME workspace.
  constraint task_lists_space_fk foreign key (workspace_id, space_id)
    references public.task_spaces (workspace_id, id) on delete cascade,
  constraint task_lists_created_by_fk foreign key (workspace_id, created_by)
    references public.task_workspace_actors (workspace_id, id),
  constraint task_lists_updated_by_fk foreign key (workspace_id, updated_by)
    references public.task_workspace_actors (workspace_id, id)
);

create unique index if not exists task_lists_unique_live_name
  on public.task_lists (workspace_id, space_id, lower(name)) where archived_at is null;
-- At most one default List per Space.
create unique index if not exists task_lists_one_default_per_space
  on public.task_lists (space_id) where is_default and archived_at is null;

-- ── Statuses (per Space) ──────────────────────────────────────────────────────────────
create table if not exists public.task_statuses (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  space_id      uuid not null,
  name          text not null check (length(trim(name)) between 1 and 60),
  -- Board grouping semantics. 'done' drives completion reporting without string matching.
  category      text not null check (category in ('todo', 'in_progress', 'done')),
  color         text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  position      numeric not null default 1000,
  is_default    boolean not null default false,
  version       integer not null default 1 check (version > 0),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint task_statuses_tenant_key unique (workspace_id, id),
  constraint task_statuses_space_fk foreign key (workspace_id, space_id)
    references public.task_spaces (workspace_id, id) on delete cascade
);

create unique index if not exists task_statuses_unique_live_name
  on public.task_statuses (space_id, lower(name)) where archived_at is null;
create unique index if not exists task_statuses_one_default_per_space
  on public.task_statuses (space_id) where is_default and archived_at is null;

-- ── Tasks and subtasks ────────────────────────────────────────────────────────────────
create table if not exists public.task_items (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null references public.workspaces(id) on delete cascade,
  list_id               uuid not null,
  status_id             uuid not null,
  parent_task_id        uuid,

  title                 text not null check (length(trim(title)) between 1 and 500),
  description           text check (description is null or length(description) <= 20000),
  priority              text not null default 'normal'
                          check (priority in ('urgent', 'high', 'normal', 'low')),
  start_date            timestamptz,
  due_date              timestamptz,
  time_estimate_seconds integer check (time_estimate_seconds is null
                          or (time_estimate_seconds >= 0 and time_estimate_seconds <= 3153600000)),

  position              numeric not null default 1000,
  version               integer not null default 1 check (version > 0),
  archived_at           timestamptz,
  created_by            uuid,
  updated_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- ONE SUBTASK LEVEL, ENFORCED DECLARATIVELY (not by application code and not by a trigger).
  -- is_root marks tasks that may legally be a parent. parent_is_root is NULL for root tasks
  -- (so MATCH SIMPLE skips the FK entirely) and TRUE for subtasks, which forces the composite
  -- FK below to resolve against a row whose is_root is TRUE. A subtask therefore cannot be
  -- the parent of another subtask: depth is capped at 2 by the constraint system itself.
  is_root               boolean generated always as (parent_task_id is null) stored,
  parent_is_root        boolean generated always as
                          (case when parent_task_id is null then null else true end) stored,

  constraint task_items_tenant_key unique (workspace_id, id),
  -- Target for the same-list composite FK below.
  constraint task_items_tenant_list_key unique (workspace_id, list_id, id),
  -- Target for the one-level FK below.
  constraint task_items_root_key unique (id, is_root),

  constraint task_items_list_fk foreign key (workspace_id, list_id)
    references public.task_lists (workspace_id, id) on delete cascade,
  constraint task_items_status_fk foreign key (workspace_id, status_id)
    references public.task_statuses (workspace_id, id),

  -- A subtask must sit in the SAME workspace AND the SAME list as its parent.
  constraint task_items_parent_same_list_fk
    foreign key (workspace_id, list_id, parent_task_id)
    references public.task_items (workspace_id, list_id, id) on update cascade on delete cascade,

  -- ...and its parent must itself be a root task.
  constraint task_items_parent_is_root_fk
    foreign key (parent_task_id, parent_is_root)
    references public.task_items (id, is_root),

  constraint task_items_created_by_fk foreign key (workspace_id, created_by)
    references public.task_workspace_actors (workspace_id, id),
  constraint task_items_updated_by_fk foreign key (workspace_id, updated_by)
    references public.task_workspace_actors (workspace_id, id),

  -- A task cannot be its own parent.
  constraint task_items_no_self_parent check (parent_task_id is null or parent_task_id <> id),
  -- Due date may not precede start date.
  constraint task_items_dates_ordered check
    (due_date is null or start_date is null or due_date >= start_date)
);

-- ── Assignments ───────────────────────────────────────────────────────────────────────
create table if not exists public.task_assignments (
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  task_id       uuid not null,
  actor_id      uuid not null,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid,

  primary key (task_id, actor_id),

  constraint task_assignments_task_fk foreign key (workspace_id, task_id)
    references public.task_items (workspace_id, id) on delete cascade,
  -- The assignee must be an actor of the SAME workspace.
  constraint task_assignments_actor_fk foreign key (workspace_id, actor_id)
    references public.task_workspace_actors (workspace_id, id) on delete cascade,
  constraint task_assignments_assigned_by_fk foreign key (workspace_id, assigned_by)
    references public.task_workspace_actors (workspace_id, id)
);

-- ── Auditable history ─────────────────────────────────────────────────────────────────
-- Separate from public.audit_logs on purpose: that table's user_id is uuid REFERENCES-free
-- but typed for Supabase auth users, and GHL SSO writes to it already fail silently today.
-- This table references a workspace actor instead, so SSO-originated events are recorded
-- correctly rather than being swallowed.
create table if not exists public.task_activity_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  actor_id      uuid,
  entity_type   text not null check (entity_type in
                  ('space', 'list', 'status', 'task', 'assignment', 'time_entry')),
  entity_id     uuid not null,
  action        text not null check (length(trim(action)) between 1 and 60),
  -- Safe, non-sensitive summary only. Never tokens, ids of other tenants, or raw errors.
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint task_activity_actor_fk foreign key (workspace_id, actor_id)
    references public.task_workspace_actors (workspace_id, id)
);

-- ── updated_at maintenance (reuses the helper created in 0001) ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['task_principals','task_workspace_actors','task_spaces',
                           'task_lists','task_statuses','task_items']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;
