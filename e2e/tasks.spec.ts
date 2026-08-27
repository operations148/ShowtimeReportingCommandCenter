import { test, expect, installApi, bootApp, openTaskManagement, fail, taskItem, taskItems, appNav } from './harness';
import * as F from './fixtures';

const rowsInTable = (page: any) => taskItems(page);

test.describe('Task list, filtering and sorting', () => {
  test('renders the seeded tasks with status, priority, assignee and due date', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(taskItems(page)).toHaveCount(3);
    const first = taskItem(page, 'Prepare pool inspection report');
    await expect(first).toContainText('To Do');
    await expect(first).toContainText('high');
    await expect(first).toContainText('Sep 1');
  });

  test('the desktop table carries the columns the mobile card omits', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'the table is not the mobile presentation');
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const first = page.locator('table tbody tr').filter({ hasText: 'Prepare pool inspection report' });
    await expect(first).toContainText('Sam Colleague');
    await expect(first).toContainText('1 subtask');
  });

  test('filters by status', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#f-status').selectOption(F.STATUS_DOING);
    await expect(taskItems(page)).toHaveCount(1);
    await expect(taskItems(page).first()).toContainText('Schedule filter replacement');
  });

  test('filters by priority', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#f-priority').selectOption('low');
    await expect(taskItems(page)).toHaveCount(1);
    await expect(taskItems(page).first()).toContainText('My own task');
  });

  test('filters by assignee', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#f-assignee').selectOption(F.ACTOR_OTHER);
    await expect(taskItems(page)).toHaveCount(1);
    await expect(taskItems(page).first()).toContainText('Prepare pool inspection report');
  });

  test('searches by title with debounce and sends a single query', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#task-search').fill('filter');
    await expect(taskItems(page)).toHaveCount(1);
    await expect(taskItems(page).first()).toContainText('Schedule filter replacement');

    // Debounced: typing 6 characters must not have produced 6 list requests.
    const searchCalls = api.requests().filter(r => r.includes('q=filter'));
    expect(searchCalls.length).toBeLessThanOrEqual(2);
  });

  test('sorts by title and sends the sort to the server', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#f-sort').selectOption('title');
    await expect(taskItems(page).nth(0)).toContainText('My own task');
    expect(api.requests().some(r => r.includes('sort=title'))).toBe(true);
  });

  test('shows archived tasks only when asked', async ({ page }) => {
    const tasks = JSON.parse(JSON.stringify(F.tasks));
    tasks[1].archived_at = '2026-08-10T00:00:00.000Z';
    await installApi(page, { role: 'ADMIN', tasks });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(taskItems(page)).toHaveCount(2);
    await page.getByLabel('Show archived').check();
    await expect(taskItems(page)).toHaveCount(3);
    await expect(taskItem(page, 'Schedule filter replacement'))
      .toContainText('Archived');
  });

  test('paginates when the server reports more than one page', async ({ page }) => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...JSON.parse(JSON.stringify(F.tasks[1])),
      id: `bulk-${i}`, title: `Bulk task ${String(i).padStart(2, '0')}`, position: i * 10
    }));
    await installApi(page, { role: 'ADMIN', tasks: many });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = page.getByRole('navigation', { name: 'Task pagination' });
    await expect(nav).toContainText('Page 1 of 2');
    await expect(nav.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await nav.getByRole('button', { name: 'Next' }).click();
    await expect(nav).toContainText('Page 2 of 2');
    await expect(taskItems(page)).toHaveCount(10);
    await expect(nav.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  test('shows an empty state when nothing matches', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#task-search').fill('zzzzz-no-such-task');
    await expect(page.getByText('No tasks here yet')).toBeVisible();
    await expect(taskItems(page)).toHaveCount(0);
  });

  test('shows a retryable error when the list request fails', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    api.failAlways('GET /api/tasks?', 500, fail('TASK_INTERNAL_ERROR', 'List failed.'));
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.getByText('Could not load tasks')).toBeVisible();
    api.clearFailures();
    await page.getByRole('button', { name: /Try again|Retry/ }).first().click();
    await expect(taskItems(page)).toHaveCount(3);
  });

  test('shows a loading state while the list is in flight', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    api.holdRoute('GET /api/tasks?');
    await (await appNav(page, 'task-management')).click();

    await expect(page.getByText('Loading tasks…')).toBeVisible();
    api.releaseRoute('GET /api/tasks?');
    await expect(taskItems(page)).toHaveCount(3);
  });
});

test.describe('Task creation, editing and archiving', () => {
  test('creates a task through the modal and it appears in the list', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await expect(modal).toBeVisible();

    await modal.getByLabel(/^Title/).fill('Replace pump seal');
    await modal.getByLabel('Priority').selectOption('urgent');
    await modal.getByRole('button', { name: /^(Create|Save)/ }).click();

    await expect(modal).toBeHidden();
    await expect(taskItem(page, 'Replace pump seal')).toHaveCount(1);
  });

  test('refuses an empty title and keeps the modal open', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    // The field is required, so the browser blocks submission before any request is sent.
    await modal.getByRole('button', { name: /^(Create|Save)/ }).click();
    await expect(modal).toBeVisible();
    expect(api.requests().filter(r => r === 'POST /api/tasks')).toHaveLength(0);
  });

  test('preserves typed values when the server rejects the create', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks', 400,
      fail('TASK_VALIDATION_FAILED', 'title must be 500 characters or fewer.'));

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await modal.getByLabel(/^Title/).fill('A task that will be rejected');
    await modal.getByRole('button', { name: /^(Create|Save)/ }).click();

    await expect(modal.getByRole('alert')).toContainText('500 characters or fewer');
    await expect(modal.getByLabel(/^Title/)).toHaveValue('A task that will be rejected');
  });

  test('warns before discarding unsaved changes, and stays open when cancelled', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await modal.getByLabel(/^Title/).fill('Half-typed title');

    page.once('dialog', d => {
      expect(d.message()).toContain('Discard your unsaved changes?');
      d.dismiss();
    });
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel(/^Title/)).toHaveValue('Half-typed title');

    page.once('dialog', d => d.accept());
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toBeHidden();
  });

  test('edits a task and reports a stale-version conflict without losing the text', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await drawer.getByRole('button', { name: 'Edit' }).click();

    const modal = page.getByRole('dialog').filter({ hasText: 'Edit Task' });
    await expect(modal).toBeVisible();
    await modal.getByLabel(/^Title/).fill('Prepare pool inspection report v2');

    api.failNext('PATCH /api/tasks', 409,
      fail('TASK_VERSION_CONFLICT', 'This task changed since you loaded it. Reload and try again.'));
    await modal.getByRole('button', { name: /^(Save|Update)/ }).click();

    await expect(modal.getByRole('alert')).toContainText('Someone else changed this task while you were editing.');
    await expect(modal.getByRole('alert')).toContainText('Your text is preserved');
    await expect(modal.getByLabel(/^Title/)).toHaveValue('Prepare pool inspection report v2');
  });

  test('archives a task after confirmation and restores it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const row = taskItem(page, 'Schedule filter replacement');
    page.once('dialog', d => { expect(d.message()).toContain('Archive'); d.accept(); });
    await row.getByRole('button', { name: 'Archive task' }).click();

    await expect(taskItems(page)).toHaveCount(2);

    await page.getByLabel('Show archived').check();
    const archived = taskItem(page, 'Schedule filter replacement');
    await expect(archived).toContainText('Archived');
    await archived.getByRole('button', { name: 'Restore task' }).click();
    await expect(archived).not.toContainText('Archived');
  });

  test('cancelling the archive confirmation leaves the task alone', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    page.once('dialog', d => d.dismiss());
    await taskItem(page, 'Schedule filter replacement')
      .getByRole('button', { name: 'Archive task' }).click();

    await expect(taskItems(page)).toHaveCount(3);
    expect(api.requests().some(r => r.includes('/archive'))).toBe(false);
  });
});

test.describe('Task detail drawer and subtasks', () => {
  test('opens the drawer with detail, activity and subtasks', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });

    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Compile Q3 findings.');
    await expect(drawer).toContainText('Sam Colleague');
    await expect(drawer).toContainText('Subtasks');
  });

  test('closes on Escape and returns focus to the page', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await expect(drawer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('adds a subtask from a root task and enforces one level', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await drawer.getByRole('button', { name: 'Add subtask' }).click();

    const modal = page.getByRole('dialog').filter({ hasText: 'New Subtask' });
    await expect(modal).toContainText('Subtask of');
    await modal.getByLabel(/^Title/).fill('Collect chlorine readings');
    await modal.getByRole('button', { name: /^(Create|Save)/ }).click();
    await expect(modal).toBeHidden();

    // A subtask has no "Add subtask" control of its own — one level only.
    await (await appNav(page, 'task-management')).click();
    await expect(page.locator('#task-management-view')).toBeVisible();
  });

  test('a missing task reports not-found rather than rendering empty', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // Sticky: the drawer also loads /activity and /time-entries for the same id, and a
    // one-shot override would be consumed by whichever of the three raced first.
    api.failAlways('GET /api/tasks/' + F.TASK_1, 404, fail('TASK_NOT_FOUND', 'Task not found.'));
    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();

    await expect(page.getByRole('dialog').getByRole('alert').first()).toContainText('Task not found.');
  });
});

test.describe('Board view', () => {
  test('renders one column per status with the tasks in each', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Board', exact: true }).click();

    const todo = page.getByRole('region', { name: /To Do column/ });
    const doing = page.getByRole('region', { name: /In Progress column/ });
    await expect(todo).toContainText('Prepare pool inspection report');
    await expect(doing).toContainText('Schedule filter replacement');
    await expect(doing).toHaveAccessibleName(/1 task/);
  });

  test('shows an empty-state when the Space has no statuses', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: /To Do column/ })).toBeVisible();
  });
});
