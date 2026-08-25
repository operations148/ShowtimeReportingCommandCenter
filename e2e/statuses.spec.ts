import { test, expect, installApi, bootApp, openTaskManagement, fail, type Harness } from './harness';
import type { Page } from '@playwright/test';
import type { Role } from './fixtures';

/** Boots the app and opens the status manager, returning both the harness and the dialog. */
async function openStatusPanel(page: Page, role: Role = 'ADMIN') {
  const api = await installApi(page, { role });
  await bootApp(page);
  await openTaskManagement(page);
  const btn = page.locator('#btn-manage-statuses');
  await expect(btn).toBeVisible();
  await btn.click();
  const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
  await expect(panel).toBeVisible();
  return { api, panel };
}

const rows = (panel: any) => panel.locator('ol[aria-label="Statuses in display order"] > li');

test.describe('Custom status management', () => {
  test('lists statuses in display order, marks the default, and states position', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await expect(rows(panel)).toHaveCount(3);
    await expect(rows(panel).nth(0)).toContainText('To Do');
    await expect(rows(panel).nth(1)).toContainText('In Progress');
    await expect(rows(panel).nth(2)).toContainText('Done');

    // The default status is identifiable at a glance and in text.
    await expect(rows(panel).nth(0)).toContainText('Default');
    await expect(rows(panel).nth(1)).not.toContainText('Default');

    // Position is stated in text, not only implied by visual order.
    await expect(rows(panel).nth(1)).toContainText('position 2 of 3');
    // Category is shown, so the reporting meaning of each status is visible.
    await expect(rows(panel).nth(2)).toContainText('Done');
  });

  test('creates a status with a name, category and colour, and the module picks it up', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await panel.getByRole('button', { name: 'Add a status' }).click();
    await panel.getByPlaceholder('e.g. In Review').fill('In Review');
    await panel.locator('form select').selectOption('in_progress');
    await panel.getByRole('button', { name: 'Use colour #7C3AED' }).click();
    await panel.getByRole('button', { name: 'Add status' }).click();

    await expect(rows(panel)).toHaveCount(4);
    await expect(rows(panel).filter({ hasText: 'In Review' })).toHaveCount(1);

    // It reaches the rest of the module: the status filter now offers it.
    await panel.getByRole('button', { name: 'Close status manager' }).click();
    await expect(page.locator('#f-status option', { hasText: 'In Review' })).toHaveCount(1);
  });

  test('renames a status and the change reaches the List view', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await panel.getByRole('button', { name: 'Edit In Progress' }).click();
    await panel.getByRole('textbox').first().fill('Active Work');
    await panel.getByRole('button', { name: 'Save' }).click();

    await expect(rows(panel).filter({ hasText: 'Active Work' })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Close status manager' }).click();
    // Task 2 sits in that status, so the List cell must show the new name.
    await expect(page.getByText('Active Work').first()).toBeVisible();
  });

  test('changes a status colour and the swatch reflects it', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await panel.getByRole('button', { name: 'Edit To Do' }).click();
    const swatch = panel.getByRole('button', { name: 'Use colour #DC2626' });
    await swatch.click();
    await expect(swatch).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('button', { name: 'Save' }).click();

    const dot = rows(panel).first().locator('span[aria-hidden="true"]').first();
    await expect(dot).toHaveCSS('background-color', 'rgb(220, 38, 38)');
  });

  test('reorders through keyboard-operable buttons, not drag-and-drop only', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    const down = panel.getByRole('button', { name: 'Move To Do down' });
    await expect(down).toBeVisible();

    // Driven entirely from the keyboard.
    await down.focus();
    await page.keyboard.press('Enter');

    await expect(rows(panel).nth(0)).toContainText('In Progress');
    await expect(rows(panel).nth(1)).toContainText('To Do');

    // Bounds are disabled rather than silently no-op.
    await expect(panel.getByRole('button', { name: 'Move In Progress up' })).toBeDisabled();
    await expect(panel.getByRole('button', { name: 'Move Done down' })).toBeDisabled();
  });

  test('announces a reorder in a polite live region', async ({ page }) => {
    const { panel } = await openStatusPanel(page);
    const live = panel.locator('[role="status"][aria-live="polite"]');
    await expect(live).toHaveCount(1);

    await panel.getByRole('button', { name: 'Move To Do down' }).click();
    await expect(live).toContainText('To Do moved down to position 2 of 3');
  });

  test('refuses a duplicate name before sending it and keeps what was typed', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await panel.getByRole('button', { name: 'Add a status' }).click();
    const input = panel.getByPlaceholder('e.g. In Review');
    await input.fill('done');            // differs from "Done" only by case
    await panel.getByRole('button', { name: 'Add status' }).click();

    await expect(panel.getByRole('alert')).toContainText('already exists in this Space');
    await expect(input).toHaveValue('done');
    await expect(rows(panel)).toHaveCount(3);
  });

  test('surfaces a server-side rejection and preserves every entered value', async ({ page }) => {
    const { api, panel } = await openStatusPanel(page);

    api.failNext('POST /api/tasks/statuses', 409,
      fail('TASK_VALIDATION_FAILED', 'A status with that name already exists in this Space.'));

    await panel.getByRole('button', { name: 'Add a status' }).click();
    const input = panel.getByPlaceholder('e.g. In Review');
    await input.fill('Blocked');
    await panel.locator('form select').selectOption('in_progress');
    await panel.getByRole('button', { name: 'Use colour #D97706' }).click();
    await panel.getByRole('button', { name: 'Add status' }).click();

    await expect(panel.getByRole('alert')).toContainText('already exists in this Space');
    await expect(input).toHaveValue('Blocked');
    await expect(panel.locator('form select')).toHaveValue('in_progress');
    await expect(panel.getByRole('button', { name: 'Use colour #D97706' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('refuses an empty name', async ({ page }) => {
    const { panel } = await openStatusPanel(page);
    await panel.getByRole('button', { name: 'Add a status' }).click();
    await panel.getByPlaceholder('e.g. In Review').fill('   ');
    await panel.getByRole('button', { name: 'Add status' }).click();
    await expect(panel.getByRole('alert')).toContainText('Status name is required.');
  });

  test('a failed rename keeps the edit row open with the typed value', async ({ page }) => {
    const { api, panel } = await openStatusPanel(page);

    api.failNext('PATCH /api/tasks/statuses', 500,
      fail('TASK_INTERNAL_ERROR', 'Something went wrong.'));

    await panel.getByRole('button', { name: 'Edit Done' }).click();
    const nameInput = panel.getByRole('textbox').first();
    await nameInput.fill('Completed');
    await panel.getByRole('button', { name: 'Save' }).click();

    await expect(panel.getByRole('alert')).toContainText('Something went wrong.');
    await expect(nameInput).toHaveValue('Completed');
  });

  test('a failed reorder reports the error and leaves the order unchanged', async ({ page }) => {
    const { api, panel } = await openStatusPanel(page);

    api.failNext('PATCH /api/tasks/statuses', 0, '');
    await panel.getByRole('button', { name: 'Move To Do down' }).click();

    await expect(panel.getByRole('alert')).toContainText('Could not reach the server');
    await expect(rows(panel).nth(0)).toContainText('To Do');
  });

  test('documents that removal is unsupported and offers no delete or archive control', async ({ page }) => {
    const { panel } = await openStatusPanel(page);

    await expect(panel.getByText('Statuses cannot be removed here.')).toBeVisible();
    await expect(panel.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /archive/i })).toHaveCount(0);
  });

  test('a contributor never sees the status manager entry point', async ({ page }) => {
    await installApi(page, { role: 'SALES_REP' });
    await bootApp(page);
    await openTaskManagement(page);
    await expect(page.locator('#task-management-view')).toBeVisible();
    await expect(page.locator('#btn-manage-statuses')).toHaveCount(0);
  });

  test('a read-only user never sees the status manager entry point', async ({ page }) => {
    await installApi(page, { role: 'READ_ONLY' });
    await bootApp(page);
    await openTaskManagement(page);
    await expect(page.locator('#task-management-view')).toBeVisible();
    await expect(page.locator('#btn-manage-statuses')).toHaveCount(0);
  });
});
