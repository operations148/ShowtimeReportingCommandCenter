/**
 * CLIENT-SIDE visibility flag for the Task Management tab.
 *
 * THIS IS NOT A SECURITY BOUNDARY. It only decides whether a nav item is rendered.
 * The API is protected independently by the SERVER-side TASK_MANAGEMENT_ENABLED flag, which
 * is checked in the task router before any authorization or data access — so even with this
 * flag forced true in a browser, every /api/tasks call still returns
 * 403 TASK_MODULE_DISABLED until an operator enables the server flag.
 *
 * Defaults to false: absent, empty, or any non-truthy value keeps the tab hidden, so simply
 * building or deploying this code cannot surface the feature.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time. Only put non-sensitive values here —
 * anything referenced through VITE_ ends up readable in the shipped bundle.
 */
export function isTaskManagementUiEnabled(): boolean {
  try {
    const raw = String((import.meta as any).env?.VITE_TASK_MANAGEMENT_ENABLED ?? '')
      .trim()
      .toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  } catch {
    // If import.meta.env is unavailable for any reason, stay hidden.
    return false;
  }
}
