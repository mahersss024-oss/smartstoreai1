import { expect, test } from '@playwright/test';

import { publicLegalLinks } from '../lib/platform/legal-routes';
import { platformSupportEmail } from '../lib/platform/policies';

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/analytics/visit', route => route.fulfill({ status: 204 }));
});

for (const theme of ['light', 'dark'] as const) {
  test(`public policies are readable and navigable in ${theme} mode`, async ({ page, isMobile }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    for (const policy of publicLegalLinks) {
      const response = await page.goto(policy.href);
      expect(response?.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
      await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByRole('heading', { level: 1, name: policy.label, exact: true })).toBeVisible();
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://souqhamad.com${policy.href}`);

      const nav = page.getByRole('navigation', { name: 'سياسات سوق حمد' });
      await expect(nav.getByRole('link')).toHaveCount(publicLegalLinks.length);
      await expect(nav.getByRole('link', { name: policy.label, exact: true })).toHaveAttribute('aria-current', 'page');
      for (const destination of publicLegalLinks) {
        await expect(nav.getByRole('link', { name: destination.label, exact: true })).toHaveAttribute('href', destination.href);
      }

      await expect(page.getByRole('checkbox')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /حذف الحساب|تأكيد الحذف/ })).toHaveCount(0);
      await expect(page.locator('.marketplace-bottom-nav, .open-in-app-banner')).toHaveCount(0);
      await expect(page.locator('body')).toHaveCSS('background-image', 'none');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      // Check the foreground against the actual reading surface in both themes.
      const contrast = await page.getByRole('article').evaluate(article => {
        const text = article.querySelector('p, li')!;
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
            const scaled = value / 255;
            return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const foreground = luminance(getComputedStyle(text).color);
        const background = luminance(getComputedStyle(article).backgroundColor);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);

      const footer = page.getByRole('region', { name: 'التواصل والدعم' });
      await footer.scrollIntoViewIfNeeded();
      await expect(footer.getByRole('link', { name: platformSupportEmail })).toBeInViewport();
      await expect(footer.getByRole('link', { name: platformSupportEmail })).toHaveAttribute('href', `mailto:${platformSupportEmail}`);

      if (policy.href === '/privacy' || policy.href === '/delete-account') {
        await page.screenshot({ path: testInfo.outputPath(`${policy.href.slice(1)}-${isMobile ? 'mobile' : 'desktop'}-${theme}.png`), fullPage: true });
      }
    }

    // Use the rendered navigation to verify client navigation and its active state.
    await page.getByRole('navigation', { name: 'سياسات سوق حمد' }).getByRole('link', { name: 'شروط الاستخدام', exact: true }).click();
    await expect(page).toHaveURL(url => url.pathname === '/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'شروط الاستخدام' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'شروط الاستخدام', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(errors).toEqual([]);
  });
}

test('public deletion guide offers a manual app handoff and an external support request', async ({ page }) => {
  const launches: string[] = [];
  const deletions: string[] = [];
  let authenticationLaunches = 0;
  page.on('request', request => {
    if (request.method() === 'DELETE') deletions.push(request.url());
  });
  await page.route('**/api/auth/mobile/open**', route => {
    authenticationLaunches++;
    return route.fulfill({ status: 500 });
  });
  await page.exposeFunction('recordLegalAppLaunch', (url: string) => launches.push(url));
  await page.addInitScript(() => {
    document.addEventListener('click', event => {
      const link = (event.target as Element | null)?.closest('a');
      if (link?.href === 'smartstore://') {
        event.preventDefault();
        void (window as unknown as { recordLegalAppLaunch: (url: string) => Promise<void> }).recordLegalAppLaunch(link.href);
      }
    }, { capture: true });
  });

  await page.goto('/delete-account');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  const guide = page.getByRole('region', { name: 'احذف حسابك من التطبيق' });
  const steps = guide.getByRole('list', { name: 'خطوات حذف الحساب داخل التطبيق' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  for (const [index, label] of ['حسابي', 'تعديل حسابي', 'حذف الحساب'].entries()) {
    await expect(steps.nth(index)).toContainText(label);
  }
  await expect(guide.getByText('راجع تفاصيل الحذف، ثم أكّد اختيارك داخل التطبيق لإتمام حذف الحساب.')).toBeVisible();
  const appLink = guide.getByRole('link', { name: 'فتح تطبيق سوق حمد', exact: true });
  await expect(appLink).toHaveAttribute('href', 'smartstore://');
  expect(launches).toEqual([]);
  await appLink.click();
  await expect.poll(() => launches).toEqual(['smartstore://']);
  await expect(guide.getByText('إذا لم يفتح التطبيق، تأكد أنه مثبت على جوالك، أو استخدم البريد أدناه لطلب المساعدة.', { exact: false })).toBeVisible();
  await expect(page).toHaveURL(url => url.pathname === '/delete-account');

  const support = guide.getByRole('link', { name: platformSupportEmail });
  await expect(support).toHaveAttribute('href', `mailto:${platformSupportEmail}?subject=${encodeURIComponent('طلب حذف حساب')}`);
  await expect(guide.getByText('يراجع الدعم الطلب ويتحقق من ملكية الحساب قبل تنفيذ الحذف.')).toBeVisible();
  await expect(guide.getByRole('link', { name: 'خيارات تحميل التطبيق' })).toHaveAttribute('href', '/');
  expect(deletions).toEqual([]);
  expect(authenticationLaunches).toBe(0);
});

test('legal reading and deletion steps fit a narrow phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/delete-account');
  await expect(page.getByRole('heading', { level: 1, name: 'حذف الحساب' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'فتح تطبيق سوق حمد', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('region', { name: 'التواصل والدعم' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('region', { name: 'التواصل والدعم' })).toBeInViewport();
});
