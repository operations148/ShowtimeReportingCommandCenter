/**
 * Principal and workspace-actor resolution.
 *
 * Two-level identity (see migration 0005):
 *   principal  -> the person, GLOBALLY. Timer concurrency is keyed here.
 *   actor      -> that person's projection INSIDE one workspace. Ownership/assignment use it.
 *
 * FAIL-CLOSED (decision D1): a GHL SSO session whose signed payload carries no userId has no
 * verifiable identity. It resolves to null, and the router turns that into
 * 403 TASK_ACTOR_UNRESOLVED for every mutation. The literal 'ghl_sso' fallback used
 * elsewhere in this codebase is never accepted here — if it were, every anonymous SSO
 * visitor in a workspace would share one identity, so "my time entries" and "one running
 * timer per person" would silently become workspace-wide shared state.
 */

import { supabaseAdmin } from '../supabase.js';
import { supabaseIssuer, ghlIssuer } from './config.js';
import { TaskError, mapDbError } from './http.js';

export interface ResolvedActor {
  principalId: string;
  actorId: string;
  source: 'supabase' | 'ghl_sso';
}

/** Identity inputs derived from requireAuth. Never from the request body. */
function identityFromRequest(req: any):
  { source: 'supabase' | 'ghl_sso'; issuer: string; externalId: string } | null {
  if (req.authSource === 'ghl_sso') {
    const externalId = String(req.ssoUserId ?? '').trim();
    // No verified subject id -> no principal. Deliberately not falling back to anything.
    if (!externalId) return null;
    return { source: 'ghl_sso', issuer: ghlIssuer(), externalId };
  }
  const externalId = String(req.supabaseUserId ?? '').trim();
  if (!externalId) return null;
  return { source: 'supabase', issuer: supabaseIssuer(), externalId };
}

/**
 * Resolves (and lazily provisions) the principal + workspace actor for this request.
 * Returns null when the caller has no verifiable identity — callers must treat null as
 * "reads may proceed, mutations must not".
 */
export async function resolveActor(req: any): Promise<ResolvedActor | null> {
  const identity = identityFromRequest(req);
  if (!identity) return null;

  const workspaceId: string = req.workspace.id;

  // 1. Global principal, keyed on the trusted triple. Upsert is safe under concurrency
  //    because of the unique constraint on (source, issuer, external_id).
  const { data: principal, error: pErr } = await supabaseAdmin
    .from('task_principals')
    .upsert(
      { source: identity.source, issuer: identity.issuer, external_id: identity.externalId },
      { onConflict: 'source,issuer,external_id' }
    )
    .select('id')
    .single();
  if (pErr || !principal) throw mapDbError(pErr, 'resolve principal');

  // 2. Workspace projection. Display name/email are refreshed opportunistically as UI
  //    snapshots only — they are never used to identify or authorize anyone.
  const displayName = typeof req.user?.name === 'string' ? req.user.name.slice(0, 200) : null;
  const email = typeof req.user?.email === 'string' ? req.user.email.slice(0, 320) : null;

  const { data: actor, error: aErr } = await supabaseAdmin
    .from('task_workspace_actors')
    .upsert(
      {
        workspace_id: workspaceId,
        principal_id: principal.id,
        display_name: displayName,
        email,
        last_seen_at: new Date().toISOString()
      },
      { onConflict: 'workspace_id,principal_id' }
    )
    .select('id')
    .single();
  if (aErr || !actor) throw mapDbError(aErr, 'resolve workspace actor');

  return { principalId: principal.id, actorId: actor.id, source: identity.source };
}

/**
 * Returns the resolved actor or throws 403 TASK_ACTOR_UNRESOLVED.
 * Every mutating route calls this; read routes call resolveActor directly and tolerate null.
 */
export function requireResolvedActor(actor: ResolvedActor | null): ResolvedActor {
  if (!actor) {
    throw new TaskError(
      403,
      'TASK_ACTOR_UNRESOLVED',
      'Your session has no verified user identity, so it cannot create or modify task data. ' +
      'Sign in again from GoHighLevel, or contact your administrator.'
    );
  }
  return actor;
}
