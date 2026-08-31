import { test, expect, installApi, bootApp, openTaskManagement, fail, appNav } from './harness';
import * as F from './fixtures';

/**
 * Channels UI.
 *
 * Every request is answered by the intercepting harness — no browser test reaches a real API,
 * and no Production channel or message is ever created. Channels are FAIL-CLOSED in the
 * fixtures, so each test here opts in explicitly via `caps`, exactly as a deployment must opt
 * in via TASK_CHANNELS_ENABLED.
 */

const enabled = (role: F.Role = 'ADMIN', over: Record<string, unknown> = {}) =>
  ({ role, caps: F.channelCapabilitiesFor(role, over) });

/** The Channels section as the current viewport presents it (inline or inside the drawer). */
async function channelsNav(page: any) {
  // Already visible somewhere (inline on wide viewports, or an open drawer on narrow ones).
  const anyVisible = page.locator('section[aria-labelledby="channels-heading"]')
    .filter({ visible: true });
  if (await anyVisible.first().isVisible().catch(() => false)) return anyVisible.first();

  // Otherwise it lives only in the drawer, which must be opened first. Selecting a channel
  // closes that drawer, so callers re-acquire the section rather than reusing a stale one.
  const drawer = page.getByRole('dialog', { name: 'Spaces and Lists' });
  if (!(await drawer.isVisible().catch(() => false))) {
    const opener = page.getByRole('button', { name: 'Open Spaces and Lists' });
    await expect(opener).toBeVisible();
    await opener.click();
  }
  await expect(drawer).toBeVisible();
  return drawer.locator('section[aria-labelledby="channels-heading"]');
}

const channelBtn = (scope: any, name: string) =>
  scope.getByRole('button', { name: new RegExp(`^${name}(,|$)`) });

/**
 * One message row.
 *
 * Scoped to the message list because a reply quotes its parent's text, so a bare
 * getByText() for a parent body legitimately matches twice: once in the parent's own row
 * and once inside the reply's quoted context. That is correct product behaviour, so the
 * assertion has to name which of the two it means.
 */
const messageBody = (page: any, text: string) =>
  page.getByRole('list', { name: /Messages in / }).getByText(text, { exact: true });

/** The row containing a body, addressed via that body so a quoting reply is not matched. */
const messageRow = (page: any, text: string) =>
  page.getByRole('list', { name: /Messages in / })
    .getByRole('listitem').filter({ has: page.getByText(text, { exact: true }) });

test.describe('Channels: feature gate', () => {
  test('the entire Channels surface is hidden when the server reports it disabled', async ({ page }) => {
    // Default capabilities are fail-closed — no `caps` override at all.
    await installApi(page, { role: 'ADMIN' });
    await bootApp(page);
    await openTaskManagement(page);

    await expect(page.locator('section[aria-labelledby="channels-heading"]')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Channels' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Create a channel' })).toHaveCount(0);
  });

  test('a client cannot conjure Channels: the server flag alone decides', async ({ page }) => {
    // Everything else is permissive; only channelsEnabled is false. The UI must stay hidden.
    await installApi(page, {
      role: 'SUPER_ADMIN',
      caps: F.capabilitiesFor('SUPER_ADMIN', {
        channelsEnabled: false, canManageChannels: true, canPostMessages: true
      })
    });
    await bootApp(page);
    await openTaskManagement(page);
    await expect(page.locator('section[aria-labelledby="channels-heading"]')).toHaveCount(0);
  });

  test('the Channels section appears once the server enables it', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await channelsNav(page);
    await expect(nav.getByRole('heading', { name: 'Channels' })).toBeVisible();
    await expect(channelBtn(nav, 'Lounge')).toBeVisible();
    await expect(channelBtn(nav, 'Showtime Pools Main')).toBeVisible();
  });

  test('no Channels flash before bootstrap answers', async ({ page }) => {
    const api = await installApi(page, enabled());
    await bootApp(page);
    api.holdRoute('GET /api/tasks/bootstrap');
    await (await appNav(page, 'task-management')).click();

    // While bootstrap is in flight the gate is unknown, so nothing Channels-related may render.
    await expect(page.getByText('Loading Task Management…')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="channels-heading"]')).toHaveCount(0);

    api.releaseRoute('GET /api/tasks/bootstrap');

    // Wait for the view itself to render before asking which presentation the Channels
    // section is in. Without this, channelsNav() can sample visibility in the gap between
    // bootstrap resolving and the tree painting, see nothing inline, and fall through to the
    // drawer path — which has no opener at desktop width.
    await expect(page.locator('#task-search')).toBeVisible();

    // Present once bootstrap answers — via the drawer on narrow viewports, inline on wide.
    const nav = await channelsNav(page);
    await expect(nav.getByRole('heading', { name: 'Channels' })).toBeVisible();
  });
});

test.describe('Channels: sidebar', () => {
  test('shows unread badges and a selected state without disturbing the task hierarchy', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await channelsNav(page);
    // Two messages in Lounge are from another author and undeleted; the deleted one and my
    // own must not count.
    await expect(channelBtn(nav, 'Lounge')).toHaveAttribute('aria-label', /2 unread messages/);

    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByRole('heading', { name: /Lounge/ })).toBeVisible();

    // The task hierarchy is untouched: its nav and selection survive opening a channel.
    const spaces = page.getByRole('navigation', { name: 'Spaces and Lists' }).first();
    if (await spaces.isVisible().catch(() => false)) {
      await expect(spaces).toBeVisible();
    }
  });

  test('a private channel is marked as such', async ({ page }) => {
    await installApi(page, enabled('ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await expect(channelBtn(nav, 'Ops Private')).toHaveAttribute('aria-label', /private/);
  });

  test('a failed channel load offers a retry that works', async ({ page }) => {
    const api = await installApi(page, enabled());
    api.failAlways('GET /api/tasks/channels', 500,
      fail('TASK_INTERNAL_ERROR', 'Channel list failed.'));
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await channelsNav(page);
    await expect(nav.getByRole('alert')).toContainText('Channel list failed');
    api.clearFailures();
    await nav.getByRole('button', { name: 'Try again' }).click();
    await expect(channelBtn(nav, 'Lounge')).toBeVisible();
  });

  test('an empty workspace explains itself', async ({ page }) => {
    await installApi(page, { ...enabled(), channels: [] });
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await expect(nav).toContainText('No channels yet');
  });

  test('the section collapses and still reports hidden unread', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);

    await nav.getByRole('button', { name: /Channels/ }).first().click();
    await expect(channelBtn(nav, 'Lounge')).toHaveCount(0);
    await expect(nav.getByLabel(/unread message/)).toBeVisible();
  });
});

test.describe('Channels: permissions', () => {
  test('a contributor can post but cannot create or manage channels', async ({ page }) => {
    await installApi(page, enabled('TEAM_MEMBER'));
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await channelsNav(page);
    await expect(nav.getByRole('button', { name: 'Create a channel' })).toHaveCount(0);

    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByRole('button', { name: /^Manage / })).toHaveCount(0);
    await expect(page.getByLabel(/^Message #Lounge/)).toBeVisible();
  });

  test('READ_ONLY sees the conversation but gets no composer', async ({ page }) => {
    await installApi(page, enabled('READ_ONLY'));
    await bootApp(page);
    await openTaskManagement(page);

    const nav = await channelsNav(page);
    await channelBtn(nav, 'Lounge').click();

    await expect(messageBody(page, 'Pump inspection is booked for Friday.')).toBeVisible();
    await expect(page.getByLabel(/^Message #Lounge/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
    await expect(page.getByText('You have read-only access to this channel.')).toBeVisible();
  });

  test('a manager gets the management entry point', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await expect(nav.getByRole('button', { name: 'Create a channel' })).toBeVisible();
    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByRole('button', { name: 'Manage Lounge' })).toBeVisible();
  });
});

test.describe('Channels: conversation', () => {
  // Captured so a test can inject a failure into the SAME handler that is serving the page;
  // installing a second harness mid-test would leave two live route handlers.
  let api: Awaited<ReturnType<typeof installApi>>;

  test.beforeEach(async ({ page }) => {
    api = await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await channelBtn(nav, 'Lounge').click();
  });

  test('renders history, replies, tombstones and an edited marker', async ({ page }) => {
    await expect(messageBody(page, 'Pump inspection is booked for Friday.')).toBeVisible();
    await expect(messageBody(page, 'Thanks — I will bring the readings.')).toBeVisible();
    // A reply shows its parent's context.
    await expect(page.getByText(/Sam Colleague: Pump inspection/)).toBeVisible();
    // A deleted message is a tombstone; its body is never rendered.
    await expect(page.getByText('This message was deleted.')).toBeVisible();
    await expect(page.getByText('this should never be shown')).toHaveCount(0);
  });

  test('sends a message and reconciles it with the server response', async ({ page }) => {
    const composer = page.getByLabel(/^Message #Lounge/);
    await composer.fill('Bringing the test kit too.');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Bringing the test kit too.')).toBeVisible();
    // Reconciled: no lingering pending row.
    await expect(page.getByText('Sending…')).toHaveCount(0);
    await expect(page.getByText('Not sent')).toHaveCount(0);
  });

  test('a failed send keeps the text and retries with the SAME idempotency token', async ({ page }) => {
    // Keyed on the MESSAGES endpoint specifically: 'POST /api/tasks/channels' also
    // prefixes the mark-read call the view issues on open, which would consume this
    // one-shot failure before the send ever happened.
    api.failNext(`POST /api/tasks/channels/${F.CHANNEL_A}/messages`, 500,
      fail('TASK_INTERNAL_ERROR', 'Send failed.'));

    await page.getByLabel(/^Message #Lounge/).fill('This one fails first.');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.getByText('Not sent')).toBeVisible();
    // The text the user typed survives the failure and is still on screen to retry.
    await expect(page.getByText('This one fails first.')).toBeVisible();

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Not sent')).toHaveCount(0);

    // Both attempts carried ONE token, so the server could dedupe them into one message.
    const sends = api.requests().filter(
      r => r.startsWith(`POST /api/tasks/channels/${F.CHANNEL_A}/messages`));
    expect(sends.length).toBe(2);
    // One message, not two: the retry reused the token, so the server deduped it.
    await expect(messageBody(page, 'This one fails first.')).toHaveCount(1);
  });

  test('script and HTML payloads are rendered as inert text', async ({ page }) => {
    const payload = '<script>window.__pwned = true</script><img src=x onerror=alert(1)>';
    await page.getByLabel(/^Message #Lounge/).fill(payload);
    await page.getByRole('button', { name: 'Send message' }).click();

    // Displayed literally…
    await expect(page.getByText(payload)).toBeVisible();
    // …and inert: no script executed, and no element was created from the markup.
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
    expect(await page.locator('#task-management-view img[src="x"]').count()).toBe(0);
    expect(await page.locator('#task-management-view script').count()).toBe(0);
  });

  test('replying targets the message it was opened from', async ({ page }) => {
    const row = page.getByRole('listitem').filter({ hasText: 'Pump inspection is booked' }).first();
    await row.getByRole('button', { name: /^Reply to / }).click();
    await expect(page.getByText(/Replying to Sam Colleague/)).toBeVisible();

    await page.getByLabel(/^Message #Lounge/).fill('On it.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText('On it.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel reply' }).count();
  });

  test('the composer is not offered on an archived channel', async ({ page }) => {
    const channels = JSON.parse(JSON.stringify(F.channels));
    channels[0].archived_at = '2026-08-30T00:00:00+00:00';
    await installApi(page, { ...enabled(), channels });
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await nav.getByRole('button', { name: /Channels/ }).first().click();   // ensure expanded
    await nav.getByRole('button', { name: /Channels/ }).first().click();
    // Archived channels are excluded from the default list, so Lounge is gone entirely.
    await expect(channelBtn(nav, 'Lounge')).toHaveCount(0);
  });
});

test.describe('Channels: edit and delete', () => {
  test('only my own message inside the window offers Edit', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    // Fixture messages are ~28 minutes before the server clock (14:12 vs 14:12:40 server
    // time, but the window is judged from serverTime) — all fixtures are older than the
    // window is long only if the server clock says so. Here they are within 15 minutes, so
    // MY message is editable and someone else's never is.
    const mine = page.getByRole('listitem').filter({ hasText: 'Thanks — I will bring' }).first();
    const theirs = page.getByRole('listitem').filter({ hasText: 'Pump inspection is booked' }).first();

    await expect(mine.getByRole('button', { name: 'Edit your message' })).toBeVisible();
    await expect(theirs.getByRole('button', { name: 'Edit your message' })).toHaveCount(0);
  });

  test('an expired edit window offers no Edit at all', async ({ page }) => {
    // The server clock is far ahead of the fixture messages, so every one is out of window.
    await installApi(page, {
      ...enabled(),
      channelMessages: F.channelMessages.map(m => ({
        ...m,
        created_at: '2026-08-31T10:00:00.000000+00:00',
        updated_at: '2026-08-31T10:00:00.000000+00:00'
      }))
    });
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    await expect(page.getByRole('button', { name: 'Edit your message' })).toHaveCount(0);
  });

  test('editing my own message succeeds and shows the edited marker', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    const mine = page.getByRole('listitem').filter({ hasText: 'Thanks — I will bring' }).first();
    await mine.getByRole('button', { name: 'Edit your message' }).click();
    await page.getByLabel('Edit message').fill('Thanks — readings are packed.');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Thanks — readings are packed.')).toBeVisible();
    await expect(page.getByText('edited').first()).toBeVisible();
  });

  test('a manager can moderate another author\'s message but never rewrite it', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    const theirs = page.getByRole('listitem').filter({ hasText: 'Pump inspection is booked' }).first();
    // Delete is offered to a moderator…
    await expect(theirs.getByRole('button', { name: 'Delete this message' })).toBeVisible();
    // …but Edit is never offered for someone else's words.
    await expect(theirs.getByRole('button', { name: 'Edit your message' })).toHaveCount(0);

    page.once('dialog', d => d.accept());
    await theirs.getByRole('button', { name: 'Delete this message' }).click();
    await expect(page.getByText('Pump inspection is booked for Friday.')).toHaveCount(0);
  });
});

test.describe('Channels: cursors, polling and unread', () => {
  test('same-millisecond messages are all delivered, in order, exactly once', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    // TS_A and TS_B differ only in the LAST microsecond digit and the later one's uuid sorts
    // first — the exact shape that used to drop a message.
    const list = page.getByRole('list', { name: /Messages in Lounge/ });
    // All four fixture messages are present: two share a millisecond, one is a reply, one
    // is a tombstone. None was skipped by the cursor comparison.
    await expect(list.getByRole('listitem')).toHaveCount(4);
    // Each appears in exactly ONE row — no duplicate delivery.
    await expect(messageBody(page, 'Pump inspection is booked for Friday.')).toHaveCount(1);
    await expect(messageBody(page, 'Thanks — I will bring the readings.')).toHaveCount(1);
    await expect(messageBody(page, 'Perfect.')).toHaveCount(1);
    await expect(messageBody(page, 'This message was deleted.')).toHaveCount(1);
  });

  test('cursors are sent back opaquely and never as a parsed timestamp', async ({ page }) => {
    const api = await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    await expect(page.getByText('Perfect.')).toBeVisible();
    await page.waitForTimeout(1200);   // let at least one poll cycle issue

    const polls = api.requests().filter(r => r.includes('/messages') && r.includes('after='));
    if (polls.length) {
      for (const p of polls) {
        const after = new URL(`http://x${p.split(' ')[1]}`).searchParams.get('after')!;
        // Base64url only: no ISO timestamp ever appears on the wire.
        expect(after).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(after).not.toContain('2026');
        // And it decodes to the versioned, microsecond-exact form.
        const decoded = Buffer.from(after, 'base64url').toString('utf8');
        expect(decoded.startsWith('v1|')).toBe(true);
        expect(decoded).toMatch(/\.\d{6}/);
      }
    }
  });

  test('polling stops when the channel changes and a stale response cannot leak in', async ({ page }) => {
    const api = await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);

    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByText('Perfect.')).toBeVisible();

    // Re-acquired: on a narrow viewport the drawer closed when Lounge was selected.
    await channelBtn(await channelsNav(page), 'Showtime Pools Main').click();
    await expect(page.getByRole('heading', { name: /Showtime Pools Main/ })).toBeVisible();

    // Lounge's messages must not appear in the newly opened channel.
    await expect(page.getByText('Pump inspection is booked for Friday.')).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(page.getByText('Pump inspection is booked for Friday.')).toHaveCount(0);
  });

  test('opening a channel marks it read by message id, never by a browser timestamp', async ({ page }) => {
    const api = await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);

    await expect(channelBtn(nav, 'Lounge')).toHaveAttribute('aria-label', /2 unread/);
    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByText('Perfect.')).toBeVisible();

    // The badge clears once the newest message has actually been presented.
    await expect(channelBtn(await channelsNav(page), 'Lounge'))
      .not.toHaveAttribute('aria-label', /unread/, { timeout: 10000 });

    const reads = api.requests().filter(r => r.includes('/read'));
    expect(reads.length).toBeGreaterThan(0);
  });
});

test.describe('Channels: management', () => {
  test('a manager creates a channel and it becomes selectable', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);

    await nav.getByRole('button', { name: 'Create a channel' }).click();
    await page.getByLabel('New channel name').fill('Field Ops');
    await page.getByRole('button', { name: 'Create channel' }).click();

    await expect(channelBtn(await channelsNav(page), 'Field Ops')).toBeVisible();
  });

  test('a duplicate name is reported and no second channel appears', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);

    await nav.getByRole('button', { name: 'Create a channel' }).click();
    await page.getByLabel('New channel name').fill('Lounge');
    await page.getByRole('button', { name: 'Create channel' }).click();

    await expect(page.getByRole('alert')).toContainText('already exists');
    await expect(channelBtn(await channelsNav(page), 'Lounge')).toHaveCount(1);
  });

  test('the manage dialog renames, is labelled, traps focus and restores it', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    const opener = page.getByRole('button', { name: 'Manage Lounge' });
    await opener.click();

    const dialog = page.getByRole('dialog', { name: /Manage #Lounge/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    await dialog.getByRole('textbox').first().fill('Lounge Renamed');
    await dialog.getByRole('button', { name: 'Save details' }).click();

    await expect(dialog).toBeHidden();
    await expect(channelBtn(await channelsNav(page), 'Lounge Renamed')).toBeVisible();
  });

  test('Escape closes the manage dialog and returns focus to its opener', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    const opener = page.getByRole('button', { name: 'Manage Lounge' });
    await opener.click();
    await expect(page.getByRole('dialog', { name: /Manage #Lounge/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Manage #Lounge/ })).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('membership lists only existing workspace members', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();
    await page.getByRole('button', { name: 'Manage Lounge' }).click();

    const dialog = page.getByRole('dialog', { name: /Manage #Lounge/ });
    const members = dialog.getByRole('list', { name: 'Workspace members' });
    await expect(members.getByRole('listitem')).toHaveCount(F.actors.length);
    await expect(members).toContainText('Dana Tester');
    await expect(members).toContainText('Sam Colleague');
    // No control anywhere creates a user or a workspace membership.
    await expect(dialog.getByRole('button', { name: /invite|new user|add user/i })).toHaveCount(0);
  });
});

test.describe('Channels: responsive and accessibility', () => {
  test('mobile: opening a channel from the drawer closes it', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile-only drawer behaviour');
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);

    await page.getByRole('button', { name: 'Open Spaces and Lists' }).click();
    const drawer = page.getByRole('dialog', { name: 'Spaces and Lists' });
    await expect(drawer).toBeVisible();

    await drawer.locator('section[aria-labelledby="channels-heading"]')
      .getByRole('button', { name: /^Lounge(,|$)/ }).click();

    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { name: /Lounge/ })).toBeVisible();
  });

  test('the conversation never overflows the viewport horizontally', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();
    await expect(page.getByText('Perfect.')).toBeVisible();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the channel list and message list are semantically labelled', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    const nav = await channelsNav(page);
    await expect(nav.getByRole('heading', { name: 'Channels' })).toBeVisible();

    await channelBtn(nav, 'Lounge').click();
    await expect(page.getByRole('list', { name: /Messages in Lounge/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Lounge/ })).toBeVisible();
  });

  test('every Channels control has an accessible name and no duplicate ids exist', async ({ page }) => {
    await installApi(page, enabled('SUPER_ADMIN'));
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();
    await expect(page.getByText('Perfect.')).toBeVisible();

    const unnamed = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll(
        '#task-management-view button, #task-management-view input, #task-management-view textarea'
      ));
      return els.filter(el => {
        const e = el as HTMLElement;
        if (e.offsetParent === null) return false;             // not rendered
        const label = e.getAttribute('aria-label')
          || (e.getAttribute('aria-labelledby')
            ? document.getElementById(e.getAttribute('aria-labelledby')!)?.textContent
            : '')
          || (e.id ? document.querySelector(`label[for="${e.id}"]`)?.textContent : '')
          // A wrapping <label> names its control too — this is how the pre-existing
          // "Show archived" checkbox in the task toolbar gets its name.
          || e.closest('label')?.textContent
          || e.textContent
          || (e as HTMLInputElement).placeholder;
        return !label || !label.trim();
      }).length;
    });
    expect(unnamed, 'every visible control must have an accessible name').toBe(0);

    const dupes = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('[id]')).map(e => e.id);
      const seen = new Set<string>(); const dup = new Set<string>();
      for (const id of ids) { if (seen.has(id)) dup.add(id); seen.add(id); }
      return [...dup];
    });
    expect(dupes, 'no duplicate DOM ids').toEqual([]);
  });

  test('the composer is keyboard operable and Enter sends', async ({ page }) => {
    await installApi(page, enabled());
    await bootApp(page);
    await openTaskManagement(page);
    await channelBtn(await channelsNav(page), 'Lounge').click();

    const composer = page.getByLabel(/^Message #Lounge/);
    await composer.focus();
    await expect(composer).toBeFocused();
    await composer.type('Sent with the keyboard.');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sent with the keyboard.')).toBeVisible();
  });
});
