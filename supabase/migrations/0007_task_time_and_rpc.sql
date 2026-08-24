-- 0007_task_time_and_rpc.sql
--
-- Server-authoritative time engine plus the transactional operations that cannot be done
-- safely as a sequence of supabase-js calls.
--
-- WHY RPC AT ALL: supabase-js calls issued one after another are separate statements with
-- no shared transaction. "Create a Space, then its default List, then its statuses" would
-- leave a half-built Space behind if any step failed, and "check for a running timer, then
-- insert one" is a textbook check-then-act race. Both are collapsed into single
-- database-side functions here.
--
-- TIME AUTHORITY: every timestamp originates from the database via now(). No client-supplied
-- duration, start time, or end time is ever trusted, so a wrong browser clock, a paused
-- laptop, or a hostile caller cannot alter recorded time.

-- ── Time entries ──────────────────────────────────────────────────────────────────────
create table if not exists public.task_time_entries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null references public.workspaces(id) on delete cascade,
  task_id       uuid not null,

  -- BOTH identities are stored, deliberately:
  --   principal_id -> global person; the ONLY key for "one running timer per person".
  --   actor_id     -> workspace projection; used for display, filtering and permissions.
  principal_id  uuid not null references public.task_principals(id) on delete restrict,
  actor_id      uuid not null,

  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  source        text not null default 'timer' check (source in ('timer', 'manual')),
  note          text check (note is null or length(note) <= 2000),

  -- Idempotency key supplied by the client so a retried/duplicated start request cannot
  -- create a second entry.
  client_token  uuid,

  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint task_time_entries_task_fk foreign key (workspace_id, task_id)
    references public.task_items (workspace_id, id) on delete cascade,
  constraint task_time_entries_actor_fk foreign key (workspace_id, actor_id)
    references public.task_workspace_actors (workspace_id, id) on delete restrict,

  -- A closed entry must end strictly after it started.
  constraint task_time_entries_range_valid check (ended_at is null or ended_at > started_at),
  -- Manual entries are historical records and must be closed at creation; only a live timer
  -- may have a null ended_at.
  constraint task_time_entries_manual_closed check (source <> 'manual' or ended_at is not null),
  -- Guard against absurd single entries (> 32 days) reaching reporting.
  constraint task_time_entries_bounded check
    (ended_at is null or ended_at - started_at <= interval '32 days')
);

-- THE global concurrency guarantee. Keyed on principal_id (NOT actor_id) so the same human
-- cannot run one timer in Workspace A and another in Workspace B. Enforced by Postgres, so
-- concurrent requests race against an index rather than against application logic.
create unique index if not exists task_time_entries_one_running_per_principal
  on public.task_time_entries (principal_id) where ended_at is null;

-- Idempotency: replaying a start with the same token returns the original row.
create unique index if not exists task_time_entries_idempotency
  on public.task_time_entries (principal_id, client_token) where client_token is not null;

drop trigger if exists task_time_entries_set_updated_at on public.task_time_entries;
create trigger task_time_entries_set_updated_at before update on public.task_time_entries
  for each row execute function public.set_updated_at();

-- ══════════════════════════════════════════════════════════════════════════════════════
-- RPC 1: create a Space with its default List, default statuses and ordering, atomically.
-- ══════════════════════════════════════════════════════════════════════════════════════
create or replace function public.task_create_space(
  p_workspace_id text,
  p_name         text,
  p_actor_id     uuid
)
returns table (space_id uuid, list_id uuid)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_space_id uuid;
  v_list_id  uuid;
  v_position numeric;
begin
  select coalesce(max(s.position), 0) + 1000 into v_position
  from public.task_spaces s where s.workspace_id = p_workspace_id;

  insert into public.task_spaces (workspace_id, name, position, created_by, updated_by)
  values (p_workspace_id, p_name, v_position, p_actor_id, p_actor_id)
  returning id into v_space_id;

  insert into public.task_lists
    (workspace_id, space_id, name, position, is_default, created_by, updated_by)
  values (p_workspace_id, v_space_id, 'General', 1000, true, p_actor_id, p_actor_id)
  returning id into v_list_id;

  -- Default board columns. 'To Do' is the default status new tasks land in.
  insert into public.task_statuses
    (workspace_id, space_id, name, category, color, position, is_default)
  values
    (p_workspace_id, v_space_id, 'To Do',       'todo',        '#94A3B8', 1000, true),
    (p_workspace_id, v_space_id, 'In Progress', 'in_progress', '#2563EB', 2000, false),
    (p_workspace_id, v_space_id, 'Done',        'done',        '#059669', 3000, false);

  return query select v_space_id, v_list_id;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- RPC 2: start a timer. Single statement-level transaction; no check-then-act window.
--   outcome = 'idempotent_replay'          same client_token already used -> original row
--           = 'already_running_same_task'  timer already live on this task -> that row
--           = 'conflict_other_task'        timer live on a DIFFERENT task -> that row (409)
--           = 'started'                    a new entry was created
-- ══════════════════════════════════════════════════════════════════════════════════════
create or replace function public.task_timer_start(
  p_workspace_id  text,
  p_task_id       uuid,
  p_principal_id  uuid,
  p_actor_id      uuid,
  p_client_token  uuid default null
)
returns table (
  entry_id     uuid,
  task_id      uuid,
  workspace_id text,
  started_at   timestamptz,
  outcome      text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_existing public.task_time_entries%rowtype;
  v_new      public.task_time_entries%rowtype;
begin
  -- The task must exist, live, in THIS workspace. Never trust a caller-supplied workspace.
  if not exists (
    select 1 from public.task_items t
    where t.id = p_task_id and t.workspace_id = p_workspace_id and t.archived_at is null
  ) then
    raise exception 'TASK_NOT_FOUND' using errcode = 'no_data_found';
  end if;

  -- Idempotent replay of an identical start request.
  if p_client_token is not null then
    select * into v_existing from public.task_time_entries e
    where e.principal_id = p_principal_id and e.client_token = p_client_token
    limit 1;
    if found then
      return query select v_existing.id, v_existing.task_id, v_existing.workspace_id,
                          v_existing.started_at, 'idempotent_replay'::text;
      return;
    end if;
  end if;

  -- Lock any live timer for this principal so two concurrent starts serialise here.
  select * into v_existing from public.task_time_entries e
  where e.principal_id = p_principal_id and e.ended_at is null
  for update;

  if found then
    return query select v_existing.id, v_existing.task_id, v_existing.workspace_id,
                        v_existing.started_at,
                        case when v_existing.task_id = p_task_id
                             then 'already_running_same_task'::text
                             else 'conflict_other_task'::text end;
    return;
  end if;

  begin
    insert into public.task_time_entries
      (workspace_id, task_id, principal_id, actor_id, source, client_token)
    values (p_workspace_id, p_task_id, p_principal_id, p_actor_id, 'timer', p_client_token)
    returning * into v_new;
  exception when unique_violation then
    -- Lost a race against a concurrent start; return whatever actually won.
    select * into v_existing from public.task_time_entries e
    where e.principal_id = p_principal_id and e.ended_at is null limit 1;
    return query select v_existing.id, v_existing.task_id, v_existing.workspace_id,
                        v_existing.started_at,
                        case when v_existing.task_id = p_task_id
                             then 'already_running_same_task'::text
                             else 'conflict_other_task'::text end;
    return;
  end;

  return query select v_new.id, v_new.task_id, v_new.workspace_id, v_new.started_at,
                      'started'::text;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- RPC 3: stop a timer. Safely repeatable — stopping an already-stopped entry returns that
-- same completed entry rather than erroring, so a double-click or retry is harmless.
-- ══════════════════════════════════════════════════════════════════════════════════════
create or replace function public.task_timer_stop(
  p_workspace_id text,
  p_principal_id uuid,
  p_entry_id     uuid default null
)
returns table (
  entry_id         uuid,
  task_id          uuid,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_seconds bigint,
  outcome          text
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_entry public.task_time_entries%rowtype;
begin
  select * into v_entry from public.task_time_entries e
  where e.principal_id = p_principal_id
    and e.ended_at is null
    and (p_entry_id is null or e.id = p_entry_id)
  for update;

  if not found then
    -- Idempotent path: the caller named an entry that is already closed.
    if p_entry_id is not null then
      select * into v_entry from public.task_time_entries e
      where e.id = p_entry_id
        and e.principal_id = p_principal_id
        and e.workspace_id = p_workspace_id;
      if found then
        return query select v_entry.id, v_entry.task_id, v_entry.started_at, v_entry.ended_at,
          extract(epoch from (v_entry.ended_at - v_entry.started_at))::bigint,
          'already_stopped'::text;
        return;
      end if;
    end if;
    raise exception 'NO_ACTIVE_TIMER' using errcode = 'no_data_found';
  end if;

  update public.task_time_entries e
     set ended_at = now()
   where e.id = v_entry.id
  returning * into v_entry;

  return query select v_entry.id, v_entry.task_id, v_entry.started_at, v_entry.ended_at,
    extract(epoch from (v_entry.ended_at - v_entry.started_at))::bigint,
    'stopped'::text;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════
-- RPC 4: close every live timer in a workspace at an authoritative server cutoff.
-- Invoked when a trial expires or an admin suspends/revokes a workspace, so a timer can
-- never keep accruing indefinitely against a tenant that has lost access.
-- ══════════════════════════════════════════════════════════════════════════════════════
create or replace function public.task_close_active_timers(
  p_workspace_id text,
  p_reason       text default 'entitlement_closed'
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_closed integer;
begin
  with closed as (
    update public.task_time_entries e
       set ended_at = now(),
           note = left(coalesce(e.note || ' | ', '') || 'auto-closed: ' || p_reason, 2000)
     where e.workspace_id = p_workspace_id
       and e.ended_at is null
    returning e.id, e.actor_id, e.task_id
  )
  insert into public.task_activity_events
    (workspace_id, actor_id, entity_type, entity_id, action, detail)
  select p_workspace_id, c.actor_id, 'time_entry', c.id, 'TIMER_AUTO_CLOSED',
         jsonb_build_object('reason', p_reason, 'taskId', c.task_id)
  from closed c;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$$;
