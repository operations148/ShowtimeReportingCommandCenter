-- 0002_workspace_integrations_grants.sql
--
-- Grants table privileges to service_role for workspace_integrations.
--
-- Context: tables created through a direct/pooler postgres connection do not pick up
-- the default privileges Supabase applies to tables made via its dashboard. Without
-- this grant, PostgREST rejects every request from the server with:
--   42501: permission denied for table workspace_integrations
-- even though the service role key is meant to bypass RLS. RLS bypass is not the same
-- as a table grant — the role must still hold privileges on the relation.
--
-- Deliberately NOT granted to anon or authenticated. This table stores AES-256-GCM
-- encrypted OAuth tokens for every tenant, and the application only ever reads it
-- server-side via the service role. Withholding the grant means that even if RLS were
-- later disabled by accident, a browser-side anon key still could not read tenant
-- credentials. RLS (enabled in 0001) and these grants are two independent layers.

grant select, insert, update, delete
  on table public.workspace_integrations
  to service_role;

-- The migration runner connects as this role; keep it able to manage the table.
grant all
  on table public.workspace_integrations
  to postgres;
