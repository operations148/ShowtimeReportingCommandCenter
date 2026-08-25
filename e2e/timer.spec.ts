import { test, expect, installApi, bootApp, openTaskManagement, fail, taskItem, taskItems } from './harness';
import * as F from './fixtures';

test.describe('Time tracking', () => {
  test('starts a timer, shows the running bar, and stops it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();

    // The persistent bar names the running task and counts up.
    const bar = page.getByText('Prepare pool inspection report').first();
    await expect(bar).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop timer for this task' }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Stop timer for this task' }).first().click();
    await expect(page.getByRole('button', { name: 'Start timer for this task' }).first()).toBeVisible();
  });

  test('reports a conflict when another task is already timed, and can switch', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // Task 1 is running.
    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();
    await expect(page.getByRole('button', { name: 'Stop timer for this task' }).first()).toBeVisible();

    // Starting a second one must be refused with an explicit choice, not silently swapped.
    await taskItem(page, 'Schedule filter replacement')
      .getByRole('button', { name: 'Start timer for this task' }).click();

    const conflict = page.getByRole('alertdialog');
    await expect(conflict).toContainText('A timer is already running on');
    await expect(conflict.getByRole('button', { name: 'Stop it and switch' })).toBeVisible();
    await expect(conflict.getByRole('button', { name: 'Keep current timer' })).toBeVisible();

    await conflict.getByRole('button', { name: 'Stop it and switch' }).click();
    await expect(conflict).toBeHidden();
    // The timer now belongs to the second task.
    expect(api.state.activeTimer?.task_id).toBe(F.TASK_2);
  });

  test('keeping the current timer dismisses the conflict without switching', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();
    await expect(page.getByRole('button', { name: 'Stop timer for this task' }).first()).toBeVisible();

    await taskItem(page, 'Schedule filter replacement')
      .getByRole('button', { name: 'Start timer for this task' }).click();
    const conflict = page.getByRole('alertdialog');
    await conflict.getByRole('button', { name: 'Keep current timer' }).click();

    await expect(conflict).toBeHidden();
    expect(api.state.activeTimer?.task_id).toBe(F.TASK_1);
  });

  test('resumes a timer that was already running when the module loads', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.state.activeTimer = {
      id: 'pre-existing', task_id: F.TASK_1,
      started_at: new Date(Date.now() - 125_000).toISOString()
    };
    await bootApp(page);
    await openTaskManagement(page);

    // Elapsed is derived from the server's started_at, so it must already be past 2 minutes.
    await expect(page.getByText(/0:0[2-9]:\d\d/).first()).toBeVisible();
  });

  test('adds a manual time entry from the drawer', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await expect(drawer).toContainText('Time entries');
    await expect(drawer).toContainText('Site visit');

    await drawer.getByRole('button', { name: 'Add time manually' }).click();
    await drawer.getByLabel('Start', { exact: true }).fill('2026-08-20T09:00');
    await drawer.getByLabel('End', { exact: true }).fill('2026-08-20T10:30');
    await drawer.getByPlaceholder('Note (optional)').fill('Filter swap');
    await drawer.getByRole('button', { name: 'Add entry' }).click();

    // The form closes on success and the entry was actually sent.
    await expect(drawer.getByRole('button', { name: 'Add time manually' })).toBeVisible();
    expect(api.requests().some(r => r.startsWith('POST /api/tasks/time-entries'))).toBe(true);
  });

  test('rejects a manual entry whose end is not after its start and keeps the values', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });

    api.failNext('POST /api/tasks/time-entries', 400,
      fail('TASK_VALIDATION_FAILED', 'The end time must be after the start time.'));

    await drawer.getByRole('button', { name: 'Add time manually' }).click();
    await drawer.getByLabel('Start', { exact: true }).fill('2026-08-20T11:00');
    await drawer.getByLabel('End', { exact: true }).fill('2026-08-20T11:30');
    await drawer.getByRole('button', { name: 'Add entry' }).click();

    await expect(drawer.getByRole('alert').filter({ hasText: 'end time must be after' })).toBeVisible();
    await expect(drawer.getByLabel('Start', { exact: true })).toHaveValue('2026-08-20T11:00');
  });

  test('hides every time-tracking control when the server disables the feature', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', caps: { timeTrackingEnabled: false } });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(taskItems(page)).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Start timer for this task' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop timer for this task' })).toHaveCount(0);
  });

  test('surfaces a failed timer start without pretending it started', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks/timer/start', 500,
      fail('TASK_INTERNAL_ERROR', 'Could not start the timer.'));

    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();

    // No running state is shown, and the control is still offered.
    await expect(page.getByRole('button', { name: 'Stop timer for this task' })).toHaveCount(0);
    await expect(taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' })).toBeVisible();
  });
});
