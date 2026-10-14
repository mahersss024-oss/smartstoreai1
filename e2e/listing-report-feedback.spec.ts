import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

test('report feedback stays visible, locks the flag and survives reload without duplicate reports', async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  // These fixtures mutate only a locally running test server, never a deployed marketplace.
  test.skip(!['localhost', '127.0.0.1'].includes(new URL(baseURL!).hostname), 'Local fixtures only');
  const suffix = randomUUID();
  const cookie = (id: string, role?: string) => createSessionCookie({
    id, email: `${id}@smartstore.local`, name: 'Feedback fixture', role,
  }).split(';')[0];
  const listing = { id: `e2e-report-${testInfo.project.name}` };
    await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
    const buyerCookie = cookie(`feedback-buyer-${suffix}`);
    await page.context().addCookies([{
      name: 'smartstore_session', value: decodeURIComponent(buyerCookie.split('=').slice(1).join('=')),
      url: baseURL!, httpOnly: true, sameSite: 'Lax',
    }]);
    await page.goto(`/listings/${listing.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect((await (await page.request.get('/api/auth/session')).json()).authenticated).toBe(true);
    const sellerPanel = page.locator('.listing-seller-summary');
    const geometry = await sellerPanel.evaluate(element => {
      const root = element.closest('.marketplace-listings-scroll')!;
      const panel = root.parentElement!;
      const header = panel.querySelector('header')!;
      const classes = [root.className, panel.className, header.className];
      const content = element.parentElement!;
      const measure = () => [header, ...header.querySelectorAll('*'), ...content.querySelectorAll('*')]
        .map(node => node.getBoundingClientRect().toJSON());
      const before = measure();
      panel.classList.add('px-3', 'sm:px-5');
      header.classList.remove('mx-3', 'sm:mx-5');
      root.classList.remove('px-4', 'sm:px-7');
      root.classList.add('px-1', 'sm:px-2');
      const after = measure();
      [root.className, panel.className, header.className] = classes;
      return JSON.stringify(before) === JSON.stringify(after);
    });
    expect(geometry).toBe(true);
    for (const dark of [false, true]) {
      await page.locator('html').evaluate((element, value) => element.classList.toggle('dark', value), dark);
      expect(await sellerPanel.evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe(dark ? 'rgb(30, 41, 59)' : 'rgb(226, 232, 240)');
      await page.screenshot({ path: testInfo.outputPath(`seller-${dark ? 'dark' : 'light'}.png`) });
    }
    const endpoint = `/api/marketplace/listings/${listing.id}/reports`;
    let attempts = 0;
    await page.route(`**${endpoint}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: 'fixture_failure' } });
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.continue();
    });
    const flag = page.getByRole('button', { name: 'إبلاغ', exact: true });
    await expect(flag).toBeEnabled();
    await flag.click();
    const failure = page.locator('body > [role="alert"]');
    await expect(failure).toContainText('تعذر إرسال البلاغ');
    await expect(flag).toBeEnabled();
    await expect(flag).toHaveAttribute('aria-pressed', 'false');
    await failure.getByRole('button', { name: 'إغلاق رسالة الإجراء' }).click();
    const responsePromise = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === 'POST');
    await flag.evaluate(element => {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    });
    const result = await (await responsePromise).json();
    expect(result.status, JSON.stringify(result)).toBe('reported');
    await expect(flag).toBeDisabled();
    await expect(flag).toHaveAttribute('aria-pressed', 'true');
    await expect(flag.locator('svg')).toHaveClass(/fill-current/);
    expect(attempts).toBe(2);
    const success = page.locator('body > [role="status"]');
    await expect(success).toContainText('تم إرسال البلاغ للمراجعة.');
    await expect.poll(() => success.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport!;
      return Math.abs(rect.y + rect.height / 2 - viewport.offsetTop - viewport.height / 2);
    })).toBeLessThan(2);
    const list = page.locator('.marketplace-listings-scroll');
    expect(await list.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('centered-report-result.png') });
    await page.reload();
    await expect(flag).toHaveAttribute('aria-pressed', 'true');
    await expect(flag).toBeDisabled();
    const repeated = await Promise.all(Array.from({ length: 3 }, (_, index) => request.post(endpoint, {
      headers: { Cookie: buyerCookie, 'Idempotency-Key': `${suffix}-${index}` }, data: { reason: 'fraud' },
    }).then(response => response.json())));
    expect(repeated.every(payload => payload.report.id === result.report.id)).toBe(true);
});
