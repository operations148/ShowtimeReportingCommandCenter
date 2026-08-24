-- 0005_task_identity.sql
--
-- Identity model for the Task Management module.
--
-- TWO LEVELS, DELIBERATELY:
--
--   task_principals        ONE row per real person, GLOBAL (not workspace scoped).
--   task_workspace_actors  ONE row per person PER workspace.
--
-- The split exists because the two concerns have different scopes and collapsing them
-- breaks a hard requirement:
--
--   * Ownership, assignment and created_by/updated_by are per workspace — the same person
--     in two workspaces must not leak identity or assignment across the tenant boundary.
--   * "Only one running timer per person across the application" is GLOBAL. If the timer
--     uniqueness key were the workspace actor, one human could run a timer in Workspace A
--     and a second timer in Workspace B simultaneously, because those are two different
--     actor rows. The unique index in 0007 is therefore keyed on principal_id.
--
-- IDENTITY IS NEVER EMAIL. Email and display name are stored only as UI snapshots and are
-- explicitly not authorization inputs: an email is mutable, can be re-assigned by an admin,
-- and is not verified by the GHL SSO payload. The trusted triple is (source, issuer,
-- external_id) — the issuer pins WHICH authority vouched for the id, so a GHL user id can
-- never collide with a Supabase auth uuid even if the raw strings ever matched.
--
-- FAIL-CLOSED: external_id is NOT NULL and length-checked > 0. The literal 'ghl_sso'
-- fallback that exists elsewhere in this codebase must never become an ownership identity;
-- an SSO session with no verified userId has no principal and is rejected at the API layer
-- (403 TASK_ACTOR_UNRESOLVED) before it can reach this table.

create table if not exists public.task_principals (
  id           uuid primary key default gen_random_uuid(),

  -- Which authentication mechanism vouched for this identity.
  source       text not null check (source in ('supabase', 'ghl_sso')),

  -- Which concrete authority issued external_id. For supabase this is the project ref /
  -- issuer URL; for ghl_sso it is the GHL app/company identifier. Pinning the issuer keeps
  -- ids from two different Supabase projects (or two GHL apps) from being treated as the
  -- same person after a project migration.
  issuer       text not null check (length(trim(issuer)) between 1 and 200),

  -- Verified subject id from that authority. Supabase: auth.users.id. GHL SSO: the signed
  -- userId from the decrypted SSO payload. Never an email, never a placeholder.
  external_id  text not null check (length(trim(external_id)) between 1 and 200),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint task_principals_identity_key unique (source, issuer, external_id)
);

comment on table public.task_principals is
  'Global, server-only identity for Task Management. One row per person across all workspaces. Timer concurrency is keyed here.';
comment on column public.task_principals.external_id is
  'Verified subject id from the issuer. NEVER an email and never the literal ghl_sso fallback.';

create table if not exists public.task_workspace_actors (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  principal_id  uuid not null references public.task_principals(id) on delete cascade,

  -- UI snapshots only. Refreshed opportunistically on resolve. Never used for authorization
  -- or for identifying a person; see the table comment.
  display_name  text check (display_name is null or length(display_name) <= 200),
  email         text check (email is null or length(email) <= 320),

  last_seen_at  timestamptz,
  archived_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One actor row per person per workspace.
  constraint task_workspace_actors_unique unique (workspace_id, principal_id),

  -- Enables composite tenant-aware foreign keys from every table that references an actor,
  -- so a task in Workspace A can never point at an actor belonging to Workspace B.
  constraint task_workspace_actors_tenant_key unique (workspace_id, id)
);

comment on table public.task_workspace_actors is
  'Per-workspace projection of a global principal. Assignments and created_by/updated_by reference this, never task_principals directly.';
comment on column public.task_workspace_actors.email is
  'UI snapshot only. Not an authorization input and not an identity key.';

create index if not exists task_workspace_actors_workspace_idx
  on public.task_workspace_actors (workspace_id) where archived_at is null;
create index if not exists task_workspace_actors_principal_idx
  on public.task_workspace_actors (principal_id);
