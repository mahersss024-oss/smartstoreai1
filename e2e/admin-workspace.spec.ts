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
                  platform: 'ios',
                  visits: 12,
                  uniqueVisitors: 8,
                },
                { day: new Date().toISOString().slice(0, 10), platform: 'android', visits: 4, uniqueVisitors: 3 },
                { day: new Date().toISOString().slice(0, 10), platform: 'web', visits: 99, uniqueVisitors: 50 },
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
              appUsage: {
                today: 11, last7Days: 17, last30Days: 35,
                platforms: {
                  ios: { today: 8, last7Days: 12, last30Days: 20 },
                  android: { today: 3, last7Days: 5, last30Days: 15 },
                },
              },
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

test('activity defaults to native app usage and keeps website traffic and rolling unique periods separate', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.goto('/admin');
  const panel = page.getByRole('region', { name: 'نشاط التطبيق والموقع', exact: true });
  await expect(panel).toBeVisible();
  const source = panel.getByRole('combobox', { name: 'مصدر النشاط' });
  await expect(source).toHaveValue('app');
  const metrics = panel.getByRole('definition');
  await expect(metrics).toHaveText(['١١', '١٧', '٣٥']);
  await panel.getByText('عرض أرقام النشاط', { exact: true }).click();
  await expect(panel.getByRole('table').locator('tbody td')).toHaveText(['١٦', '١١']);
  await source.selectOption('web');
  await expect(panel.getByRole('table').locator('tbody td')).toHaveText(['٩٩', '٥٠']);
  await source.selectOption('ios');
  await expect(panel.getByRole('table').locator('tbody td')).toHaveText(['١٢', '٨']);
  await expect(metrics).toHaveText(['١١', '١٧', '٣٥']);
});

test('explicit dashboard refresh reloads headline and rolling activity counters without resetting chart choices', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  let increment = 0, overviewRequests = 0, workspaceRequests = 0;
  const number = (value: number) => new Intl.NumberFormat('ar-SA').format(value);
  await page.route('**/api/admin/overview**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('view') === 'workspace') {
      workspaceRequests++;
      const month = params.get('month')!;
      return route.fulfill({ json: {
        month, listings: [{ status: 'pending', count: 3 + increment }], commissions: [], evidence: [], events: [], hasMoreEvents: false,
        visits: [{ day: `${month}-07`, platform: 'ios', visits: 12 + increment, uniqueVisitors: 8 + increment }],
      } });
    }
    overviewRequests++;
    return route.fulfill({ json: {
      totalUsers: 25 + increment, activeUsers: 7 + increment, publishedListings: 15 + increment, openReports: 4 + increment,
      appUsage: { today: 11 + increment, last7Days: 17 + increment, last30Days: 35 + increment,
        platforms: { ios: { today: 8 + increment, last7Days: 12 + increment, last30Days: 20 + increment },
          android: { today: 3, last7Days: 5, last30Days: 15 } } },
    } });
  });
  await page.goto('/admin');
  const headline = page.getByRole('region', { name: 'إحصائيات الإدارة', exact: true });
  await expect(headline.getByRole('link', { name: /إجمالي المستخدمين/ })).toContainText(number(25));
  const activity = page.getByRole('region', { name: 'نشاط التطبيق والموقع', exact: true });
  const source = activity.getByRole('combobox', { name: 'مصدر النشاط' });
  await source.selectOption('ios');
  await page.locator('#admin-month').fill('2026-06');
  await expect.poll(() => workspaceRequests).toBe(2);
  await expect(page.getByRole('button', { name: 'تحديث المؤشرات والمواعيد', exact: true })).toBeEnabled();
  await expect(source).toHaveValue('ios');
  await activity.getByText('عرض أرقام النشاط', { exact: true }).click();
  await expect(activity.getByRole('table').locator('tbody td')).toHaveText([number(12), number(8)]);
  increment = 10;
  await page.getByRole('button', { name: 'تحديث المؤشرات والمواعيد', exact: true }).click();
  for (const [label, value] of [['إجمالي المستخدمين', 35], ['حسابات نشطة خلال 14 يوماً', 17], ['الإعلانات المنشورة', 25], ['البلاغات المفتوحة', 14]] as const) {
    await expect(headline.getByRole('link', { name: new RegExp(label) })).toContainText(number(value));
  }
  await expect(activity.getByRole('definition')).toHaveText([21, 27, 45].map(number));
  await expect(activity.getByRole('table').locator('tbody td')).toHaveText([number(22), number(18)]);
  await expect(source).toHaveValue('ios');
  await expect(page.locator('#admin-month')).toHaveValue('2026-06');
  expect(overviewRequests).toBe(2);
  expect(workspaceRequests).toBe(3);
});

test('headline overview failures offer an independent retry on the existing endpoint', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  let fail = true;
  await page.route('**/api/admin/overview', route => fail
    ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.fallback());
  await page.goto('/admin');
  await expect(page.getByRole('alert').filter({ hasText: 'تعذر تحميل الإحصائيات الآن.' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'تنبيهات إدارية', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'إعادة تحميل الإحصائيات', exact: true }).click();
  await expect(page.getByRole('region', { name: 'إحصائيات الإدارة', exact: true }).getByRole('link', { name: /إجمالي المستخدمين/ })).toContainText('٢٥');
  await expect(page.getByRole('region', { name: 'نشاط التطبيق والموقع', exact: true }).getByRole('definition')).toHaveText(['١١', '١٧', '٣٥']);
  await expect(page.getByRole('alert').filter({ hasText: 'تعذر تحميل الإحصائيات الآن.' })).toHaveCount(0);
});

test('an overview response started before demotion cannot replace a later authorized overview', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  let role = 'admin', requests = 0;
  let release!: () => void, started!: () => void, settled!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const firstRequest = new Promise<void>(resolve => { started = resolve; });
  const firstSettled = new Promise<void>(resolve => { settled = resolve; });
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'workspace-admin', email: 'workspace-admin@example.test', role },
  } }));
  await page.route('**/api/admin/overview', async route => {
    const current = ++requests;
    if (current === 1) { started(); await blocked; }
    await route.fulfill({ json: { totalUsers: current === 1 ? 25 : 99, activeUsers: 7, publishedListings: 15, openReports: 4 } }).catch(() => {});
    if (current === 1) settled();
  });
  try {
    await page.goto('/admin');
    await firstRequest;
    role = 'moderator';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('المؤشرات العامة متاحة لإدارة المنصة فقط.', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'إحصائيات الإدارة', exact: true })).toHaveCount(0);
    role = 'admin';
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const total = page.getByRole('region', { name: 'إحصائيات الإدارة', exact: true }).getByRole('link', { name: /إجمالي المستخدمين/ });
    await expect(total).toContainText('٩٩');
    release();
    await firstSettled;
    await expect(total).toContainText('٩٩');
  } finally { release(); }
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
