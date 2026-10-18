import { expect, test } from '@playwright/test';
import { customer, pagination, prepare } from './helpers/admin-presentation-fixture';

for (const width of [320, 390, 820, 1440]) {
  test(`user statistics preserve filter position while loading at ${width}`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await page.route('**/api/realtime/stream**', route => route.fulfill({
      contentType: 'text/event-stream', body: 'retry: 60000\nevent: heartbeat\ndata: {}\n\n',
    }));
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/admin/users?**', async route => {
      await pending;
      await route.fulfill({ json: { users: [customer], pagination } });
    });
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.goto('/admin/users');
      const statistics = page.locator('.admin-statistics');
      await expect(page.locator('.admin-topbar button:visible').first()).toBeVisible();
      await expect(statistics).toHaveAttribute('aria-hidden', 'true');
      await expect(statistics).toBeHidden();
      await expect(statistics.locator('.text-xl')).toHaveText(['', '', '']);
      const before = await page.locator('.admin-filterbar').evaluate(element => element.getBoundingClientRect().top);
      release();
      await expect(statistics).toHaveAttribute('aria-hidden', 'false');
      await expect(statistics).toBeVisible();
      await expect(statistics.locator('.text-xl')).toHaveText(['\u0661', '\u0661', '\u0661']);
      await expect(page.locator('.admin-result-row')).toHaveCount(1);
      const after = await page.locator('.admin-filterbar').evaluate(element => element.getBoundingClientRect().top);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
    } finally {
      release();
    }
  });
}
