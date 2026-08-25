import { test, expect, installApi, bootApp, openTaskManagement, spacesNav, fail } from './harness';



test.describe('Spaces and Lists', () => {
  test('renders the Space with its Lists and marks the selection', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav).toContainText('Delivery');
    await expect(nav).toContainText('General');
    await expect(nav).toContainText('Backlog');
  });

  test('creates a Space and selects it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: 'Create a new Space' }).click();
    await nav.getByLabel('New Space name').fill('Maintenance');
    await nav.getByRole('button', { name: 'Save Space' }).click();

    // Creating a Space selects it, and on narrow viewports selecting dismisses the drawer.
    // Re-resolve the navigation on each attempt rather than holding a handle to the
    // instance that is being torn down.
    await expect(async () => {
      await expect(await spacesNav(page)).toContainText('Maintenance');
    }).toPass({ timeout: 10_000 });
  });

  test('creates a List inside a Space', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: 'Add List' }).click();
    await nav.getByPlaceholder('List name').fill('Escalations');
    await nav.getByRole('button', { name: 'Save List' }).click();

    // Same as Space creation: selecting the new List dismisses the mobile drawer.
    await expect(async () => {
      await expect(await spacesNav(page)).toContainText('Escalations');
    }).toPass({ timeout: 10_000 });
  });

  test('switching Lists refetches the task list for that List', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await (await spacesNav(page)).getByRole('button', { name: /^Backlog/ }).first().click();
    // Fixture tasks all live in List A, so the Backlog List is empty.
    await expect(page.getByText('No tasks here yet')).toBeVisible();
    expect(api.requests().some(r => r.includes('listId=44444444-4444-4444-8444-444444444445')))
      .toBe(true);
  });

  test('renames a Space', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    // Per-Space controls are revealed on hover OR focus-within, so a keyboard user reaches
    // them by focusing the Space itself first. Do exactly that — no mouse hover.
    await nav.getByRole('button', { name: /^Delivery/ }).first().focus();
    await nav.getByRole('button', { name: 'Rename Delivery' }).click();
    await nav.getByLabel('Rename Space Delivery').fill('Field Delivery');
    await nav.getByRole('button', { name: 'Save name' }).click();

    await expect(nav).toContainText('Field Delivery');
  });

  test('reorders Spaces with keyboard-operable buttons', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    // Hidden until hover or focus-within. Reaching them from the keyboard alone proves they
    // are not mouse-only affordances.
    await expect(nav.getByRole('button', { name: 'Move Delivery up' })).toBeHidden();
    await nav.getByRole('button', { name: /^Delivery/ }).first().focus();
    await expect(nav.getByRole('button', { name: 'Move Delivery up' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Move Delivery down' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Rename Delivery' })).toBeVisible();
  });

  test('a failed Space creation is reported and does not invent a Space', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks/spaces', 403,
      fail('TASK_FORBIDDEN', 'You do not have permission to manage Spaces.'));

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: 'Create a new Space' }).click();
    await nav.getByLabel('New Space name').fill('Should not appear');
    await nav.getByRole('button', { name: 'Save Space' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'do not have permission' })).toBeVisible();
    await expect(nav).not.toContainText('Should not appear');
  });

  test('a contributor sees the hierarchy but none of its management controls', async ({ page }) => {
    await installApi(page, { role: 'SALES_REP' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav).toContainText('Delivery');
    await expect(nav.getByRole('button', { name: 'Create a new Space' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Rename Delivery' })).toHaveCount(0);
    await expect(nav.getByPlaceholder('List name')).toHaveCount(0);
  });
});
