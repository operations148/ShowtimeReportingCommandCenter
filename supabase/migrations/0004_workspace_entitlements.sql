-- 0004_workspace_entitlements.sql
--
-- Adds the trial + perpetual-licence entitlement model to workspaces.
--
-- Access model (no recurring billing anywhere in it):
--     14-day free trial  ->  one-time purchase (settled externally)  ->  permanent licence
--
-- These columns live on `workspaces` rather than a side table on purpose: requireAuth()
-- already loads the workspace row on every authenticated request, so the entitlement gate
-- in the middleware costs zero additional queries. A join per request would be worse.
--
-- WHAT IS STORED vs WHAT IS DERIVED
-- Only facts are stored. The six trial states (NOT_STARTED / ACTIVE / EXPIRING_SOON /
-- EXPIRED / CONVERTED / ADMIN_EXTENDED) and access_status are DERIVED at request time in
-- src/entitlements.ts. Storing them would be wrong: EXPIRING_SOON and EXPIRED are purely
-- functions of the clock, so a stored column silently goes stale the moment now() crosses
-- trial_ends_at, and would need a cron to stay honest. Deriving from timestamps is always
-- correct and needs no scheduler.
--
-- The pre-existing `suspended` boolean is kept as the operative flag — requireAuth()
-- already reads it and that behaviour must not change. The columns added here only record
-- the surrounding metadata (when, why).

alter table public.workspaces
  -- Trial window. Null trial_started_at means the trial has not begun (NOT_STARTED).
  add column if not exists trial_started_at      timestamptz,
  add column if not exists trial_ends_at         timestamptz,

  -- Enforces one normal trial per organisation. Set true when a trial starts and never
  -- cleared, so a workspace cannot re-trial by resetting its dates.
  add column if not exists trial_used            boolean not null default false,

  -- Super-admin trial extensions. A non-zero count is what makes a live trial report as
  -- ADMIN_EXTENDED rather than ACTIVE.
  add column if not exists trial_extension_count integer not null default 0,
  add column if not exists trial_extended_at     timestamptz,
  add column if not exists trial_extended_by     uuid references public.profiles(id),

  -- Perpetual licence. REVOKED is retained (rather than reverting to NONE) so a revocation
  -- stays visible instead of looking like an org that never purchased.
  add column if not exists license_status        text not null default 'NONE',
  add column if not exists licensed_at           timestamptz,
  add column if not exists licensed_by_user_id   uuid references public.profiles(id),

  -- Free-text purchase/invoice reference. Payment is settled outside the platform, so this
  -- is the only link back to the transaction. Never holds card or payment credentials.
  add column if not exists license_reference     text,

  -- Suspension metadata. `suspended` above remains the flag that actually gates access.
  add column if not exists suspended_at          timestamptz,
  add column if not exists suspension_reason     text;

-- Guard the state machine at the database, not just in application code.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_license_status_check') then
    alter table public.workspaces
      add constraint workspaces_license_status_check
      check (license_status in ('NONE', 'LICENSED', 'REVOKED'));
  end if;

  -- A licence must record when it was granted, or it cannot be audited.
  if not exists (select 1 from pg_constraint where conname = 'workspaces_licensed_at_required_check') then
    alter table public.workspaces
      add constraint workspaces_licensed_at_required_check
      check (license_status <> 'LICENSED' or licensed_at is not null);
  end if;

  -- A trial window must be coherent, and must always have a start if it has an end.
  if not exists (select 1 from pg_constraint where conname = 'workspaces_trial_window_check') then
    alter table public.workspaces
      add constraint workspaces_trial_window_check
      check (
        (trial_started_at is null and trial_ends_at is null)
        or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at > trial_started_at)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'workspaces_trial_extension_count_check') then
    alter table public.workspaces
      add constraint workspaces_trial_extension_count_check
      check (trial_extension_count >= 0);
  end if;
end $$;

-- Supports the super-admin console listing orgs by entitlement state.
create index if not exists workspaces_license_status_idx on public.workspaces (license_status);
create index if not exists workspaces_trial_ends_at_idx  on public.workspaces (trial_ends_at);

-- ---------------------------------------------------------------------------
-- BACKFILL — grandfather every workspace that predates this migration.
--
-- This is deliberately generous, because the alternative is an outage. Day 4 adds an
-- enforcement gate that locks out any workspace without a live trial or a licence. Every
-- existing org predates the trial system and never had the chance to start one:
--   * leaving them NONE would lock them out the moment the gate ships;
--   * starting a trial now would lock them out 14 days later;
--   * dating a trial from created_at would lock them out immediately (ws_showtime was
--     created 2026-02-15, five months ago).
-- Granting a perpetual licence is the only option that preserves access for live tenants,
-- and it matches commercial reality — ws_showtime carries an ACTIVE/UNLIMITED/$297
-- subscription under the legacy model this replaces.
--
-- trial_used is set true so a grandfathered org cannot later claim a "free" first trial.
-- licensed_by_user_id stays null: no human granted this, the migration did. That null is
-- what distinguishes a backfilled licence from one a super admin actually issued.
-- ---------------------------------------------------------------------------
update public.workspaces
set license_status    = 'LICENSED',
    licensed_at       = now(),
    license_reference = 'BACKFILL_0004_PRE_ENTITLEMENT',
    trial_used        = true
where license_status = 'NONE';
