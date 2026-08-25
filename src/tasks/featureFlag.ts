/**
 * CLIENT-SIDE visibility for the Task Management tab.
 *
 * THIS IS NOT A SECURITY BOUNDARY. It only decides whether a nav item is rendered.
 * The API is protected independently by the SERVER-side flags — the master
 * TASK_MANAGEMENT_ENABLED switch and the TASK_MANAGEMENT_ROLLOUT_MODE /
 * TASK_MANAGEMENT_CANARY_WORKSPACE_IDS gate — both checked in the task router before any
 * authorization or data access. Forcing these values true in a browser still yields
 * 403 TASK_MODULE_DISABLED or 403 TASK_ROLLOUT_EXCLUDED from every /api/tasks call.
 *
 * Defaults to hidden: absent, empty, or any non-truthy value keeps the tab hidden, so simply
 * building or deploying this code cannot surface the feature.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time and they are readable in the shipped
 * bundle. Only non-sensitive values belong here. Workspace identifiers are not secrets — the
 * signed-in user already knows their own — but nothing else may be added.
 */

function env(name: string): string {
  try {
    return String((import.meta as any).env?.[name] ?? '').trim();
  } catch {
    // If import.meta.env is unavailable for any reason, behave as if unset.
    return '';
  }
}

function truthy(raw: string): boolean {
  const v = raw.toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

/** The client-side mirror of the canary allowlist. Empty means "no client-side narrowing". */
export function canaryWorkspaceIds(): string[] {
  return env('VITE_TASK_MANAGEMENT_CANARY_WORKSPACE_IDS')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * The nav decision as a pure function, so it can be unit tested without a browser or a
 * bundler. `isTaskManagementUiEnabled` is only this plus the env reads.
 *
 * Two independent conditions, both of which must hold:
 *   1. The build has the module switched on at all.
 *   2. If a canary allowlist is configured, this workspace is on it.
 *
 * When no allowlist is configured the tab shows wherever the module is on, which is the
 * behaviour for a full release. Narrowing is opt-in via the list, mirroring the server's
 * canary mode so a Preview deployment does not dangle a tab in front of a tenant whose API
 * calls would only be refused.
 *
 * Passing no workspace id while an allowlist IS configured returns false: with narrowing
 * active, an unknown workspace is not shown the tab.
 */
export function decideTaskNavVisible(input: {
  enabled: boolean;
  allowlist: string[];
  workspaceId?: string | null;
}): boolean {
  if (!input.enabled) return false;
  if (input.allowlist.length === 0) return true;
  return typeof input.workspaceId === 'string' && input.allowlist.includes(input.workspaceId);
}

/** Whether to render the Task Management nav item for the signed-in workspace. */
export function isTaskManagementUiEnabled(workspaceId?: string | null): boolean {
  return decideTaskNavVisible({
    enabled: truthy(env('VITE_TASK_MANAGEMENT_ENABLED')),
    allowlist: canaryWorkspaceIds(),
    workspaceId
  });
}
