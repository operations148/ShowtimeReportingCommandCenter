import {
  test, expect, installApi, bootApp, openTaskManagement, fail, taskItem, taskItems
} from './harness';
import * as F from './fixtures';

/**
 * Status-grouped List view.
 *
 * Every test here drives the real component through the intercepting harness — no component
 * is rendered in isolation and no assertion inspects internal state, so what is verified is
 * what a user can actually see and operate at that viewport.
 *
 * The seven-status Operations fixture is opted into per test via `statuses`, mirroring the
 * fact that a Space only ever has those statuses after somebody explicitly applied the
 * template to it.
 */

const OPS = F.OPS_STATUS_IDS;

/** A group, addressed by its accessible name — `<section aria-label>` exposes role=region. */
const group = (page: any, name: string, count: number) =>
  page.getByRole('region', { name: `${name}, ${count} task${count === 1 ? '' : 's'}` });

/**
 * The button that opens a task's drawer.
 *
 * `exact` is required, not cosmetic: every per-row control names its target ("Move “X” up",
 * "Archive “X”"), so a substring match on a task title resolves to four controls at once.
 */
const titleBtn = (scope: any, title: string) =>
  scope.getByRole('button', { name: title, exact: true });

/** The task titles a group is showing, in order, at either viewport. */
async function orderIn(scope: any): Promise<string[]> {
  const rows = scope.locator('table tbody tr, ul > li').filter({ visible: true });
  return rows.evaluateAll((els: Element[]) =>
    els.map(e => e.querySelector('button')?.textContent?.trim() ?? ''));
}

/** Tasks placed across the seven operational statuses. */
function opsTasks() {
  const base = JSON.parse(JSON.stringify(F.tasks[0]));
  const mk = (over: Record<string, unknown>) => ({
    ...base, assigneeActorIds: [], subtaskCount: 0, time_estimate_seconds: null,
    due_date: null, ...over
  });
  return [
    mk({ id: 'ops-1', title: 'Drain and refill', status_id: OPS.todo, position: 1000, priority: 'high' }),
    mk({ id: 'ops-2', title: 'Replace filter unit', status_id: OPS.todo, position: 2000, priority: 'normal' }),
    mk({ id: 'ops-3', title: 'Awaiting supplier quote', status_id: OPS.waiting, position: 3000, priority: 'low' }),
    mk({ id: 'ops-4', title: 'Pump rebuild in progress', status_id: OPS.inProgress, position: 4000, priority: 'urgent',
         assigneeActorIds: [F.ACTOR_OTHER] }),
    mk({ id: 'ops-5', title: 'Closed out last week', status_id: OPS.done, position: 5000, priority: 'normal' })
  ];
}

test.describe('Status-grouped List view', () => {
  test('seven empty groups: every status keeps a visible header, colour and zero count', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: [] });
    await bootApp(page);
    await openTaskManagement(page);

    for (const name of ['TO DO', 'IN PROGRESS', 'WAITING', 'REVIEW', 'DONE', 'BLOCKED', 'TO SCHEDULE']) {
      await expect(group(page, name, 0)).toBeVisible();
    }
    // An empty List shows its groups rather than one blank slate: the groups are what you add
    // the first task into.
    await expect(taskItems(page)).toHaveCount(0);
  });

  test('the seven groups render in the required operational order', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: [] });
    await bootApp(page);
    await openTaskManagement(page);

    // Auto-retrying: a plain allInnerTexts() reads whatever is mounted at that instant and
    // would race the first render.
    await expect(page.locator('#task-management-view').getByRole('region').locator('h3'))
      .toHaveText(['TO DO', 'IN PROGRESS', 'WAITING', 'REVIEW', 'DONE', 'BLOCKED', 'TO SCHEDULE']);
  });

  test('mixed counts: each group shows its own total and only its own tasks', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(group(page, 'TO DO', 2)).toBeVisible();
    await expect(group(page, 'IN PROGRESS', 1)).toBeVisible();
    await expect(group(page, 'WAITING', 1)).toBeVisible();
    await expect(group(page, 'REVIEW', 0)).toBeVisible();
    await expect(group(page, 'BLOCKED', 0)).toBeVisible();

    const todo = group(page, 'TO DO', 2);
    await expect(titleBtn(todo, 'Drain and refill')).toBeVisible();
    await expect(titleBtn(todo, 'Replace filter unit')).toBeVisible();
    await expect(titleBtn(todo, 'Pump rebuild in progress')).toHaveCount(0);
  });

  test('an empty group states it is empty rather than leaving a blank gap', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(group(page, 'REVIEW', 0)).toContainText('Nothing in REVIEW right now.');
  });

  test('every group carries the same six column headers', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'columns are the wide-viewport presentation');
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    for (const name of ['TO DO', 'IN PROGRESS', 'WAITING']) {
      const th = group(page, name, name === 'TO DO' ? 2 : 1).locator('thead th');
      // Auto-retrying, so this waits for the group to render rather than reading an empty
      // list the instant the view mounts.
      await expect(th, `${name} column headers`).toHaveText(
        ['Task', 'Assignee', 'Priority', 'Due', 'Tracked', 'Actions']);
    }
  });

  test('DONE starts collapsed but says how much it is holding', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    // freshPrefs: this test is specifically about what a Space looks like on FIRST visit.
    await bootApp(page, { freshPrefs: true });
    await openTaskManagement(page);

    const done = group(page, 'DONE', 1);
    await expect(done).toBeVisible();
    // Collapsed by default — but the count and an explicit "hidden" note stay on screen, so
    // nothing has silently disappeared.
    await expect(done.getByRole('button', { name: /^Expand DONE/ })).toBeVisible();
    await expect(done).toContainText('1 hidden');
    await expect(titleBtn(done, 'Closed out last week')).toHaveCount(0);
  });

  test('a group expands and collapses, and the preference survives a reload', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page, { freshPrefs: true });
    await openTaskManagement(page);

    await group(page, 'DONE', 1).getByRole('button', { name: /^Expand DONE/ }).click();
    await expect(titleBtn(group(page, 'DONE', 1), 'Closed out last week')).toBeVisible();

    // Collapse an open one too, so the persisted set is not just "the defaults".
    await group(page, 'TO DO', 2).getByRole('button', { name: /^Collapse TO DO/ }).click();
    await expect(titleBtn(group(page, 'TO DO', 2), 'Drain and refill')).toHaveCount(0);

    await page.reload();
    await openTaskManagement(page);

    await expect(titleBtn(group(page, 'DONE', 1), 'Closed out last week')).toBeVisible();
    await expect(group(page, 'TO DO', 2).getByRole('button', { name: /^Expand TO DO/ })).toBeVisible();
  });

  test('search narrows every group at once and the counts follow the query', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#task-search').fill('filter unit');

    await expect(group(page, 'TO DO', 1)).toBeVisible();
    // Groups that no longer match stay on screen at zero rather than vanishing.
    await expect(group(page, 'IN PROGRESS', 0)).toBeVisible();
    await expect(group(page, 'WAITING', 0)).toBeVisible();
    await expect(taskItems(page)).toHaveCount(1);
  });

  test('priority and assignee filters apply across groups, and assignee is sent to the server', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#f-priority').selectOption('urgent');
    await expect(group(page, 'IN PROGRESS', 1)).toBeVisible();
    await expect(group(page, 'TO DO', 0)).toBeVisible();
    await expect(taskItems(page)).toHaveCount(1);

    await page.locator('#f-priority').selectOption('');
    await page.locator('#f-assignee').selectOption(F.ACTOR_OTHER);
    await expect(taskItems(page)).toHaveCount(1);
    await expect(group(page, 'IN PROGRESS', 1)).toBeVisible();
    await expect(group(page, 'TO DO', 0)).toBeVisible();
    // Filtering assignees in the browser would have left page totals and group counts
    // describing the unfiltered set, so it must reach the server.
    expect(api.requests().some(r => r.includes(`assigneeActorId=${F.ACTOR_OTHER}`))).toBe(true);
  });

  test('the due-date filter narrows groups too, and reaches a collapsed one', async ({ page }) => {
    const tasks = opsTasks();
    tasks[0].due_date = '2026-09-10T00:00:00.000Z';   // TO DO
    tasks[4].due_date = '2026-09-05T00:00:00.000Z';   // DONE — collapsed by default
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks });
    await bootApp(page, { freshPrefs: true });
    await openTaskManagement(page);

    await page.locator('#f-due').fill('2026-09-30');

    await expect(group(page, 'TO DO', 1)).toBeVisible();
    await expect(group(page, 'WAITING', 0)).toBeVisible();
    // A collapsed group must not swallow matches: DONE is collapsed by default, but the
    // filter has results in it, so those rows are revealed rather than silently withheld.
    await expect(titleBtn(group(page, 'DONE', 1), 'Closed out last week')).toBeVisible();
    await expect(taskItems(page)).toHaveCount(2);
  });

  test('a filter that matches nothing gives one clear message, not seven empty tables', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#task-search').fill('zzzzz-no-such-task');
    await expect(page.getByText('No tasks here yet')).toBeVisible();
    await expect(page.getByText('matches the current filters')).toBeVisible();
    await expect(taskItems(page)).toHaveCount(0);
  });

  test('moving a task to another status re-groups it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await taskItem(page, 'Drain and refill')
      .getByLabel('Move “Drain and refill” to a different status')
      .selectOption(OPS.blocked);

    await expect(titleBtn(group(page, 'BLOCKED', 1), 'Drain and refill')).toBeVisible();
    await expect(group(page, 'TO DO', 1)).toBeVisible();
  });

  test('a rejected move is reported and never leaves the task looking moved', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('PATCH /api/tasks/ops-1', 409,
      fail('TASK_VERSION_CONFLICT', 'This record was modified by someone else. Reload and try again.'));

    await taskItem(page, 'Drain and refill')
      .getByLabel('Move “Drain and refill” to a different status')
      .selectOption(OPS.blocked);

    await expect(page.getByRole('alert')).toContainText('changed elsewhere');
    // Authoritative state was refetched, so the task is still where the server says it is.
    await expect(titleBtn(group(page, 'TO DO', 2), 'Drain and refill')).toBeVisible();
    await expect(group(page, 'BLOCKED', 0)).toBeVisible();
  });

  test('manual ordering inside a status moves a task within its own group', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    const todo = group(page, 'TO DO', 2);
    // Poll rather than read once: evaluateAll() does not auto-retry, so a bare read can land
    // before the group has rendered and come back empty.
    await expect(async () => {
      expect(await orderIn(group(page, 'TO DO', 2))).toEqual(
        ['Drain and refill', 'Replace filter unit']);
    }).toPass();

    await todo.getByRole('button', { name: 'Move “Replace filter unit” up' }).click();
    await expect(async () => {
      expect(await orderIn(group(page, 'TO DO', 2))).toEqual(
        ['Replace filter unit', 'Drain and refill']);
    }).toPass();

    // It stayed in TO DO — reordering must never push a task across a status boundary.
    await expect(group(page, 'TO DO', 2)).toBeVisible();
    await expect(group(page, 'IN PROGRESS', 1)).toBeVisible();
  });

  test('inline Add Task creates into the group it was opened from', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Add task to WAITING' }).click();
    await page.getByLabel('New task title in WAITING').fill('Chase the parts order');
    await page.getByRole('button', { name: 'Create task in WAITING' }).click();

    await expect(titleBtn(group(page, 'WAITING', 2), 'Chase the parts order')).toBeVisible();
    // It did not land in the default status.
    await expect(group(page, 'TO DO', 2)).toBeVisible();
  });

  test('inline Add Task into a collapsed group expands it first', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page, { freshPrefs: true });
    await openTaskManagement(page);

    // DONE is collapsed by default.
    await page.getByRole('button', { name: 'Add task to DONE' }).click();
    const input = page.getByLabel('New task title in DONE');
    await expect(input).toBeVisible();
    await input.fill('Retro write-up');
    await page.getByRole('button', { name: 'Create task in DONE' }).click();

    await expect(titleBtn(group(page, 'DONE', 2), 'Retro write-up')).toBeVisible();
  });

  test('a rejected inline creation is reported and invents no task', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    api.failNext('POST /api/tasks', 403, fail('TASK_FORBIDDEN', 'You cannot create tasks here.'));

    await page.getByRole('button', { name: 'Add task to WAITING' }).click();
    await page.getByLabel('New task title in WAITING').fill('Should not appear');
    await page.getByRole('button', { name: 'Create task in WAITING' }).click();

    await expect(page.getByRole('alert')).toContainText('cannot create tasks');
    await expect(titleBtn(page, 'Should not appear')).toHaveCount(0);
    await expect(group(page, 'WAITING', 1)).toBeVisible();
  });

  test('a subtask never surfaces as a root task in any group', async ({ page }) => {
    const tasks = [...opsTasks(), {
      ...JSON.parse(JSON.stringify(F.subtask)),
      id: 'ops-sub', parent_task_id: 'ops-1', status_id: OPS.todo,
      title: 'Subtask that must stay nested'
    }];
    const api = await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(titleBtn(page, 'Subtask that must stay nested')).toHaveCount(0);
    // TO DO holds the two root tasks only — the subtask is excluded from the count as well
    // as from the rows, which is what makes the count trustworthy.
    await expect(group(page, 'TO DO', 2)).toBeVisible();
    expect(api.requests().some(r => r.includes('rootOnly=true'))).toBe(true);
  });

  test('archived tasks stay out of the groups until asked for, then are labelled', async ({ page }) => {
    const tasks = opsTasks();
    tasks[1].archived_at = '2026-08-10T00:00:00.000Z';
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(group(page, 'TO DO', 1)).toBeVisible();
    await expect(titleBtn(page, 'Replace filter unit')).toHaveCount(0);

    await page.getByLabel('Show archived').check();

    await expect(group(page, 'TO DO', 2)).toBeVisible();
    await expect(taskItem(page, 'Replace filter unit')).toContainText('Archived');
  });

  test('tracked time is exact to the second, not rounded to a minute', async ({ page }, info) => {
    const tasks = opsTasks();
    await installApi(page, {
      role: 'ADMIN', statuses: F.operationsStatuses, tasks,
      // 48 seconds across two entries — the case that used to render as "—".
      timeEntries: [
        { id: 'te-1', task_id: 'ops-1', actor_id: F.ACTOR_ME,
          started_at: '2026-08-20T10:00:00.000Z', ended_at: '2026-08-20T10:00:05.000Z',
          source: 'timer', note: null },
        { id: 'te-2', task_id: 'ops-1', actor_id: F.ACTOR_ME,
          started_at: '2026-08-20T11:00:00.000Z', ended_at: '2026-08-20T11:00:43.000Z',
          source: 'timer', note: null },
        { id: 'te-3', task_id: 'ops-2', actor_id: F.ACTOR_ME,
          started_at: '2026-08-20T12:00:00.000Z', ended_at: '2026-08-20T13:02:00.000Z',
          source: 'timer', note: null }
      ]
    });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(taskItem(page, 'Drain and refill')).toContainText('48s');
    await expect(taskItem(page, 'Replace filter unit')).toContainText('1h 2m');
    // A task with no tracked time never reads as "0s" or an invented duration. The wide
    // table renders a dash in the Tracked cell; the narrow card simply omits the figure,
    // because a dash in a card carries no information a missing value does not.
    const untracked = taskItem(page, 'Awaiting supplier quote');
    if (info.project.name === 'mobile') {
      await expect(untracked).not.toContainText(/\d+\s*[hms]/);
    } else {
      await expect(untracked).toContainText('—');
    }
  });

  test('clicking a task opens the existing detail drawer', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await titleBtn(group(page, 'TO DO', 2), 'Drain and refill').click();
    const drawer = page.getByRole('dialog').filter({ hasText: 'Drain and refill' });
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });

  test('pagination pages through the grouped rows while counts stay whole-query', async ({ page }) => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...JSON.parse(JSON.stringify(F.tasks[1])),
      id: `bulk-${i}`, title: `Bulk task ${String(i).padStart(2, '0')}`,
      status_id: OPS.inProgress, position: i * 10, archived_at: null
    }));
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: many });
    await bootApp(page);
    await openTaskManagement(page);

    // The count is the whole filtered result, not the 50 rows on this page.
    await expect(group(page, 'IN PROGRESS', 60)).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Task pagination' });
    await expect(nav).toContainText('Page 1 of 2');

    await nav.getByRole('button', { name: 'Next' }).click();
    await expect(taskItems(page)).toHaveCount(10);
    await expect(group(page, 'IN PROGRESS', 60)).toBeVisible();
    // A group with no rows on THIS page says where the rest are instead of looking empty.
    await expect(group(page, 'TO DO', 0)).toContainText('Nothing in TO DO right now.');
  });

  test('the Flat layout is still available and drops the grouping', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(group(page, 'TO DO', 2)).toBeVisible();
    await page.getByRole('group', { name: 'Choose a List layout' })
      .getByRole('button', { name: 'Flat' }).click();

    await expect(group(page, 'TO DO', 2)).toHaveCount(0);
    // Every task in one table, and the flat table keeps its Status column.
    await expect(taskItems(page)).toHaveCount(5);
    await expect(taskItem(page, 'Drain and refill')).toContainText('TO DO');
  });

  test('the Board view still works and is reachable from the grouped List', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('group', { name: 'Choose a view' })
      .getByRole('button', { name: 'Board' }).click();

    await expect(page.getByRole('region', { name: /^TO DO column/ })).toBeVisible();
    await expect(page.getByRole('region', { name: /^BLOCKED column/ })).toBeVisible();
    await expect(titleBtn(page, 'Pump rebuild in progress')).toBeVisible();

    await page.getByRole('group', { name: 'Choose a view' })
      .getByRole('button', { name: 'List' }).click();
    await expect(group(page, 'TO DO', 2)).toBeVisible();
  });

  test('mobile stacks each group into cards with its controls intact', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile-only presentation');
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.locator('table').first()).toBeHidden();
    await expect(group(page, 'TO DO', 2)).toBeVisible();

    const card = taskItem(page, 'Drain and refill');
    await expect(card).toBeVisible();
    await expect(card).toContainText('high');
    // The controls are not lost off the side of a narrow screen.
    await expect(card.getByLabel('Move “Drain and refill” to a different status')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Archive “Drain and refill”' })).toBeVisible();

    const box = await page.locator('#task-management-view').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  });

  test('a read-only viewer sees every group but none of the controls', async ({ page }) => {
    await installApi(page, { role: 'READ_ONLY', statuses: F.operationsStatuses, tasks: opsTasks() });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(group(page, 'TO DO', 2)).toBeVisible();
    await expect(titleBtn(group(page, 'TO DO', 2), 'Drain and refill')).toBeVisible();

    await expect(page.getByRole('button', { name: 'Add task to TO DO' })).toHaveCount(0);
    await expect(page.getByLabel('Move “Drain and refill” to a different status')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Move “Drain and refill” up' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive “Drain and refill”' })).toHaveCount(0);
    await expect(group(page, 'TO DO', 2)).toContainText('View only');
  });

  test('a contributor can add and move only within their own scope', async ({ page }) => {
    const tasks = opsTasks();
    tasks[0].created_by = F.ACTOR_ME;      // mine — mutable
    tasks[1].created_by = F.ACTOR_OTHER;   // not mine, not assigned to me — read-only
    await installApi(page, { role: 'TEAM_MEMBER', statuses: F.operationsStatuses, tasks });
    await bootApp(page);
    await openTaskManagement(page);

    // Contributors can create, so the inline Add is offered.
    await expect(page.getByRole('button', { name: 'Add task to TO DO' })).toBeVisible();
    await expect(taskItem(page, 'Drain and refill')
      .getByLabel('Move “Drain and refill” to a different status')).toBeVisible();
    await expect(taskItem(page, 'Replace filter unit')).toContainText('View only');
    await expect(page.getByLabel('Move “Replace filter unit” to a different status')).toHaveCount(0);
  });
});

test.describe('Operations Status Template', () => {
  const openPanel = async (page: any) => {
    await page.locator('#btn-manage-statuses').click();
    return page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
  };

  test('preview is a dry run: it explains the plan and changes nothing', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });   // the default 3-status Space
    await bootApp(page);
    await openTaskManagement(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Preview template changes' }).click();

    await expect(panel.getByText('Dry run — nothing has been changed')).toBeVisible();
    // "To Do", "In Progress" and "Done" already exist, so four are new.
    await expect(panel.getByText('4 to create · 3 reused · 0 left untouched')).toBeVisible();

    const plan = panel.getByRole('list', { name: 'Planned template changes' });
    await expect(plan).toContainText('WAITING');
    await expect(plan).toContainText('Its id is preserved');

    // Nothing was written: the Space still has exactly its three statuses.
    await expect(panel.getByRole('list', { name: 'Statuses in display order' })
      .locator('> li')).toHaveCount(3);
    expect(api.requests().some(r => r.startsWith('POST /api/tasks/statuses/template/apply')))
      .toBe(false);
  });

  test('applying is a second, explicit action that reuses rather than replaces', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    const panel = await openPanel(page);

    // Apply is not even offered until the dry run has been read.
    await expect(panel.getByRole('button', { name: 'Apply template' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Preview template changes' }).click();
    await panel.getByRole('button', { name: 'Apply template' }).click();

    const rows = panel.getByRole('list', { name: 'Statuses in display order' }).locator('> li');
    await expect(rows).toHaveCount(7);
    await panel.getByRole('button', { name: 'Close status manager' }).click();

    // The reused statuses kept their ids, so the tasks that were in them did not move.
    await expect(group(page, 'TO DO', 1)).toBeVisible();
    await expect(group(page, 'IN PROGRESS', 1)).toBeVisible();
    await expect(group(page, 'WAITING', 0)).toBeVisible();
    await expect(taskItem(page, 'Prepare pool inspection report')).toBeVisible();
  });

  test('a second apply is a no-op and says so instead of duplicating statuses', async ({ page }) => {
    await installApi(page, { role: 'ADMIN', statuses: F.operationsStatuses });
    await bootApp(page);
    await openTaskManagement(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Preview template changes' }).click();
    await expect(panel.getByText('already matches the template exactly')).toBeVisible();
    // Nothing to do, so no apply button is offered at all.
    await expect(panel.getByRole('button', { name: 'Apply template' })).toHaveCount(0);
    await expect(panel.getByRole('list', { name: 'Statuses in display order' })
      .locator('> li')).toHaveCount(7);
  });

  test('statuses outside the template are kept, with their task count shown', async ({ page }) => {
    const statuses = [
      ...JSON.parse(JSON.stringify(F.statuses)),
      { id: 'status-extra', space_id: F.SPACE_A, name: 'Cancelled', category: 'done',
        color: '#DB2777', position: 4000, is_default: false, version: 1, archived_at: null }
    ];
    const tasks = JSON.parse(JSON.stringify(F.tasks));
    tasks[2].status_id = 'status-extra';

    await installApi(page, { role: 'ADMIN', statuses, tasks });
    await bootApp(page);
    await openTaskManagement(page);
    const panel = await openPanel(page);

    await panel.getByRole('button', { name: 'Preview template changes' }).click();
    const plan = panel.getByRole('list', { name: 'Planned template changes' });
    await expect(plan).toContainText('Cancelled');
    await expect(plan).toContainText('it holds 1 task and is never deleted or archived');

    await panel.getByRole('button', { name: 'Apply template' }).click();
    // Seven template statuses plus the untouched extra.
    await expect(panel.getByRole('list', { name: 'Statuses in display order' })
      .locator('> li')).toHaveCount(8);
    await expect(panel.getByText('Cancelled')).toBeVisible();
  });

  test('a contributor is never offered the template at all', async ({ page }) => {
    await installApi(page, { role: 'TEAM_MEMBER' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.locator('#btn-manage-statuses')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview template changes' })).toHaveCount(0);
  });
});
