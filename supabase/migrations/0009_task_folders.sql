-- 0009_task_folders.sql
--
-- Adds an OPTIONAL grouping level between Space and List:
--
--   Space -> [Folder] -> List -> Task -> Subtask
--
-- Purely additive. Every existing List gets folder_id = NULL, which means "direct child of
-- its Space" — exactly the position every existing List already occupies today. No existing
-- Space, List, status, task, assignment, or time entry row is touched by this migration, and
-- no existing List is auto-assigned into a Folder (the "Operations HQ" List in particular
-- stays a List until a manager explicitly converts it through the API added alongside this).
--
-- SAME COMPOSITE-TENANT-SAFETY IDIOM AS 0006:
-- task_folders carries workspace_id redundantly and exposes TWO unique keys for two different
-- composite-FK purposes, matching the multi-key pattern task_items already uses:
--   task_folders_tenant_key       (workspace_id, id)            -- generic composite-FK target
--   task_folders_space_key        (workspace_id, space_id, id)  -- SAME-SPACE-enforcing target
-- task_lists.folder_id's FK targets the second one, via (workspace_id, space_id, folder_id).
-- That is what makes "a List's Folder must belong to the same Space as the List" a structural
-- guarantee rather than an application-level check that a future caller could forget — the
-- exact mechanism 0006 already uses for the one-level subtask cap and every parent/child edge
-- in this schema. It is also what makes a cross-Space OR cross-workspace move impossible at
-- the database layer: moving a List to a Folder in a different Space, or a caller attempting
-- to attach a Folder from a different workspace_id, has no matching row in task_folders for
-- the FK to resolve against, so the UPDATE is rejected before it can commit.

create table if not exists public.task_folders (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  space_id      uuid not null,
  name          text not null check (length(trim(name)) between 1 and 120),
  description   text check (description is null or length(description) <= 2000),
  position      numeric not null default 1000,
  version       integer not null default 1 check (version > 0),
  archived_at   timestamptz,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint task_folders_tenant_key unique (workspace_id, id),
  constraint task_folders_space_key unique (workspace_id, space_id, id),
  constraint task_folders_space_fk foreign key (workspace_id, space_id)
    references public.task_spaces (workspace_id, id) on delete cascade,
  constraint task_folders_created_by_fk foreign key (workspace_id, created_by)
    references public.task_workspace_actors (workspace_id, id),
  constraint task_folders_updated_by_fk foreign key (workspace_id, updated_by)
    references public.task_workspace_actors (workspace_id, id)
);

-- Case-insensitive name uniqueness among LIVE folders within the SAME Space only (mirrors
-- task_spaces_unique_live_name / task_lists_unique_live_name).
create unique index if not exists task_folders_unique_live_name
  on public.task_folders (space_id, lower(name)) where archived_at is null;

-- Hierarchy navigation and ordering (sidebar tree) — same shape as task_lists_ws_space_position_idx.
create index if not exists task_folders_ws_space_position_idx
  on public.task_folders (workspace_id, space_id, position) where archived_at is null;
create index if not exists task_folders_ws_archived_idx
  on public.task_folders (workspace_id, archived_at);

drop trigger if exists task_folders_set_updated_at on public.task_folders;
create trigger task_folders_set_updated_at before update on public.task_folders
  for each row execute function public.set_updated_at();

-- ── task_lists.folder_id ────────────────────────────────────────────────────────────────
-- Nullable: NULL means "direct child of the Space" (every existing List today). Setting it
-- moves the List under a Folder; the Folder must belong to the SAME Space (enforced by the
-- composite FK below, not by application code) and the SAME workspace (enforced the same way,
-- since every column in the FK is workspace-qualified).
alter table public.task_lists add column if not exists folder_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_lists_folder_fk'
  ) then
    alter table public.task_lists
      add constraint task_lists_folder_fk
      foreign key (workspace_id, space_id, folder_id)
      references public.task_folders (workspace_id, space_id, id)
      on delete set null;
  end if;
end $$;

-- A List's own tenant-space key, so future tables (e.g. a per-List setting keyed on
-- (workspace_id, space_id, list_id)) can FK against it the same way task_folders does.
-- Not required by anything in this migration, but kept for idiom consistency; harmless if
-- unused.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'task_lists_space_key'
  ) then
    alter table public.task_lists
      add constraint task_lists_space_key unique (workspace_id, space_id, id);
  end if;
end $$;

create index if not exists task_lists_folder_idx
  on public.task_lists (folder_id) where archived_at is null;

-- Ordering within a Folder needs its own scope: task_lists_one_default_per_space (0006) is
-- INTENTIONALLY left untouched — the default List concept stays Space-scoped ("General" is
-- always a direct child of its Space per the target hierarchy), so no List inside a Folder
-- can be a Space's default. That is already guaranteed by the existing partial index without
-- any change here.

-- ── Activity feed: widen entity_type to include 'folder' ──────────────────────────────────
-- The ONE non-purely-additive change in this migration: task_activity_events.entity_type
-- (0006) is a CHECK constraint, not an enum, and only WIDENING it is safe — it accepts every
-- value it already did, plus 'folder'. No existing row's entity_type changes; nothing that
-- currently satisfies the constraint stops satisfying it. Kept in the SAME activity table as
-- Space/List/status/task rather than a separate log, because Folders are part of the same
-- task hierarchy those events already describe, not an independent feature area.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'task_activity_events_entity_type_check'
      and pg_get_constraintdef(oid) not like '%''folder''%'
  ) then
    alter table public.task_activity_events
      drop constraint task_activity_events_entity_type_check;
    alter table public.task_activity_events
      add constraint task_activity_events_entity_type_check
      check (entity_type in
        ('space', 'list', 'status', 'task', 'assignment', 'time_entry', 'folder'));
  end if;
end $$;

-- ── RLS and table privileges ──────────────────────────────────────────────────────────
-- Identical posture to every other task_* table (0008): RLS enabled with zero policies is
-- deny-all for anon/authenticated, but that alone does not grant service_role access — table
-- privileges are a separate mechanism. Without the explicit grant below, service_role would
-- ALSO be refused (no privilege to bypass RLS against), silently breaking every Folder route.
-- anon/authenticated are revoked explicitly, INCLUDING the privileges Supabase grants by
-- default, matching why migration 0003 had to exist for the original task tables.
alter table public.task_folders enable row level security;
revoke all on table public.task_folders from public;
revoke all on table public.task_folders from anon;
revoke all on table public.task_folders from authenticated;
grant select, insert, update, delete on table public.task_folders to service_role;
grant all on table public.task_folders to postgres;
