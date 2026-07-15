-- 0003_workspace_integrations_revoke_public_roles.sql
--
-- Revokes all residual privileges on workspace_integrations from anon/authenticated.
--
-- Context: Supabase default privileges left these roles holding REFERENCES, TRIGGER and
-- TRUNCATE on the table (verified via information_schema.role_table_grants after 0002).
-- They never had SELECT/INSERT/UPDATE/DELETE, so tenant tokens were not readable from a
-- browser — but TRUNCATE is worth removing regardless:
--
--   * Row Level Security does not apply to TRUNCATE. The deny-all RLS from 0001 stops
--     row reads and writes, but would not stop a truncate.
--   * PostgREST does not expose TRUNCATE, so this is not reachable through the public
--     API today. It is a latent privilege that only matters if something else ever
--     connects with the anon role — which is exactly when you want it already gone.
--
-- This table holds AES-256-GCM encrypted OAuth credentials for every tenant. Only the
-- server (service_role) has any business touching it.

revoke all on table public.workspace_integrations from anon;
revoke all on table public.workspace_integrations from authenticated;
