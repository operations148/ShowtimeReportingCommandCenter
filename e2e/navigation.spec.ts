import { test, expect, installApi, bootApp, openTaskManagement, fail, appNav , taskItem } from './harness';
import * as F from './fixtures';

test.describe('Navigation and module gating', () => {
  test('the Task Management tab appears in the sidebar and activates on click', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);

    const nav = await appNav(page, 'task-management');
    await expect(nav).toBeVisible();
    await expect(nav).toHaveText(/Task Management/);

    await nav.click();
    await expect(page.getByRole('heading', { name: 'Task Management', level: 1 })).toBeVisible();
    // Active state is the bright-blue pill the rest of the nav uses.
    await expect(nav).toHaveClass(/bg-blue-600/);
    api.assertNoLeaks();
  });

  test('switching to another dashboard and back preserves the module', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await expect(taskItem(page, 'Prepare pool inspection report')).toBeVisible();

    await (await appNav(page, 'dashboard')).click();
    await expect(page.locator('#task-management-view')).toHaveCount(0);

    await (await appNav(page, 'task-management')).click();
    await expect(taskItem(page, 'Prepare pool inspection report')).toBeVisible();
  });

  test('the pre-existing reporting navigation is unchanged and no VA surface exists', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);

    // Every nav entry that existed before Task Management must still be present.
    for (const id of ['dashboard', 'opportunity', 'sales', 'appointment', 'marketing',
                      'estimates', 'ghl-setup', 'integrations', 'settings',
                      'admin', 'client-trials', 'billing']) {
      await expect(page.locator(`#nav-btn-${id}`)).toHaveCount(1);
    }
    // Task Management is one additional non-reporting entry, not a sixth dashboard.
    await expect(page.locator('#nav-btn-task-management')).toHaveCount(1);

    // The prohibited surface must not exist.
    await expect(page.getByRole('button', { name: /VA Dashboard/i })).toHaveCount(0);
  });

  test('a disabled module renders a terminal error with no retry button', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.failAlways('GET /api/tasks/bootstrap', 403,
      fail('TASK_MODULE_DISABLED', 'Task Management is not enabled for this workspace.'));
    await bootApp(page);
    await (await appNav(page, 'task-management')).click();

    await expect(page.getByRole('heading', { name: 'Task Management unavailable' })).toBeVisible();
    await expect(page.getByText('Task Management is not enabled for this workspace.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('a recoverable bootstrap failure offers a working retry', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.failNext('GET /api/tasks/bootstrap', 500,
      fail('TASK_INTERNAL_ERROR', 'Something went wrong loading Task Management.'));
    await bootApp(page);
    await (await appNav(page, 'task-management')).click();

    const retry = page.getByRole('button', { name: 'Try again' });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(page.locator('#task-management-view')).toBeVisible();
    await expect(taskItem(page, 'Prepare pool inspection report')).toBeVisible();
  });

  test('a network failure during bootstrap is reported as a connection problem', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.failNext('GET /api/tasks/bootstrap', 0, '');
    await bootApp(page);
    await (await appNav(page, 'task-management')).click();
    await expect(page.getByText(/Could not reach the server/)).toBeVisible();
  });
});
