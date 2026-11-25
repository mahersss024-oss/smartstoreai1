import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/analytics/visit', route => route.fulfill({ status: 204 }));
});

test('customer resource URLs hand off the same resource without old web customer actions', async ({ page, isMobile }, info) => {
  const listingId = `e2e-report-${info.project.name}`;
  for (const [path, native] of [
    [`/listings/${listingId}`, `/listings/${listingId}`], ['/sellers/e2e-report-seller', '/sellers/e2e-report-seller'],
    ['/favorites', '/favorites'], ['/conversations', '/messages'],
    ['/conversations/private-conversation?ticket=never-forward', '/conversations/private-conversation'],
    ['/commissions', '/commissions'], ['/notifications', '/notifications'],
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('[data-customer-gateway-target]')).toHaveAttribute('data-customer-gateway-target', native);
    await expect(page.locator('.marketplace-bottom-nav, .open-in-app-banner, [data-admin-record-preview], form, textarea')).toHaveCount(0);
    await expect(page.locator('a[href*="ticket="], a[href*="/api/auth/mobile/open"]')).toHaveCount(0);
    if (isMobile) {
      await expect(page.locator('[data-app-launch]')).toHaveAttribute('href', `smartstore://${native.slice(1)}`);
    } else {
      const webPath = path.split('?')[0];
      await expect(page.getByRole('link', { name: 'رابط سوق حمد للجوال' })).toHaveAttribute('href', `https://souqhamad.com${webPath}`);
    }
  }
  await page.goto(`/listings/${listingId}`);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Desk | سوق حمد');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://souqhamad.com/listings/${listingId}`);
});

test('administrative previews remain browser-accessible and private drafts stay out of public metadata', async ({ page, baseURL }, info) => {
  const id = `e2e-private-draft-${info.project.name}`;
  await page.goto(`/listings/${id}`);
  await expect(page.locator('[data-admin-record-preview]')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('Private draft fixture');
  const [name, value] = createSessionCookie({ id: 'preview-admin', email: 'preview-admin@example.test', role: 'admin' }).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.goto(`/listings/${id}`);
  await expect(page.locator('[data-admin-record-preview]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private draft fixture' })).toBeVisible();
  const wordmark = page.getByRole('img', { name: 'إعلان بدون صور — سوق حمد' });
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(wordmark.locator('span')).toHaveCSS('mask-image', /hamad-market-wordmark\.webp/);
  await expect(wordmark.locator('span')).toHaveCSS('opacity', '0.2');
  await expect(page.locator('meta[property="og:title"]')).not.toHaveAttribute('content', /Private draft/);
  await expect(page.getByRole('link', { name: 'العودة إلى الإدارة' })).toHaveAttribute('href', '/admin/listings');
  await page.context().clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-admin-record-preview]')).toHaveCount(0);
  await expect(page.locator('[data-admin-record-denied]')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('Private draft fixture');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.goto('/sellers/e2e-report-seller');
  await expect(page.locator('[data-admin-record-preview]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'العودة إلى الإدارة' })).toHaveAttribute('href', '/admin/users');
  await page.context().clearCookies();
  await page.reload();
  await expect(page.locator('[data-customer-gateway-target]')).toHaveAttribute('data-customer-gateway-target', '/sellers/e2e-report-seller');
  await expect(page.locator('[data-admin-record-preview]')).toHaveCount(0);
});

test('administrative image gallery pans a zoomed image with the keyboard and preserves image navigation', async ({ page, baseURL }, info) => {
  const [name, value] = createSessionCookie({ id: 'preview-admin', email: 'preview-admin@example.test', role: 'admin' }).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.goto(`/listings/e2e-admin-gallery-${info.project.name}`);
  await page.getByRole('button', { name: /فتح الصورة 1 بالحجم الكامل/ }).press('Enter');
  const lightbox = page.getByRole('dialog', { name: 'عارض صور الإعلان' });
  const image = lightbox.getByRole('img', { name: 'إعلان اختبار المعرض', exact: true });
  const viewport = lightbox.getByRole('region', { name: 'تحريك الصورة المكبّرة بالأسهم' });
  await expect(image).toHaveAttribute('src', /gallery=1/);

  await lightbox.getByRole('button', { name: 'تكبير الصورة', exact: true }).press('Enter');
  await expect(viewport).toHaveAttribute('tabindex', '0');
  await viewport.press('ArrowRight');
  await expect(viewport).toBeFocused();
  await viewport.press('ArrowDown');
  await expect.poll(() => image.evaluate(element => {
    const pan = new DOMMatrix(getComputedStyle(element).transform);
    return pan.m41 < 0 && pan.m42 < 0;
  })).toBe(true);
  await expect(image).toHaveAttribute('src', /gallery=1/);

  await lightbox.getByRole('button', { name: 'تصغير الصورة', exact: true }).press('Enter');
  await expect(viewport).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');
  await expect(image).toHaveAttribute('src', /gallery=2/);
});

test('public root links to Google Play without market navigation or redirects', async ({ page, isMobile }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await expect(page.getByRole('heading', { name: 'سوق حمد على جوالك' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('[data-store-platform="android"]')).toHaveAttribute('data-store-state', 'configured');
  await expect(page.locator('[data-store-platform="ios"]')).toHaveAttribute('data-store-state', 'unpublished');
  const androidLink = page.getByRole('link', { name: 'الانتقال إلى Google Play', exact: true });
  await expect(androidLink).toBeVisible();
  await expect(androidLink).toHaveAttribute('href', 'https://play.google.com/store/apps/details?id=com.souqhamad.app');
  await expect(page.getByRole('button', { name: 'iPhone — قريبًا' })).toBeDisabled();
  await expect(page.locator('.marketplace-bottom-nav, .open-in-app-banner, .site-message-banner')).toHaveCount(0);
  await expect(page.locator('a[href*="apps.apple.com"], a[href*="testflight.apple.com"]')).toHaveCount(0);
  await expect(page).toHaveURL(url => url.pathname === '/');
  expect((await page.locator('main.app-download-gateway').boundingBox())?.y).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (isMobile) {
    await expect(page.getByRole('link', { name: 'فتح التطبيق', exact: true })).toHaveAttribute('href', 'smartstore://');
    await expect(page.locator('[data-app-download-qr]')).toHaveCount(0);
  } else {
    await expect(page.getByRole('link', { name: 'فتح التطبيق', exact: true })).toHaveCount(0);
    const qr = page.getByRole('link', { name: 'رابط سوق حمد للجوال' });
    await expect(qr).toHaveAttribute('href', 'https://souqhamad.com/');
    await expect(qr.locator('svg')).toBeVisible();
    await expect(qr.locator('svg title')).toHaveText('افتح سوق حمد على جوالك');
  }
  await page.screenshot({ path: testInfo.outputPath(`app-gateway-${isMobile ? 'mobile' : 'desktop'}.png`), fullPage: true });
  expect(errors).toEqual([]);
});

for (const [platform, userAgent] of [
  ['android', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36'],
  ['ios', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'],
] as const) {
  test(`${platform} offers a manual app launch and stays on the gateway if it cannot open`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ userAgent, viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
      await page.route('**/api/analytics/visit', route => route.fulfill({ status: 204 }));
      const launches: string[] = [];
      await page.exposeFunction('recordGatewayLaunch', (url: string) => launches.push(url));
      await page.addInitScript(() => {
        // Capture the OS handoff so browser tests never launch an installed app.
        document.addEventListener('click', event => {
          const link = (event.target as Element | null)?.closest('a');
          if (link?.href === 'smartstore://') {
            event.preventDefault();
            void (window as unknown as { recordGatewayLaunch: (url: string) => Promise<void> }).recordGatewayLaunch(link.href);
          }
        }, { capture: true });
      });
      let authenticationLaunches = 0;
      await page.route('**/api/auth/mobile/open**', route => {
        authenticationLaunches++;
        return route.fulfill({ status: 500 });
      });
      await page.goto(new URL('/', baseURL).href);
      await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
      await expect(page.locator(`[data-store-platform="${platform}"]`)).toContainText('مناسب لجهازك');
      await page.getByRole('link', { name: 'فتح التطبيق', exact: true }).click();
      await expect.poll(() => launches).toEqual(['smartstore://']);
      await expect(page.getByText('إذا لم يفتح التطبيق، تأكد أنه مثبت على جوالك.', { exact: false })).toBeVisible();
      await expect(page).toHaveURL(url => url.pathname === '/');
      expect(authenticationLaunches).toBe(0);
      await expect(page.locator('[data-app-download-qr]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}
