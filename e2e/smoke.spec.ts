import { test, expect, installApi, bootApp, openTaskManagement , taskItem } from './harness';

test.describe('harness smoke', () => {
  test('boots the app, reaches Task Management, and leaks no API traffic', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);

    await expect(page.locator('#nav-btn-task-management')).toBeVisible();
    await openTaskManagement(page);

    await expect(page.getByRole('heading', { name: 'Task Management' })).toBeVisible();
    await expect(taskItem(page, 'Prepare pool inspection report')).toBeVisible();

    api.assertNoLeaks();
  });
});
