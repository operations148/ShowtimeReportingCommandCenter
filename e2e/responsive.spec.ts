import { test, expect, installApi, bootApp, openTaskManagement } from './harness';
import * as path from 'path';

/**
 * Screenshots land in e2e/.artifacts/, which is gitignored and outside src/, so they never
 * reach the production bundle.
 */
const SHOTS = path.join(__dirname, '.artifacts', 'screenshots');

/** Nothing on the page may force the document to scroll sideways. */
async function assertNoHorizontalOverflow(page: any) {
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth
  }));
  expect(overflow.docScroll, 'the document must not scroll horizontally')
    .toBeLessThanOrEqual(overflow.docClient + 1);
}

test.describe('Responsive layout', () => {
  test('desktop 1440x900 shows the sidebar inline and the full table', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop-only assertions');
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // The Spaces sidebar is inline, so the mobile opener is not offered.
    await expect(page.getByRole('navigation', { name: 'Spaces and Lists' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Spaces and Lists' })).toBeHidden();
    // Desktop table is the visible presentation.
    await expect(page.locator('table')).toBeVisible();

    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'tasks-list-1440.png'), fullPage: true });
  });

  test('tablet 1024x768 keeps content readable without sideways scrolling', async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet', 'tablet-only assertions');
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.locator('#task-management-view')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'tasks-list-1024.png'), fullPage: true });
  });

  test('mobile 390x844 swaps the table for cards and offers a Spaces drawer', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile-only assertions');
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // The wide table is hidden; the card list takes over.
    await expect(page.locator('table')).toBeHidden();
    const card = page.getByRole('button', { name: 'Prepare pool inspection report' })
      .filter({ visible: true });
    await expect(card).toHaveCount(1);
    await expect(card).toBeVisible();

    // The inline sidebar is replaced by a drawer.
    const opener = page.getByRole('button', { name: 'Open Spaces and Lists' });
    await expect(opener).toBeVisible();
    await opener.click();
    const drawer = page.getByRole('dialog', { name: 'Spaces and Lists' });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Delivery');

    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, 'tasks-drawer-390.png') });

    await drawer.getByRole('button', { name: 'Close navigation' }).click();
    await expect(drawer).toBeHidden();
    await page.screenshot({ path: path.join(SHOTS, 'tasks-list-390.png'), fullPage: true });
  });

  test('the task modal fits inside the viewport at every width', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await expect(modal).toBeVisible();

    // Regression guard for the transformed-ancestor bug: the dialog must be viewport-anchored,
    // so its close control has to sit inside the visible viewport.
    const close = modal.getByRole('button', { name: 'Close' });
    const box = await close.boundingBox();
    const vp = page.viewportSize()!;
    expect(box, 'the modal close control must be laid out').not.toBeNull();
    expect(box!.y, 'the modal must not render above the viewport').toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(vp.height);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeLessThan(vp.width);

    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, `task-modal-${vp.width}.png`) });
  });

  test('the board scrolls inside its own container, not the page', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: /To Do column/ })).toBeVisible();

    await assertNoHorizontalOverflow(page);
    const vp = page.viewportSize()!;
    await page.screenshot({ path: path.join(SHOTS, `task-board-${vp.width}.png`) });
  });

  test('the status manager fits the viewport at every width', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-manage-statuses').click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.width).toBeLessThanOrEqual(vp.width);

    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: path.join(SHOTS, `status-manager-${vp.width}.png`) });
  });
});
