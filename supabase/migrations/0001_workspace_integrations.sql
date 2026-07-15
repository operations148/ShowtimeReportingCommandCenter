-- 0001_workspace_integrations.sql
--
-- Creates the table backing the per-workspace integrations layer (GA4, Meta Ads).
--
-- Context: the application code for both providers was complete and deployed, but
-- this table was never created in the database. Every read returned HTTP 404
-- (PGRST205, relation does not exist), so no integration could ever connect.
--
-- Column names and types below are dictated by existing code in _api_src/index.ts:
--   - getValidGoogleToken()          reads encrypted_access_token, encrypted_refresh_token, token_expiry
--   - GET  /api/integrations/google/callback  upserts on (workspace_id, provider)
--   - POST /api/integrations/meta/connect     upserts on (workspace_id, provider)
--   - GET  /api/integrations/status  reads provider, status, property_id, property_name, connected_at
--   - GET  /api/reporting/ga4        reads status, property_id
-- Do not rename columns without updating those call sites.

create table if not exists public.workspace_integrations (
  -- Application-generated (e.g. int_ga4_1731000000000, int_meta_ws_showtime), not a uuid default.
  id                      text primary key,

  workspace_id            text not null
                            references public.workspaces(id) on delete cascade,

  provider                text not null
                            check (provider in ('google_analytics', 'meta_ads')),

  status                  text not null default 'DISCONNECTED'
                            check (status in ('CONNECTED', 'DISCONNECTED', 'ERROR')),

  -- AES-256-GCM ciphertext (iv:authTag:ciphertext), never plaintext.
  -- Encrypted with INTEGRATION_ENCRYPTION_KEY; rotating that key orphans these values.
  encrypted_access_token  text,
  encrypted_refresh_token text,
  token_expiry            timestamptz,

  -- GA4: property id/display name. Meta: ad account id (sans act_ prefix) / account name.
  property_id             text,
  property_name           text,

  connected_at            timestamptz,
  last_synced_at          timestamptz,
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- Required: both callback handlers upsert with onConflict 'workspace_id,provider'.
  -- Without this constraint those upserts fail at runtime.
  constraint workspace_integrations_workspace_provider_key unique (workspace_id, provider)
);

create index if not exists workspace_integrations_workspace_id_idx
  on public.workspace_integrations (workspace_id);

create index if not exists workspace_integrations_workspace_provider_idx
  on public.workspace_integrations (workspace_id, provider);

-- This table holds encrypted OAuth credentials for every tenant. RLS is enabled with
-- no policies, so PostgREST denies all anon/authenticated access outright. The server
-- reaches it only via the service role key, which bypasses RLS by design. Adding a
-- permissive policy here would expose one tenant's tokens to another.
alter table public.workspace_integrations enable row level security;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workspace_integrations_set_updated_at on public.workspace_integrations;
create trigger workspace_integrations_set_updated_at
  before update on public.workspace_integrations
  for each row execute function public.set_updated_at();
