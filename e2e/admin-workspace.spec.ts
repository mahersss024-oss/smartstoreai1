import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

async function prepare(
  page: import('@playwright/test').Page,
  baseURL: string,
  role = 'admin',
) {
  const user = {
    id: 'workspace-admin',
    email: 'workspace-admin@example.test',
    role,
  };
  const [name, value] = createSessionCookie(user).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL }]);
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: true, user } }),
  );
  await page.route('**/api/admin/overview**', (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get('view') === 'workspace'
          ? {
              month: new Date().toISOString().slice(0, 7),
              listings: [{ status: 'pending', count: 3 }],
              commissions: [{ status: 'due', count: 2, amount: '45' }],
              evidence: [{ status: 'incomplete', count: 1 }],
              visits: [
                {
                  day: new Date().toISOString().slice(0, 10),
                  visits: 12,
                  uniqueVisitors: 8,
                },
              ],
              events: [
                {
                  id: 'review',
                  title: 'مراجعة مدة الاحتفاظ بالأدلة',
                  date: new Date().toISOString().slice(0, 10),
                  href: '/admin/moderation',
                },
              ],
              hasMoreEvents: false,
            }
          : {
              totalUsers: 25,
              activeUsers: 7,
              publishedListings: 15,
              openReports: 4,
            },
    }),
  );
}

test('admin workspace renders real payloads, charts and read-only calendar on all layouts', async ({
  page,
  baseURL,
}, testInfo) => {
  await prepare(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [360, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin');
    await expect(
      page.getByRole('region', { name: 'تنبيهات إدارية' }),
    ).toBeVisible();
    await expect(page.locator('.apexcharts-canvas')).toBeVisible();
    await expect(
      page.getByText('أدلة لم يكتمل حفظها', { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-${width}.png`),
      fullPage: true,
    });
    const content = page.locator('.admin-content > main');
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole('heading', { name: 'العمولات الحالية', exact: true }),
    ).toBeInViewport();
  }
  await page.goto('/admin?view=calendar');
  await expect(page.locator('.admin-calendar')).toBeVisible();
  const saturday = await page.locator('.admin-calendar').getByText('السبت', { exact: true }).filter({ visible: true }).first().boundingBox();
  const sunday = await page.locator('.admin-calendar').getByText('الأحد', { exact: true }).filter({ visible: true }).first().boundingBox();
  expect(saturday).not.toBeNull();
  expect(sunday).not.toBeNull();
  expect(Math.abs(saturday!.y - sunday!.y)).toBeLessThan(5);
  expect(Math.abs(saturday!.x - sunday!.x)).toBeGreaterThan(30);
  await page.screenshot({
    path: testInfo.outputPath('workspace-calendar.png'),
    fullPage: true,
  });
  await expect(
    page
      .getByRole('link', { name: 'مراجعة مدة الاحتفاظ بالأدلة', exact: true })
      .last(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('calendar keeps seven aligned columns on narrow screens', async ({ page, baseURL }, testInfo) => {
  await prepare(page, baseURL!);
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin?view=calendar');
    await expect(page.locator('.admin-calendar')).toBeVisible();
    const saturday = await page.locator('.admin-calendar').getByText('السبت', { exact: true }).filter({ visible: true }).first().boundingBox();
    const sunday = await page.locator('.admin-calendar').getByText('الأحد', { exact: true }).filter({ visible: true }).first().boundingBox();
    expect(saturday).not.toBeNull();
    expect(sunday).not.toBeNull();
    expect(Math.abs(saturday!.y - sunday!.y)).toBeLessThan(5);
    expect(Math.abs(saturday!.x - sunday!.x)).toBeGreaterThan(20);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.admin-calendar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`calendar-${width}.png`), fullPage: true });
  }
});

test('desktop sidebar collapse and shared marketplace theme remain functional', async ({
  page,
  baseURL,
}, testInfo) => {
  await prepare(page, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await page
    .getByRole('button', { name: 'طي القائمة الجانبية', exact: true })
    .click();
  await expect(page.locator('.admin-sidebar')).toHaveCSS('width', '80px');
  await page
    .getByRole('button', { name: 'توسيع القائمة الجانبية', exact: true })
    .click();
  await expect(page.locator('.admin-sidebar')).toHaveCSS('width', '272px');
  await page.getByRole('button', { name: 'الوضع الداكن', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({
    path: testInfo.outputPath('workspace-dark.png'),
    fullPage: true,
  });
});

test('mobile drawer closes with escape, focuses trigger and navigates', async ({
  page,
  baseURL,
}) => {
  await prepare(page, baseURL!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  const trigger = page.getByRole('button', {
    name: 'فتح قائمة الإدارة',
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole('dialog', { name: 'قائمة الإدارة' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await page
    .locator('#admin-navigation')
    .getByRole('link', { name: 'التقويم الإداري', exact: true })
    .click();
  await expect(page.locator('.admin-calendar')).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('moderator navigation retains listing and report access without financial metrics', async ({
  page,
  baseURL,
}) => {
  await prepare(page, baseURL!, 'moderator');
  await page.setViewportSize({ width: 1440, height: 900 });
  let metricRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/admin/overview')) metricRequests++;
  });
  await page.goto('/admin');
  await expect(
    page
      .locator('#admin-navigation')
      .getByRole('link', { name: 'البلاغات والأدلة', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator('#admin-navigation')
      .getByRole('link', { name: 'العمولات', exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('#admin-navigation')
      .getByRole('link', { name: 'العملاء', exact: true }),
  ).toHaveCount(0);
  expect(metricRequests).toBe(0);
});

test('workspace failure is explicit and retry uses the existing read endpoint', async ({
  page,
  baseURL,
}) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/overview?view=workspace**', (route) =>
    route.fulfill({ status: 503, json: { error: 'unavailable' } }),
  );
  await page.goto('/admin');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'تعذر تحميل المؤشرات والمواعيد' }),
  ).toBeVisible();
  await page.unroute('**/api/admin/overview?view=workspace**');
  await page
    .getByRole('button', { name: 'إعادة المحاولة', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'تنبيهات إدارية' }),
  ).toBeVisible();
});
