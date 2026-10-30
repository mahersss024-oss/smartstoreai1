import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath } from '@/scripts/testing/route-contracts';

const pages = buildInventory().items.filter(item =>
  item.kind === 'page' && (item.path === '/admin' || item.path?.startsWith('/admin/')));

test.beforeEach(async ({ baseURL, page }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

for (const entry of pages) {
  for (const role of ['guest', 'customer'] as const) {
    test(`page renders without client crashes: ${role} ${entry.path}`, async ({ page, baseURL }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      if (role === 'customer') {
        const [name, value] = createSessionCookie({ id: 'page-route-customer', email: 'page-customer@example.test', role: 'user' }).split(';')[0].split('=');
        await page.context().addCookies([{ name, value, url: baseURL! }]);
      }
      const path = concretePath(entry.path!);
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(url => url.pathname === path);
      await expect(page.locator('.admin-content')).toHaveCount(0);
      {
        await expect(page.locator('[data-admin-entry]')).toBeVisible();
        if (role === 'guest') {
          await expect(page.getByRole('link', { name: 'تسجيل الدخول باستخدام Google' })).toHaveAttribute('href', `/api/auth/google/start?return_to=${encodeURIComponent(path)}`);
        } else {
          await expect(page.getByText('هذا الحساب لا يملك صلاحية الإدارة.')).toBeVisible();
        }
      }
      await expect(page.locator('body')).not.toContainText('Application error:');
      expect(errors).toEqual([]);
      await info.attach('access-result', { body: JSON.stringify({ path, role, status: response?.status(), finalUrl: page.url() }), contentType: 'application/json' });
    });
  }
}
