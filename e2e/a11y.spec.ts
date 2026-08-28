import { test, expect, installApi, bootApp, openTaskManagement, taskItem, taskItems } from './harness';
import type { Page } from '@playwright/test';

const describeFocus = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return null;
  return {
    tag: a.tagName,
    id: a.id || null,
    label: a.getAttribute('aria-label') || a.textContent?.trim().slice(0, 60) || null,
    inDialog: !!a.closest('[role="dialog"],[role="alertdialog"]')
  };
});

/** Resolved focus ring, so a focus indicator can be asserted rather than assumed. */
const focusIndicator = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement;
  const cs = getComputedStyle(a);
  return {
    outlineWidth: cs.outlineWidth,
    outlineStyle: cs.outlineStyle,
    boxShadow: cs.boxShadow,
    classes: a.className
  };
});

/**
 * Measures WCAG 1.4.3 contrast for every leaf text node inside `selector`.
 *
 * Colours are resolved by painting them onto a canvas, because Tailwind v4 emits `oklch()`
 * and parsing that by hand would be wrong. Translucent backgrounds are composited down to the
 * first opaque layer, so a tinted pill is measured against what the eye actually sees.
 */
function measureContrast(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    const toRgba = (color: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (fg: number[], bg: number[]) =>
      [0, 1, 2].map(i => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));

    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map(v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const bgOf = (el: Element): number[] => {
      const layers: number[][] = [];
      let n: Element | null = el;
      while (n) {
        const c = toRgba(getComputedStyle(n).backgroundColor);
        if (c[3] > 0) {
          layers.push(c);
          if (c[3] === 1) break;
        }
        n = n.parentElement;
      }
      let base = [255, 255, 255];
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };

    const bad: string[] = [];
    const roots = Array.from(document.querySelectorAll(sel));
    if (!roots.length) return ['no element matched ' + sel];

    for (const scope of roots) {
      scope.querySelectorAll('p, span, td, th, h1, h2, h3, label, button, a, li, div')
        .forEach(el => {
          const e = el as HTMLElement;
          const text = e.textContent?.trim();
          if (!text) return;
          const cs = getComputedStyle(e);
          if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return;
          // Screen-reader-only text is not rendered, so contrast does not apply.
          if (e.className.toString().includes('sr-only')) return;
          // Leaf text only, so a container is not measured against its own children.
          if (Array.from(e.children).some(c => c.textContent?.trim())) return;

          const size = parseFloat(cs.fontSize);
          const bold = parseInt(cs.fontWeight, 10) >= 700;
          // WCAG 1.4.3 large text: >=24px, or >=18.66px when bold.
          const required = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;

          const bg = bgOf(e);
          const fg = over(toRgba(cs.color), bg);
          const l1 = lum(fg), l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < required) {
            bad.push(
              '"' + text.slice(0, 30) + '" rgb(' + fg + ') on rgb(' + bg + ') = ' +
              ratio.toFixed(2) + ':1, needs ' + required + ':1 (' +
              cs.fontSize + ' / ' + cs.fontWeight + ')'
            );
          }
        });
    }
    return bad;
  }, selector);
}

test.describe('Accessibility', () => {
  test('every interactive control has an accessible name', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const unnamed = await page.evaluate(() => {
      const scope = document.querySelector('#task-management-view');
      if (!scope) return ['no task management view'];
      const bad: string[] = [];
      scope.querySelectorAll('button, a[href], input, select, textarea').forEach(el => {
        const e = el as HTMLElement;
        if (e.getAttribute('aria-hidden') === 'true') return;
        const labelledBy = e.getAttribute('aria-labelledby');
        const named =
          (e.getAttribute('aria-label') || '').trim() ||
          (labelledBy && document.getElementById(labelledBy)?.textContent?.trim()) ||
          (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent?.trim()) ||
          e.closest('label')?.textContent?.trim() ||
          (e.getAttribute('title') || '').trim() ||
          e.textContent?.trim();
        if (!named) bad.push(`${e.tagName}#${e.id || '(no id)'}.${e.className.slice(0, 40)}`);
      });
      return bad;
    });
    expect(unnamed, 'controls without an accessible name').toEqual([]);
  });

  test('the module is reachable and operable by keyboard alone', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#task-search').focus();
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const f = await describeFocus(page);
      seen.push(`${f?.tag}:${f?.label ?? ''}`);
    }
    // Focus actually moved and did not stall on one element (a keyboard trap).
    expect(new Set(seen).size, `focus stalled: ${JSON.stringify(seen)}`).toBeGreaterThan(3);
  });

  test('focused controls render a visible focus indicator', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // Keyboard focus (not a click) is what triggers :focus-visible.
    await page.locator('#task-search').focus();
    await page.keyboard.press('Tab');
    const ind = await focusIndicator(page);

    const hasRing =
      (ind.outlineStyle !== 'none' && parseFloat(ind.outlineWidth) > 0) ||
      (ind.boxShadow && ind.boxShadow !== 'none') ||
      /focus-visible:ring/.test(ind.classes);
    expect(hasRing, `no focus indicator on ${ind.classes}`).toBe(true);
  });

  test('the status manager traps focus, restores it on close, and closes on Escape', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const opener = page.locator('#btn-manage-statuses');
    await opener.focus();
    await page.keyboard.press('Enter');

    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
    await expect(panel).toBeVisible();

    let f = await describeFocus(page);
    expect(f?.inDialog, 'focus must move into the dialog').toBe(true);

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      f = await describeFocus(page);
      expect(f?.inDialog, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      f = await describeFocus(page);
      expect(f?.inDialog, 'focus escaped the dialog backwards').toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('the task modal traps focus and restores it on close', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const opener = page.locator('#btn-new-task');
    await opener.focus();
    await page.keyboard.press('Enter');

    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await expect(modal).toBeVisible();

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const f = await describeFocus(page);
      expect(f?.inDialog, `focus escaped the modal after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('the detail drawer traps focus and restores it on close', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const opener = page.getByRole('button', { name: 'Prepare pool inspection report' }).first();
    await opener.focus();
    await page.keyboard.press('Enter');

    const drawer = page.getByRole('dialog').filter({ hasText: 'Prepare pool inspection report' });
    await expect(drawer).toBeVisible();

    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const f = await describeFocus(page);
      expect(f?.inDialog, `focus escaped the drawer after ${i + 1} tabs`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('dialogs declare their role, modality and an accessible name', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-manage-statuses').click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    await expect(panel).toHaveAccessibleName('Delivery');
    await page.keyboard.press('Escape');

    await page.locator('#btn-new-task').click();
    const modal = page.getByRole('dialog').filter({ hasText: 'New Task' });
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAccessibleName(/New Task/);
  });

  test('the reorder controls are buttons naming the direction and the target', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.locator('#btn-manage-statuses').click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });

    for (const name of ['Move To Do down', 'Move In Progress up', 'Move In Progress down',
                        'Move Done up', 'Edit To Do']) {
      await expect(panel.getByRole('button', { name })).toHaveCount(1);
    }
  });

  test('async outcomes are announced through live regions', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.locator('#btn-manage-statuses').click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });
    const live = panel.locator('[role="status"][aria-live="polite"]');
    await expect(live).toHaveCount(1);
    await panel.getByRole('button', { name: 'Move To Do down' }).click();
    await expect(live).not.toHaveText('');
  });

  test('errors are exposed as alerts, not by colour alone', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.locator('#btn-manage-statuses').click();
    const panel = page.getByRole('dialog').filter({ hasText: 'Custom statuses' });

    await panel.getByRole('button', { name: 'Add a status' }).click();
    await panel.getByPlaceholder('e.g. In Review').fill('Done');
    await panel.getByRole('button', { name: 'Add status' }).click();

    const alert = panel.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText('already exists');
  });

  test('table headers are scoped and the table has a caption', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // The status-grouped List renders one table per group, so this asserts the invariant
    // rather than a fixed number: EVERY table has exactly one caption, whichever layout is
    // on screen.
    // Auto-retrying first, so the counts below are taken after the List has rendered rather
    // than while it is still showing loading skeletons.
    await expect(page.locator('table').first()).toBeAttached();
    const tables = await page.locator('table').count();
    expect(await page.locator('table > caption').count(),
      'every table must carry its own caption').toBe(tables);
    const unscoped = await page.locator('table thead th:not([scope])').count();
    expect(unscoped, 'every header cell must declare a scope').toBe(0);
  });

  test('the List view meets the 4.5:1 contrast minimum', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    const failures = await measureContrast(page, '#task-management-view');
    expect(failures, 'contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the Board view meets the contrast minimum', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: /To Do column/ })).toBeVisible();
    // The view toggle animates its colours; measuring mid-transition reads an intermediate
    // blend rather than the state a user actually sits in front of.
    await page.waitForTimeout(400);

    const failures = await measureContrast(page, '#task-management-view');
    expect(failures, 'board contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the status manager meets the contrast minimum', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.locator('#btn-manage-statuses').click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Custom statuses' })).toBeVisible();

    const failures = await measureContrast(page, '[role="dialog"]');
    expect(failures, 'status manager contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the task modal meets the contrast minimum', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.locator('#btn-new-task').click();
    await expect(page.getByRole('dialog').filter({ hasText: 'New Task' })).toBeVisible();

    const failures = await measureContrast(page, '[role="dialog"]');
    expect(failures, 'task modal contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the detail drawer meets the contrast minimum', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);
    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Compile Q3 findings.' })).toBeVisible();

    const failures = await measureContrast(page, '[role="dialog"]');
    expect(failures, 'detail drawer contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the running-timer bar meets the contrast minimum on its dark surface', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();
    await expect(page.getByRole('button', { name: 'Stop timer for this task' }).first())
      .toBeVisible();
    await page.waitForTimeout(400);

    // Dark-surface text needs LIGHTER tokens, the opposite of the light surfaces, so it gets
    // its own check rather than riding along with the List view.
    const failures = await measureContrast(page, '.bg-\\[\\#0b1424\\]');
    expect(failures, 'timer bar contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('dialog headers meet the contrast minimum on their dark surface', async ({ page }) => {
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Prepare pool inspection report' }).first().click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Compile Q3 findings.' })).toBeVisible();
    await page.waitForTimeout(400);

    const failures = await measureContrast(page, '.bg-\\[\\#0b1424\\]');
    expect(failures, 'dialog header contrast failures:\n' + failures.join('\n')).toEqual([]);
  });

  test('the module stays usable when the viewer prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    // Start a timer so the module's continuously-updating surface is on screen.
    await taskItem(page, 'Prepare pool inspection report')
      .getByRole('button', { name: 'Start timer for this task' }).click();
    await expect(page.getByRole('button', { name: 'Stop timer for this task' }).first())
      .toBeVisible();

    await expect(page.locator('#task-management-view')).toBeVisible();
    await expect(taskItems(page)).toHaveCount(3);
  });
});
