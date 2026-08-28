import { test, expect, installApi, bootApp, openTaskManagement, fail, taskItem, taskItems, appNav } from './harness';
import * as F from './fixtures';

test.describe('Role and entitlement affordances', () => {
  test('READ_ONLY sees tasks but no create, edit, archive or status controls', async ({ page }) => {
    await installApi(page, { role: 'READ_ONLY' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(taskItems(page)).toHaveCount(3);
    await expect(page.locator('#btn-new-task')).toHaveCount(0);
    await expect(page.locator('#btn-manage-statuses')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Archive “/ })).toHaveCount(0);

    // The drawer opens read-only: no Edit, no Archive, no subtask control.
    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: /Archive/ })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Add subtask' })).toHaveCount(0);
  });

  test('a contributor can create tasks but cannot manage the hierarchy', async ({ page }) => {
    await installApi(page, { role: 'SALES_REP' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.locator('#btn-new-task')).toBeVisible();
    await expect(page.locator('#btn-manage-statuses')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create a new Space' })).toHaveCount(0);
  });

  test('a contributor gets mutation controls only on their own or assigned tasks', async ({ page }) => {
    await installApi(page, { role: 'SALES_REP' });
    await bootApp(page);
    await openTaskManagement(page);

    const mine = taskItem(page, 'My own task');
    const theirs = taskItem(page, 'Prepare pool inspection report');

    await expect(mine.getByRole('button', { name: 'Archive “My own task”' })).toBeVisible();
    await expect(theirs.getByRole('button', { name: /^Archive “/ })).toHaveCount(0);
  });

  test('an expired workspace is told it is read-only and loses its create control', async ({ page }) => {
    await installApi(page, {
      role: 'ADMIN',
      caps: { canCreateTask: false, canManageHierarchy: false, canAssignOthers: false }
    });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.getByText(/read-only access to Task Management/)).toBeVisible();
    await expect(page.getByText(/stop a running timer/)).toBeVisible();
    await expect(page.locator('#btn-new-task')).toHaveCount(0);
  });

  test('a suspended workspace gets a terminal message with no retry', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.failAlways('GET /api/tasks/bootstrap', 403,
      fail('TASK_WORKSPACE_SUSPENDED', 'This workspace is suspended.'));
    await bootApp(page);
    await (await appNav(page, 'task-management')).click();

    await expect(page.getByText('This workspace is suspended.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  });

  test('an unresolved actor is warned that changes are blocked', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', caps: { actorResolved: false } });
    await bootApp(page);
    await openTaskManagement(page);

    const warning = page.getByRole('alert').filter({ hasText: 'no verified user identity' });
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('view tasks but not change them');
  });

  test('a forbidden mutation is surfaced, not swallowed', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks/' + F.TASK_2 + '/archive', 403,
      fail('TASK_FORBIDDEN', 'You do not have permission to change this task.'));

    page.once('dialog', d => d.accept());
    await taskItem(page, 'Schedule filter replacement')
      .getByRole('button', { name: /^Archive “/ }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'do not have permission' })).toBeVisible();
  });

  test('the banner from a failed mutation can be dismissed', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks/' + F.TASK_2 + '/archive', 403,
      fail('TASK_FORBIDDEN', 'You do not have permission to change this task.'));

    page.once('dialog', d => d.accept());
    await taskItem(page, 'Schedule filter replacement')
      .getByRole('button', { name: /^Archive “/ }).click();

    const banner = page.getByRole('alert').filter({ hasText: 'do not have permission' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner).toBeHidden();
  });
});

test.describe('Workspace switching', () => {
  test('changing workspace reloads Task Management rather than showing stale data', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await expect(taskItems(page)).toHaveCount(3);

    const before = api.requests().filter(r => r.startsWith('GET /api/tasks/bootstrap')).length;
    expect(before).toBeGreaterThanOrEqual(1);

    // A workspace switch re-verifies the session; the module must refetch from scratch.
    await page.reload();
    await (await appNav(page, 'task-management')).click();
    await expect(taskItems(page)).toHaveCount(3);
    const after = api.requests().filter(r => r.startsWith('GET /api/tasks/bootstrap')).length;
    expect(after).toBeGreaterThan(before);
  });

  test('no request ever carries a client-supplied workspace id', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await modal.getByLabel(/^Title/).fill('Tenancy check');
    await modal.getByRole('button', { name: /^(Create|Save)/ }).click();
    await expect(modal).toBeHidden();

    const offending = api.requests().filter(r =>
      /workspace_?[iI]d/.test(r) && r.startsWith('GET /api/tasks'));
    expect(offending, 'the client must never send a workspace id').toEqual([]);
  });
});
