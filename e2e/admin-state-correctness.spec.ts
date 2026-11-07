import { expect, test, type Page } from '@playwright/test';
import { customer, listing, now, pagination, prepare } from './helpers/admin-presentation-fixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function healthyRealtime(page: Page) {
  // A connected stream must not mask a missed initial load by fallback polling.
  await page.addInitScript(() => {
    class HealthyEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() { queueMicrotask(() => this.onopen?.()); }
      addEventListener() {}
      close() {}
    }
    window.EventSource = HealthyEventSource as unknown as typeof EventSource;
  });
}

test('listings load after delayed initial session verification without waiting for a realtime event', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await healthyRealtime(page);
  const started = deferred(), release = deferred();
  let listingRequests = 0;
  await page.route('**/api/auth/session', async route => {
    started.resolve();
    await release.promise;
    await route.fulfill({ json: { authenticated: true, user: {
      id: 'presentation-admin', email: 'presentation-admin@example.test', role: 'admin',
    } } }).catch(() => {});
  });
  await page.route('**/api/admin/listings?**', route => {
    listingRequests++;
    return route.fulfill({ json: { listings: [listing], pagination } });
  });
  try {
    await page.goto('/admin/listings');
    await started.promise;
    await expect(page.getByText('جارٍ التحقق من الدخول…', { exact: true })).toBeVisible();
    expect(listingRequests).toBe(0);
    release.resolve();
    await expect(page.locator('.admin-result-row')).toHaveCount(1);
    expect(listingRequests).toBeGreaterThan(0);
  } finally { release.resolve(); }
});

for (const screen of ['commissions', 'audit-log']) {
  test(`${screen} schedules its first load when delayed verification grants admin permission`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!, 'moderator');
    await healthyRealtime(page);
    const started = deferred(), release = deferred();
    let grantingAdmin = false;
    await page.route('**/api/auth/session', async route => {
      if (grantingAdmin) { started.resolve(); await release.promise; }
      await route.fulfill({ json: { authenticated: true, user: {
        id: 'presentation-admin', email: 'presentation-admin@example.test', role: grantingAdmin ? 'admin' : 'moderator',
      } } }).catch(() => {});
    });
    try {
      await page.goto(`/admin/${screen}`);
      await expect(page.getByText('هذه الصفحة مخصصة للإدارة فقط.', { exact: true })).toBeVisible();
      grantingAdmin = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await started.promise;
      release.resolve();
      if (screen === 'commissions') await expect(page.locator('.admin-record').first()).toBeVisible();
      else await expect(page.getByRole('heading', { name: 'تعديل حالة أو بيانات إعلان', exact: true })).toBeVisible();
      await expect(page.getByText('هذه الصفحة مخصصة للإدارة فقط.', { exact: true })).toHaveCount(0);
    } finally { release.resolve(); }
  });
}

for (const screen of ['users', 'audit-log']) {
  test(`${screen} hides private data on admin demotion and rejects a late response`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    let role = 'admin';
    await page.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: true, user: { id: 'presentation-admin', email: 'presentation-admin@example.test', role },
    } }));
    const release = deferred(), started = deferred(), settled = deferred();
    let requests = 0;
    const result = screen === 'users' ? { users: [customer], pagination } : {
      records: [{ id: 'private-audit', action: 'update_user', targetType: 'user', targetId: customer.id,
        metadata: { private_note: 'معلومات إدارية خاصة' }, createdAt: now,
        admin: { id: 'private-admin', name: 'إدارة سرية', email: 'private-admin@example.test' } }], pagination,
    };
    await page.route(`**/api/admin/${screen}?**`, async route => {
      if (++requests > 1) { started.resolve(); await release.promise; }
      await route.fulfill({ json: result }).catch(() => {});
      if (requests > 1) settled.resolve();
    });
    try {
      await page.goto(`/admin/${screen}`);
      const privateText = screen === 'users' ? customer.email : 'إدارة سرية';
      await expect(page.getByText(privateText, { exact: true })).toBeVisible();
      await page.getByRole('button', { name: screen === 'users' ? 'تحديث' : 'بحث', exact: true }).click();
      await started.promise;
      role = 'moderator';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByText('هذه الصفحة مخصصة للإدارة فقط.', { exact: true })).toBeVisible();
      await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
      release.resolve();
      await settled.promise;
      await expect(page.getByText(privateText, { exact: true })).toHaveCount(0);
      await expect(page.locator('.admin-workspace')).toBeVisible();
    } finally { release.resolve(); }
  });
}

test('an appointed admin sees commission totals for all pages', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.route('**/api/admin/commissions?**', route => route.fulfill({ json: {
    commissions: [], pagination: { ...pagination, total: 125 },
    summary: { totalDue: 450, totalPaid: 990, totalRecords: 125 },
  } }));
  await page.goto('/admin/commissions');
  const statistics = page.locator('.admin-statistics');
  await expect(statistics).toContainText('٤٥٠ ر.س');
  await expect(statistics).toContainText('٩٩٠ ر.س');
  await expect(statistics).toContainText('١٢٥');
  await expect(page.getByText('هذه الصفحة مخصصة لمالك المنصة فقط.')).toHaveCount(0);
});

test('deleting a listing preserves an unsaved description without restoring publication on save', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  let record = { ...listing, updatedAt: now };
  let revision = 0;
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/listings**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { listings: [record], pagination } });
    const body = route.request().postDataJSON();
    writes.push(body);
    const { expectedUpdatedAt, ...changes } = body;
    expect(expectedUpdatedAt).toBe(record.updatedAt);
    record = { ...record, ...changes, updatedAt: new Date(Date.parse(now) + ++revision * 1000).toISOString() };
    return route.fulfill({ json: { listing: record } });
  });
  await page.goto('/admin/listings');
  await page.getByRole('button', { name: 'معاينة إعلان الاختبار', exact: true }).click();
  await page.getByLabel('الوصف', { exact: true }).fill('وصف غير محفوظ');
  await page.getByRole('button', { name: 'حذف', exact: true }).click();
  await page.getByRole('dialog', { name: 'تأكيد حذف الإعلان', exact: true }).getByRole('button', { name: 'حذف الإعلان', exact: true }).click();
  await expect(page.locator('select[name$="-status"]')).toHaveValue('deleted');
  await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue('وصف غير محفوظ');
  await page.getByRole('button', { name: 'إغلاق نتيجة إجراء الإدارة', exact: true }).click();
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ description: 'وصف غير محفوظ', expectedUpdatedAt: new Date(Date.parse(now) + 1000).toISOString() });
  expect(record.status).toBe('deleted');
});

test('listing refreshes rebase untouched fields and require review for conflicting local edits', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  let record = { ...listing, updatedAt: now };
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/listings**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { listings: [record], pagination } });
    const body = route.request().postDataJSON();
    writes.push(body);
    record = { ...record, ...body };
    return route.fulfill({ json: { listing: record } });
  });
  await page.goto('/admin/listings');
  await page.getByRole('button', { name: 'معاينة إعلان الاختبار', exact: true }).click();
  await page.getByLabel('العنوان', { exact: true }).fill('عنوان المسودة');
  record = { ...record, description: 'وصف من البائع', updatedAt: '2026-10-17T10:01:00.000Z' };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue('وصف من البائع');
  await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue('عنوان المسودة');
  record = { ...record, title: 'عنوان من البائع', updatedAt: '2026-10-17T10:02:00.000Z' };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('dialog', { name: 'معاينة الإعلان', exact: true })
    .getByRole('alert').getByText('عنوان من البائع', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'الاحتفاظ بتعديلاتي', exact: true }).click();
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ title: 'عنوان المسودة', expectedUpdatedAt: '2026-10-17T10:02:00.000Z' });
});

test('unsubmitted listing filters do not change later pages and focused links ignore prior filters', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  const requests: URL[] = [];
  await page.route('**/api/admin/listings?**', route => {
    const url = new URL(route.request().url());
    requests.push(url);
    const pageNumber = Number(url.searchParams.get('page'));
    const focused = url.searchParams.has('listingId');
    const rows = focused ? [listing] : Array.from({ length: 24 }, (_, i) => ({
      ...listing, id: `listing-${pageNumber}-${i}`, title: `إعلان ${pageNumber}-${i}`, status: url.searchParams.get('status') === 'paused' ? 'paused' : 'published',
    }));
    return route.fulfill({ json: { listings: rows, pagination: { ...pagination, page: pageNumber, hasMore: !focused && pageNumber === 1, nextPage: pageNumber === 1 ? 2 : null, total: 48 } } });
  });
  await page.goto('/admin/listings');
  await expect(page.locator('.admin-result-row')).toHaveCount(24);
  await page.getByRole('textbox', { name: 'بحث الإعلانات', exact: true }).fill('فلتر لم يطبق');
  await page.locator('.admin-content > main').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => requests.some(url => url.searchParams.get('page') === '2')).toBe(true);
  const secondPage = requests.find(url => url.searchParams.get('page') === '2')!;
  expect(secondPage.searchParams.has('query')).toBe(false);
  await page.locator('.admin-content > main').evaluate(element => { element.scrollTop = 0; });
  await page.getByLabel('تصفية حالة الإعلان', { exact: true }).selectOption('paused');
  await expect.poll(() => requests.some(url => url.searchParams.get('status') === 'paused')).toBe(true);
  // Native history updates are handled by Next's useSearchParams, as are same-route notification links.
  await page.evaluate(id => window.history.pushState(null, '', `/admin/listings?listingId=${id}`), listing.id);
  await expect(page.getByRole('dialog', { name: 'معاينة الإعلان', exact: true })).toBeVisible();
  const focused = requests.findLast(url => url.searchParams.get('listingId') === listing.id)!;
  for (const key of ['status', 'query', 'category', 'categoryOption', 'carModel', 'sellerId']) expect(focused.searchParams.has(key)).toBe(false);
});

test('a slow previous user search cannot replace the latest search results', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  const release = deferred(), started = deferred(), settled = deferred();
  await page.route('**/api/admin/users?**', async route => {
    const query = new URL(route.request().url()).searchParams.get('query');
    if (query === 'قديم') { started.resolve(); await release.promise; }
    await route.fulfill({ json: { users: [{ ...customer, name: query || customer.name }], pagination } }).catch(() => {});
    if (query === 'قديم') settled.resolve();
  });
  try {
    await page.goto('/admin/users');
    await expect(page.locator('.admin-result-row')).toHaveCount(1);
    await page.locator('input[name="userSearch"]').fill('قديم');
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await started.promise;
    await page.locator('input[name="userSearch"]').fill('جديد');
    await page.getByRole('button', { name: 'بحث', exact: true }).click();
    await expect(page.locator('.admin-result-row')).toContainText('جديد');
    release.resolve(); await settled.promise;
    await expect(page.locator('.admin-result-row')).toContainText('جديد');
    await expect(page.locator('.admin-result-row')).not.toContainText('قديم');
  } finally { release.resolve(); }
});
