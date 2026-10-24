import { expect, test, type Locator } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

async function expectInViewport(locator: Locator) {
  await expect.poll(() => locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport!;
    return rect.top >= viewport.offsetTop - 1 &&
      rect.left >= viewport.offsetLeft - 1 &&
      rect.bottom <= viewport.offsetTop + viewport.height + 1 &&
      rect.right <= viewport.offsetLeft + viewport.width + 1;
  })).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

test('contact options escape contained scrolling without moving the page or duplicating requests', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  let requests = 0;
  await page.route('**/api/marketplace/conversations', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    requests++;
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({ status: 500, json: { error: 'fixture_failure' } });
  });
  await page.goto(`/listings/e2e-report-${testInfo.project.name}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const trigger = page.getByRole('button', { name: 'تواصل مع المعلن', exact: true });
  await expect(trigger).toBeVisible();
  // Synthetic surrounding content exercises very long pages without mutating listing data.
  await trigger.evaluate(element => {
    const container = element.closest<HTMLElement>('.marketplace-listings-scroll')!;
    container.style.scrollBehavior = 'auto';
    const spacer = document.createElement('div');
    spacer.style.height = '10000px';
    container.append(spacer);
  });
  for (const size of [{ width: 320, height: 568 }, { width: 844, height: 390 },
    { width: 768, height: 1024 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    for (const dark of [false, true]) {
      await page.locator('html').evaluate((element, value) => element.classList.toggle('dark', value), dark);
      for (const fraction of [0, 0.5, 1]) {
        const before = await page.locator('.marketplace-listings-scroll').evaluate((element, ratio) => {
          element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
          return element.scrollTop;
        }, fraction);
        // Open the existing handler without Playwright scrolling the offscreen trigger into view.
        await trigger.evaluate(element => (element as HTMLButtonElement).click());
        const overlay = page.locator('body > .viewport-overlay');
        await expect(overlay).toHaveCount(1);
        await expectInViewport(overlay.locator(':scope > div'));
        expect(await overlay.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await overlay.getByRole('button', { name: 'إغلاق', exact: true }).click();
        await expect(overlay).toHaveCount(0);
        expect(await page.locator('.marketplace-listings-scroll').evaluate(element => element.scrollTop)).toBe(before);
      }
    }
  }
  expect(requests).toBe(0);
  await trigger.evaluate(element => (element as HTMLButtonElement).click());
  await page.getByRole('button', { name: 'مراسلة داخل سوق حمد', exact: true }).click();
  const notice = page.locator('body > [role="alert"]');
  await expect(notice).toContainText('تعذر فتح المحادثة');
  await expectInViewport(notice);
  expect(requests).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('contact-feedback.png') });
});

test('shared confirmation fits a short viewport, preserves Escape, and tracks simulated keyboard bounds', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/delete-account');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await page.getByRole('checkbox').check();
  const open = () => page.getByRole('button', { name: 'حذف الحساب', exact: true })
    .evaluate(element => (element as HTMLButtonElement).click());
  await open();
  const dialog = page.getByRole('dialog');
  await expectInViewport(dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await open();
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width: 844, height: 240, offsetTop: 40, offsetLeft: 0 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  });
  // Remount to attach to the simulated viewport, then resize while already open.
  await page.keyboard.press('Escape');
  await open();
  await expectInViewport(dialog);
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 200, offsetTop: 60 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expectInViewport(dialog);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('conversation message options are portaled and cancel without mutating the message', async ({ page, baseURL }) => {
  const id = 'viewport-buyer';
  const cookie = createSessionCookie({ id, name: 'Viewport buyer', email: 'viewport@smartstore.local' });
  await page.context().addCookies([{
    name: 'smartstore_session', value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')),
    url: baseURL!, httpOnly: true, sameSite: 'Lax',
  }]);
  let mutations = 0;
  await page.route('**/api/marketplace/conversations/viewport-conversation', async route => {
    if (route.request().method() !== 'GET') mutations++;
    await route.fulfill({ json: { conversation: {
      id: 'viewport-conversation', listingId: 'viewport-listing', sellerId: 'viewport-seller', buyerId: id,
      status: 'open', updatedAt: new Date().toISOString(), listing: null,
      messages: [{ id: 'viewport-message', conversationId: 'viewport-conversation', senderId: id,
        body: 'Viewport message', status: 'sent', reasons: [], createdAt: new Date().toISOString() }],
    } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/conversations/viewport-conversation');
  const message = page.getByText('Viewport message', { exact: true });
  await expect(message).toBeVisible();
  await message.dispatchEvent('contextmenu');
  const sheet = page.locator('body > .viewport-overlay');
  await expect(sheet).toHaveCount(1);
  await expectInViewport(sheet.locator(':scope > div'));
  await expect(sheet.getByRole('button', { name: 'حذف لدى الجميع', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'إلغاء', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(message).toBeVisible();
  expect(mutations).toBe(0);
});
