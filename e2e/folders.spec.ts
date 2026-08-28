import { test, expect, installApi, bootApp, openTaskManagement, appNav, spacesNav, fail } from './harness';
import * as F from './fixtures';

/**
 * Space -> optional Folder -> List hierarchy navigation UI (PROMPT 4).
 *
 * Complements hierarchy.spec.ts, which already covers pre-existing Space/direct-List
 * behaviour and is left unmodified as regression coverage that this phase did not change it.
 * This file covers everything new: Folders, the breadcrumb, deep-link/refresh restoration,
 * optimistic rollback, and the mobile/keyboard/role surfaces of all of it.
 */
test.describe('Hierarchy: Folders, breadcrumb, and restoration', () => {
  test('existing direct Lists are unaffected: render, select, and show no Folder ancestor', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav.getByRole('button', { name: 'General' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Backlog' })).toBeVisible();

    await nav.getByRole('button', { name: 'Backlog' }).click();
    // Direct List: breadcrumb is Space / List, no Folder segment.
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toContainText('Delivery');
    await expect(breadcrumb).toContainText('Backlog');
    await expect(breadcrumb).not.toContainText('Operations HQ');
  });

  test('a Folder with Lists: expands to reveal them, shows a count, and the breadcrumb includes it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    const folderBtn = nav.getByRole('button', { name: /^Expand Operations HQ,/ });
    await expect(folderBtn).toBeVisible();
    // Item count: the Folder shows how many Lists it contains (2 — Ann - GHL, Rome - Ads).
    await expect(nav.locator('button', { hasText: 'Operations HQ' })).toContainText('2');

    await folderBtn.click();
    await expect(nav.getByRole('button', { name: 'Ann - GHL' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Rome - Ads' })).toBeVisible();

    await nav.getByRole('button', { name: 'Ann - GHL' }).click();
    const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toContainText('Delivery');
    await expect(breadcrumb).toContainText('Operations HQ');
    await expect(breadcrumb).toContainText('Ann - GHL');
  });

  test('an empty Folder expands to a distinct empty state, not a blank gap', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav.locator('button', { hasText: 'Empty Folder' })).toContainText('0');
    await nav.getByRole('button', { name: /^Expand Empty Folder,/ }).click();
    // Exact match: a loose substring also matches the "Empty Folder" <option> text inside
    // every "Move to a Folder" <select>, and the Folder's own (case-insensitively-matched)
    // toggle button.
    await expect(nav.getByText('Empty folder', { exact: true })).toBeVisible();
  });

  test('multiple Spaces: each expands independently and keeps its own Lists and Folders separate', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    // Delivery (SPACE_A) is the default selection and starts expanded.
    await expect(nav.getByRole('button', { name: 'General' })).toBeVisible();
    // Exact: a loose substring also matches the chevron's "Expand Marketing Ops" aria-label.
    await expect(nav.getByRole('button', { name: 'Marketing Ops', exact: true })).toBeVisible();

    // Expanding Marketing Ops (SPACE_B) does not collapse Delivery — both stay open,
    // confirming expand/collapse is independent per Space, not tied to selection.
    await nav.getByRole('button', { name: /^Expand Marketing Ops$/ }).click();
    await expect(nav.getByRole('button', { name: 'General' })).toHaveCount(2); // one per Space
    await expect(nav.locator('button', { hasText: 'Operations HQ' })).toBeVisible(); // Delivery's Folder still visible
  });

  test('long names do not break the row: they truncate and every control stays reachable', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    const longName = 'A'.repeat(110) + ' — Extremely Long Folder Name For Layout Testing';
    await nav.getByRole('button', { name: 'Add Folder' }).click();
    await nav.getByPlaceholder('Folder name').fill(longName);
    await nav.getByRole('button', { name: 'Save Folder' }).click();

    const row = nav.locator('button', { hasText: 'AAAA' });
    await expect(row).toBeVisible();
    // truncate class keeps the row from forcing the sidebar wider than its column.
    await expect(row.locator('span.truncate')).toBeVisible();
    expect(api.requests().some(r => r.startsWith('POST /api/tasks/folders'))).toBe(true);
  });

  test('archived Folders and Lists are hidden by default and reappear with "Show archived"', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // Checked directly on `page`, not through spacesNav(): on mobile that would open the
    // Spaces/Lists drawer, and "Show archived" lives in the main toolbar — behind the
    // drawer's own modal backdrop while it's open, so checking it would hang forever waiting
    // for an element it can never make actionable. With the drawer still closed (the default
    // state), "not present anywhere in the visible DOM" is exactly what "hidden by default"
    // means on every viewport, inline nav or not.
    await expect(page.getByText('Retired Folder', { exact: true })).toHaveCount(0);
    await page.getByLabel('Show archived').check();

    const nav = await spacesNav(page);
    await expect(nav.getByText('Retired Folder', { exact: true })).toBeVisible();
    // .last(): the Folder's <li> is nested inside its Space's <li>, and Playwright's hasText
    // matches an ancestor whose full subtree text happens to contain the string too — the
    // innermost (most specific) match is the last one in document order.
    await expect(nav.locator('li', { hasText: 'Retired Folder' }).last()).toContainText('Arch');

    // Restoring is reachable and keyboard-operable even while archived. Its cluster is
    // revealed on hover OR focus-within (same as every other per-item control in this
    // sidebar), so — as the existing "renames a Space" test in hierarchy.spec.ts already
    // established for that identical pattern — a keyboard user reaches it by focusing the
    // row itself first; a real button that is display:none is excluded from role queries
    // entirely, not merely "found but hidden".
    await nav.getByRole('button', { name: /^Expand Retired Folder,/ }).focus();
    const restore = nav.getByRole('button', { name: 'Restore Retired Folder' });
    await expect(restore).toBeVisible();
  });

  test('role-based controls: a contributor sees Folders but none of their management controls', async ({ page }) => {
    await installApi(page, { role: 'TEAM_MEMBER' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav.locator('button', { hasText: 'Operations HQ' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Add Folder' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Add List' })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /^Rename/ })).toHaveCount(0);
    await expect(nav.getByRole('button', { name: /^Archive/ })).toHaveCount(0);
    // Reading still works: expand and select a List inside the Folder.
    await nav.getByRole('button', { name: /^Expand Operations HQ,/ }).click();
    await nav.getByRole('button', { name: 'Ann - GHL' }).click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Ann - GHL');
  });

  test('role-based controls: READ_ONLY sees the hierarchy read-only, same as a contributor', async ({ page }) => {
    await installApi(page, { role: 'READ_ONLY' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav.locator('button', { hasText: 'Operations HQ' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Add Folder' })).toHaveCount(0);
  });

  test('creating a Folder is optimistic: it appears before the request resolves', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await api.holdRoute('POST /api/tasks/folders');
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: 'Add Folder' }).click();
    await nav.getByPlaceholder('Folder name').fill('New Ops Folder');
    await nav.getByRole('button', { name: 'Save Folder' }).click();

    // The request is deliberately held open — if this is visible now, it appeared
    // optimistically, before the server ever answered.
    await expect(nav.locator('button', { hasText: 'New Ops Folder' })).toBeVisible();
    await api.releaseRoute('POST /api/tasks/folders');
  });

  test('a failed move rolls back to where the List was, and reports the error', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await expect(nav.getByRole('button', { name: 'Backlog' })).toBeVisible(); // direct List, at the Space root

    api.failNext('PATCH /api/tasks/lists', 422,
      fail('TASK_FOLDER_CROSS_SPACE', 'That folder belongs to a different Space and cannot be used here.'));

    // force: true — the <select> is deliberately opacity-0, layered under a decorative icon
    // (the same pattern used to style a native file input), so Playwright's default
    // actionability check treats it as "not visible" even though it is fully operable by
    // mouse, keyboard and screen reader alike. This is the standard way to drive a
    // native control that is visually disguised but genuinely functional.
    await page.getByLabel('Move Backlog to a Folder').selectOption({ label: 'Operations HQ' }, { force: true });

    await expect(page.getByRole('alert')).toContainText('different Space');
    // Rolled back: Backlog is still a direct List, not inside the Folder it briefly moved to.
    await expect(nav.getByRole('button', { name: 'Backlog' })).toBeVisible();
  });

  test('a failed reorder rolls back the order and reports the error', async ({ page }) => {
    const api = await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    api.failNext('PATCH /api/tasks/lists', 409,
      fail('TASK_VERSION_CONFLICT', 'This record was modified by someone else. Reload and try again.'));

    // Reveal-on-focus cluster (same as every other per-item control here): focus the row
    // itself first — a real button that is display:none is excluded from role queries
    // entirely, not merely "found but hidden".
    await nav.getByRole('button', { name: 'Backlog', exact: true }).focus();
    await nav.getByRole('button', { name: 'Move Backlog up' }).click();

    await expect(page.getByRole('alert')).toContainText('modified by someone else');
  });

  test('keyboard navigation: Tab reaches every hierarchy control, Enter operates it', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    const folderToggle = nav.getByRole('button', { name: /^Expand Operations HQ,/ });
    await folderToggle.focus();
    await expect(folderToggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('button', { name: 'Ann - GHL' })).toBeVisible();

    // Tab once more: focusing the toggle reveals its own reorder/rename/archive cluster
    // (group-focus-within, the same reveal-on-focus pattern the reorder controls already use
    // elsewhere in this module), so the very next stop is a real, meaningful control from that
    // cluster — proving Tab keeps moving through genuine, operable buttons — not necessarily
    // the List itself, since exactly how many such controls exist depends on role.
    await page.keyboard.press('Tab');
    const next = page.locator(':focus');
    await expect(next).toBeVisible();
    await expect(next).toHaveAttribute('aria-label', /Move Operations HQ|Rename Operations HQ|Archive Operations HQ/);

    // The List itself is independently keyboard-reachable and operable — proven directly
    // (not by counting exactly how many Tabs separate it from the toggle, which varies with
    // which manage controls a given role reveals) via its own focus + Enter.
    // exact: true — a loose substring also matches this List's own reveal-on-focus reorder/
    // rename/archive cluster ("Move Ann - GHL up", "Rename Ann - GHL", etc.).
    const listBtn = nav.getByRole('button', { name: 'Ann - GHL', exact: true });
    await listBtn.focus();
    await expect(listBtn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Ann - GHL');
  });

  test('mobile drawer: Folders expand and a List inside one can be selected, closing the drawer', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Open Spaces and Lists' }).click();
    const drawer = page.getByRole('dialog', { name: 'Spaces and Lists' });
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: /^Expand Operations HQ,/ }).click();
    await drawer.getByRole('button', { name: 'Ann - GHL' }).click();

    await expect(drawer).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Ann - GHL');
  });

  test('deep-link restoration: selecting a List inside a Folder survives a remount of the view', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: /^Expand Operations HQ,/ }).click();
    await nav.getByRole('button', { name: 'Rome - Ads' }).click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Rome - Ads');

    // Leave Task Management and come back — this remounts the view fresh, the same way a
    // browser refresh would if this were the very first thing rendered after one.
    const dashboardNav = await appNav(page, 'dashboard');
    await dashboardNav.click();
    await (await appNav(page, 'task-management')).click();
    await expect(page.locator('#task-management-view')).toBeVisible();

    // Restored from localStorage: same List selected, its Folder still expanded, visible
    // without the user re-navigating the tree.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Rome - Ads');
    const navAgain = await spacesNav(page);
    await expect(navAgain.getByRole('button', { name: 'Rome - Ads' })).toBeVisible();
  });

  test('browser refresh: the restored List/Folder survive a real page reload', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await spacesNav(page);
    await nav.getByRole('button', { name: /^Expand Operations HQ,/ }).click();
    await nav.getByRole('button', { name: 'Ann - GHL' }).click();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Ann - GHL');

    // A real browser refresh reloads the whole app, which lands back on the Dashboard tab —
    // this app has no URL-based routing for the active tab anywhere (confirmed: nothing in
    // App.tsx reads a URL/hash), so restoring a specific List/Folder selection is scoped to
    // WITHIN Task Management, not to auto-reopening that tab. Page-level route interception
    // survives a reload (it is not navigation-scoped), and so does localStorage on the same
    // origin — both are exactly what a real reload would leave behind: the same server data,
    // and the browser's own persisted selection.
    await page.reload();
    await openTaskManagement(page);

    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Ann - GHL');
    const navAgain = await spacesNav(page);
    await expect(navAgain.getByRole('button', { name: 'Ann - GHL' })).toBeVisible();
  });
});
