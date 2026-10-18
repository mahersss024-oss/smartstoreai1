import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';
import { now, customer, listing, report, pagination, prepare } from './helpers/admin-presentation-fixture';

test('changed administration pages fit mobile tablet and desktop without duplicate home navigation', async ({
  page,
  baseURL,
}, testInfo) => {
  test.setTimeout(180_000);
  await prepare(page, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      '',
      '/listings',
      '/users',
      '/moderation',
      '/commissions',
      '/audit-log',
      '/maintenance',
    ]) {
      await page.goto('/admin' + route);
      await expect(page.locator('.admin-page')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator('.app-welcome')).toBeHidden();
      if (['/users', '/listings'].includes(route)) {
        await expect(page.locator('.admin-result-row').first()).toBeVisible();
      } else if (['/moderation', '/commissions'].includes(route)) {
        await expect(page.locator('.admin-record').first()).toBeVisible();
      } else if (route === '/audit-log') {
        await expect(
          page.getByRole('heading', {
            name: 'تعديل حالة أو بيانات إعلان',
            exact: true,
          }),
        ).toBeVisible();
      } else if (route === '/maintenance') {
        await expect(page.locator('textarea')).toHaveValue('رسالة الاختبار');
      } else if (route === '') {
        await expect(
          page.getByRole('heading', { name: 'العمولات الحالية', exact: true }),
        ).toBeVisible();
      }
      if (route === '') {
        await expect(
          page.locator('main nav[aria-label="أقسام الإدارة"]'),
        ).toHaveCount(0);
        await expect(page.locator('main img[alt="سوق حمد"]')).toHaveCount(0);
      } else await expect(page.locator('.admin-page-heading')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `${route.slice(1) || 'overview'}-${width}.png`,
        ),
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});

test('evidence remains readable and original technical values and write payloads are preserved', async ({
  page,
  baseURL,
}, testInfo) => {
  const writes = await prepare(page, baseURL!);
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto('/admin/moderation');
  await page
    .getByRole('button', { name: 'الأدلة المحفوظة', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'الأدلة مكتملة' }),
  ).toBeVisible();
  await page.getByText('الإعلان وقت البلاغ', { exact: true }).click();
  await expect(
    page
      .getByText('وصف الإعلان الأصلي', { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.getByText('الصور المحفوظة (1)', { exact: true }).click();
  await expect(
    page.getByRole('img', { name: 'صورة محفوظة ضمن الأدلة 1' }),
  ).toBeVisible();
  await page.getByText('المحادثة المحفوظة', { exact: true }).click();
  await expect(
    page.getByText('رسالة محفوظة دون تغيير', { exact: true }),
  ).toBeVisible();
  await page.getByText('سجل القضية', { exact: true }).click();
  const events = page.getByRole('list', { name: 'أحداث القضية' });
  await expect(
    events.getByText('عرض صورة محفوظة', { exact: true }),
  ).toHaveCount(7);
  await expect(events.locator('pre:visible')).toHaveCount(0);
  await events
    .getByText('بيانات الحدث الأصلية', { exact: true })
    .nth(1)
    .click();
  await expect(events.locator('pre:visible')).toContainText('b'.repeat(64));
  expect(
    await page
      .locator('.admin-evidence')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page
    .getByRole('button', { name: 'إعادة محاولة حفظ الصور', exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: '/api/admin/moderation/reports/presentation-report',
    method: 'PATCH',
    body: { action: 'evidence_retry', reason: '', days: 180, confirmation: '' },
  });
  await page.getByText('إدارة الاحتفاظ والإتلاف', { exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'إتلاف الأدلة', exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel('سبب الإجراء', { exact: true })
    .fill('سبب إداري موثق للاختبار');
  await expect(
    page.getByRole('button', { name: 'تمديد الاحتفاظ', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'إتلاف الأدلة', exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath('evidence-readable.png'),
    fullPage: true,
  });
});

test('rearranged listing fields and user controls send their original save contracts', async ({
  page,
  baseURL,
}) => {
  const writes = await prepare(page, baseURL!);
  await page.goto('/admin/listings');
  await page
    .getByRole('button', { name: 'معاينة إعلان الاختبار', exact: true })
    .click();
  await page.getByLabel('العنوان', { exact: true }).fill('عنوان بعد الترتيب');
  await page.getByLabel('الوصف', { exact: true }).fill('الوصف بعد الترتيب');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: '/api/admin/listings/presentation-listing',
    method: 'PATCH',
    body: {
      title: 'عنوان بعد الترتيب',
      description: 'الوصف بعد الترتيب',
      category: 'other',
      city: 'الرياض',
      condition: 'used',
      price: 100,
      priceMode: null,
      status: 'published',
    },
  });
  await page.goto('/admin/users');
  await page
    .getByRole('button', { name: 'معاينة عميل الاختبار', exact: true })
    .click();
  await page.locator('input[name$="-phoneNumber"]').fill('0555555555');
  await page
    .getByRole('button', { name: 'حفظ التعديلات', exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].method).toBe('PATCH');
  expect(writes[1].body).toEqual({ role: 'user', phoneNumber: '0555555555' });
});

test('record previews preserve drafts results focus and original deletion confirmation', async ({
  page,
  baseURL,
}, testInfo) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/listings?**', (route) =>
    route.fulfill({
      json: {
        listings: [
          {
            ...listing,
            images: [
              {
                id: 'primary',
                thumbnailUrl: '/hamad-market-logo.webp',
                isPrimary: true,
              },
              {
                id: 'second',
                thumbnailUrl: '/hamad-market-logo.webp?second',
                isPrimary: false,
              },
            ],
          },
          { ...listing, id: 'second-listing', title: 'الإعلان الثاني' },
        ],
        pagination: { ...pagination, total: 2 },
      },
    }),
  );
  await page.goto('/admin/listings');
  const opener = page.getByRole('button', {
    name: 'معاينة إعلان الاختبار',
    exact: true,
  });
  await opener.click();
  const preview = page.getByRole('dialog', {
    name: 'معاينة الإعلان',
    exact: true,
  });
  await expect(preview).toBeVisible();
  await page
    .getByRole('button', { name: 'عرض صورة الإعلان 2', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'عرض صورة الإعلان 2', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    preview.getByRole('img', { name: 'إعلان الاختبار', exact: true }),
  ).toHaveAttribute('src', '/hamad-market-logo.webp?second');
  await expect
    .poll(() =>
      preview
        .getByRole('img', { name: 'إعلان الاختبار', exact: true })
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByLabel('العنوان', { exact: true }).fill('مسودة لم تحفظ');
  await page.getByRole('button', { name: 'السجل التالي', exact: true }).click();
  await expect(
    page.getByText('لم تُحفظ التعديلات. ستبقى مسودة في هذه الصفحة.'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'متابعة دون حفظ', exact: true })
    .click();
  await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue(
    'الإعلان الثاني',
  );
  await page.getByRole('button', { name: 'السجل السابق', exact: true }).click();
  await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue(
    'مسودة لم تحفظ',
  );
  await page.getByRole('button', { name: 'حذف', exact: true }).click();
  const confirmation = page.getByRole('dialog', {
    name: 'تأكيد حذف الإعلان',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole('button', { name: 'إلغاء', exact: true })
    .click();
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('listing-preview.png') });
  await page
    .getByRole('button', { name: 'إغلاق المعاينة', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'متابعة دون حفظ', exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.locator('.admin-result-row')).toHaveCount(2);
});

test('user preview keeps protected roles safe and provides exact seller navigation', async ({
  page,
  baseURL,
}, testInfo) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/users?**', (route) =>
    route.fulfill({
      json: {
        users: [
          customer,
          { ...customer, id: 'owner', role: 'owner', name: 'مالك الاختبار' },
        ],
        pagination: { ...pagination, total: 2 },
      },
    }),
  );
  await page.goto('/admin/users');
  await page
    .getByRole('button', { name: 'معاينة عميل الاختبار', exact: true })
    .click();
  const preview = page.getByRole('dialog', {
    name: 'ملف المستخدم',
    exact: true,
  });
  await expect(
    preview.getByRole('link', { name: 'الإعلانات: ١', exact: true }),
  ).toHaveAttribute(
    'href',
    `/admin/listings?sellerId=${encodeURIComponent(customer.id)}`,
  );
  await page.screenshot({ path: testInfo.outputPath('user-preview.png') });
  await page.getByRole('button', { name: 'السجل التالي', exact: true }).click();
  await expect(preview.locator('select[name$="-role"]')).toBeDisabled();
  await expect(
    preview.getByRole('button', { name: 'حفظ التعديلات', exact: true }),
  ).toBeDisabled();
  await expect(
    preview.getByRole('button', { name: 'تعطيل الحساب', exact: true }),
  ).toHaveCount(0);
  expect(
    await preview.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
});

test('report notification acknowledgement is shared across administrator sessions without resolving reports', async ({
  page,
  browser,
  baseURL,
}) => {
  await prepare(page, baseURL!);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await prepare(otherPage, baseURL!);
  const otherUser = {
    id: 'second-administrator',
    role: 'admin',
    email: 'second-admin@example.test',
  };
  const [name, value] = createSessionCookie(otherUser).split(';')[0].split('=');
  await otherContext.addCookies([{ name, value, url: baseURL! }]);
  await otherPage.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: true, user: otherUser } }),
  );
  let viewed = false;
  const item = {
    id: 'shared-case',
    sourceType: 'Report',
    sourceId: report.id,
    listingId: listing.id,
    title: listing.title,
    reason: report.reason,
    details: report.details,
    createdAt: now,
  };
  for (const target of [page, otherPage])
    await target.route('**/api/admin/moderation**', (route) => {
      const request = route.request();
      if (
        request.method() === 'GET' &&
        new URL(request.url()).searchParams.get('view') === 'notifications'
      )
        return route.fulfill({
          json: {
            notifications: viewed ? [] : [item],
            page: 1,
            hasMore: false,
          },
        });
      if (
        request.method() === 'PATCH' &&
        request.postDataJSON().action === 'notification_viewed'
      ) {
        expect(request.postDataJSON()).toEqual({
          action: 'notification_viewed',
          caseId: item.id,
        });
        viewed = true;
        return route.fulfill({ json: { acknowledged: true } });
      }
      return route.fallback();
    });
  try {
    await page.goto('/admin/listings');
    await otherPage.goto('/admin/listings');
    await otherPage
      .getByRole('button', { name: 'إشعارات البلاغات', exact: true })
      .click();
    await expect(otherPage.locator('.admin-notification-row')).toHaveCount(1);
    await page
      .getByRole('button', { name: 'إشعارات البلاغات', exact: true })
      .click();
    await page.locator('.admin-notification-row').click();
    await expect(
      page.getByRole('dialog', { name: 'بلاغ إعلان', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('تم الاطلاع على الإشعار للجميع. حالة البلاغ لم تتغير.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'معالجة البلاغ', exact: true }),
    ).toHaveAttribute(
      'href',
      `/admin/moderation?reportId=${report.id}&sourceType=Report`,
    );
    await otherPage
      .getByRole('button', { name: 'تحديث إشعارات البلاغات', exact: true })
      .click();
    await expect(otherPage.locator('.admin-notification-row')).toHaveCount(0);
    await page
      .getByRole('link', { name: 'معالجة البلاغ', exact: true })
      .click();
    await expect(
      page.getByText('البلاغ المحدد من الإشعارات', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'رفض البلاغ', exact: true }),
    ).toBeVisible();
  } finally {
    await otherContext.close();
  }
});

test('failed shared acknowledgement leaves the report notification available for retry', async ({
  page,
  baseURL,
}) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/moderation**', (route) => {
    if (route.request().method() === 'PATCH')
      return route.fulfill({ status: 503, json: { error: 'unavailable' } });
    if (
      new URL(route.request().url()).searchParams.get('view') ===
      'notifications'
    )
      return route.fulfill({
        json: {
          notifications: [
            {
              id: 'case',
              sourceType: 'Report',
              sourceId: report.id,
              title: listing.title,
              reason: report.reason,
              createdAt: now,
            },
          ],
          page: 1,
          hasMore: false,
        },
      });
    return route.fallback();
  });
  await page.goto('/admin/listings');
  await page
    .getByRole('button', { name: 'إشعارات البلاغات', exact: true })
    .click();
  await page.locator('.admin-notification-row').click();
  await expect(page.getByRole('alert')).toContainText('لم يُسجّل الاطلاع');
  await expect(page.locator('.admin-notification-row')).toHaveCount(1);
  await expect(
    page.getByRole('dialog', { name: 'بلاغ إعلان', exact: true }),
  ).toHaveCount(0);
});

test('workspace distributions and chart controls use recorded data and navigate supported filters', async ({
  page,
  baseURL,
}, testInfo) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/overview?view=workspace**', (route) =>
    route.fulfill({
      json: {
        month: '2026-10',
        listings: [
          { status: 'published', count: 3 },
          { status: 'pending', count: 1 },
        ],
        evidence: [{ status: 'complete', count: 2 }],
        commissions: [],
        visits: [{ day: '2026-10-16', visits: 7, uniqueVisitors: 4 }],
        events: [],
        hasMoreEvents: false,
      },
    }),
  );
  await page.goto('/admin');
  const distribution = page.getByRole('region', {
    name: 'توزيع حالات الإعلانات',
    exact: true,
  });
  await expect(distribution).toContainText('٣');
  await page
    .getByRole('button', { name: 'عرض الزيارات بخط زمني', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'عرض الزيارات بخط زمني', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.apexcharts-canvas')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('overview-real-fixtures.png'),
    fullPage: true,
  });
  await distribution
    .getByRole('link', { name: 'بانتظار المراجعة', exact: true })
    .click();
  await expect(page.locator('select[name="listingStatusFilter"]')).toHaveValue(
    'pending',
  );
  await page
    .getByRole('button', { name: 'البحث في أقسام الإدارة', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'بحث في أقسام الإدارة', exact: true })
    .fill('العملاء');
  await page.getByRole('option', { name: 'العملاء', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});
