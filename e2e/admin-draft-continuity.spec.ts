import { expect, test, type Page } from '@playwright/test';
import { customer, listing, pagination, prepare } from './helpers/admin-presentation-fixture';

async function healthyRealtime(page: Page) {
  await page.addInitScript(() => {
    const connections: Array<{ closed: boolean; emit: (data: unknown) => void }> = [];
    Object.assign(window, { adminDraftAuditConnections: connections });
    class HealthyEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      listeners = new Map<string, Array<(event: { data: string }) => void>>();
      constructor() { connections.push(this); queueMicrotask(() => this.onopen?.()); }
      addEventListener(name: string, listener: (event: { data: string }) => void) {
        this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]);
      }
      close() { this.closed = true; }
      emit(data: unknown) {
        if (!this.closed) for (const listener of this.listeners.get('smartstore') ?? []) listener({ data: JSON.stringify(data) });
      }
    }
    window.EventSource = HealthyEventSource as unknown as typeof EventSource;
  });
}

async function sendListingUpdate(page: Page, id: number) {
  await page.evaluate(eventId => {
    const source = window as unknown as { adminDraftAuditConnections: Array<{ emit: (event: unknown) => void }> };
    for (const connection of source.adminDraftAuditConnections) connection.emit({ id: eventId, type: 'ad_updated', payload: { listingId: 'another-listing' } });
  }, id);
}

async function closeUserDraft(page: Page) {
  await page.getByRole('button', { name: 'إغلاق المعاينة', exact: true }).click();
  await expect(page.getByText('لم تُحفظ التعديلات. ستبقى مسودة في هذه الصفحة.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'متابعة دون حفظ', exact: true }).click();
}

test('user drafts survive refreshes and unrelated updates while conflicting contact changes require review', async ({ page, baseURL }) => {
  await prepare(page, baseURL!, 'owner');
  await healthyRealtime(page);
  let record = { ...customer };
  let reads = 0;
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/users?**', route => {
    reads++;
    return route.fulfill({ json: { users: [record], pagination } });
  });
  await page.route('**/api/admin/users/*', route => {
    const body = route.request().postDataJSON(); writes.push(body);
    record = { ...record, ...body };
    return route.fulfill({ json: { user: record } });
  });
  await page.goto('/admin/users');
  const opener = page.getByRole('button', { name: `فتح ${customer.name}`, exact: true });
  await opener.click();
  const phone = page.locator(`input[name="user-${customer.id}-phoneNumber"]`);
  const role = page.locator(`select[name="user-${customer.id}-role"]`);
  await phone.fill('0511111111');
  await closeUserDraft(page);
  record = { ...record, role: 'moderator' };
  let before = reads;
  await page.getByRole('button', { name: 'تحديث', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await opener.click();
  await expect(phone).toHaveValue('0511111111');
  await expect(role).toHaveValue('moderator');
  await expect(page.getByRole('button', { name: 'حفظ التعديلات', exact: true })).toBeEnabled();
  await closeUserDraft(page);
  record = { ...record, phoneNumber: '0522222222' };
  before = reads;
  await page.getByRole('button', { name: 'تحديث', exact: true }).click();
  await expect.poll(() => reads).toBeGreaterThan(before);
  await opener.click();
  await expect(phone).toHaveValue('0511111111');
  await expect(page.getByRole('alert').getByText('0522222222', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'حفظ التعديلات', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'الاحتفاظ بتعديلاتي', exact: true }).click();
  await page.getByRole('button', { name: 'حفظ التعديلات', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ phoneNumber: '0511111111' });
  expect(record.role).toBe('moderator');
});

test('clearing a user phone does not discard an unsaved role change', async ({ page, baseURL }) => {
  await prepare(page, baseURL!, 'owner');
  await healthyRealtime(page);
  let record = { ...customer };
  const writes: Array<Record<string, unknown>> = [];
  await page.route('**/api/admin/users?**', route => route.fulfill({ json: { users: [record], pagination } }));
  await page.route('**/api/admin/users/*', route => {
    const body = route.request().postDataJSON(); writes.push(body); record = { ...record, ...body };
    return route.fulfill({ json: { user: record } });
  });
  await page.goto('/admin/users');
  await page.getByRole('button', { name: `فتح ${customer.name}`, exact: true }).click();
  const role = page.locator(`select[name="user-${customer.id}-role"]`);
  await role.selectOption('moderator');
  await page.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.locator(`input[name="user-${customer.id}-phoneNumber"]`)).toHaveValue('');
  await expect(role).toHaveValue('moderator');
  expect(writes[0]).toEqual({ phoneNumber: '' });
  await page.getByRole('button', { name: 'حفظ التعديلات', exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual({ role: 'moderator' });
});

test('a later-page listing editor stays open on refresh, revalidates its record and handles missing or unavailable reads truthfully', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await healthyRealtime(page);
  const records = Array.from({ length: 25 }, (_, index) => ({ ...listing, id: `draft-listing-${index + 1}`, title: `Draft listing ${index + 1}` }));
  let selected = records[24];
  let secondPageReads = 0, selectedReads = 0;
  let selectionResult: 'ok' | 'unavailable' | 'missing' = 'ok';
  await page.route('**/api/admin/listings?**', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('listingId')) {
      selectedReads++;
      if (selectionResult === 'unavailable') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: { listings: selectionResult === 'missing' ? [] : [selected], pagination: { ...pagination, limit: 1 } } });
    }
    if (params.get('page') === '2') {
      secondPageReads++;
      // Keep subsequent page-two refreshes empty so the selected preview must
      // rely on its verified record, rather than another paginated response.
      return route.fulfill({ json: { listings: secondPageReads === 1 ? [selected] : [], pagination: { ...pagination, page: 2, total: 25 } } });
    }
    return route.fulfill({ json: { listings: records.slice(0, 24), pagination: { ...pagination, limit: 24, total: 25, hasMore: true, nextPage: 2 } } });
  });
  await page.goto('/admin/listings');
  await expect(page.locator('.admin-result-row')).toHaveCount(24);
  await page.locator('.admin-content > main').evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(page.locator('.admin-result-row')).toHaveCount(25);
  await page.getByRole('button', { name: 'فتح Draft listing 25', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'معاينة الإعلان', exact: true });
  await page.getByLabel('العنوان', { exact: true }).fill('Unsaved page two title');
  selected = { ...selected, description: 'Updated description from the seller' };
  await sendListingUpdate(page, 92001);
  await expect.poll(() => selectedReads).toBeGreaterThan(0);
  await expect(preview).toBeVisible();
  await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue('Unsaved page two title');
  await expect(page.getByLabel('الوصف', { exact: true })).toHaveValue('Updated description from the seller');
  await expect(page.locator('.admin-result-row')).toHaveCount(24);
  selectionResult = 'unavailable';
  await sendListingUpdate(page, 92002);
  await expect(preview.getByRole('alert')).toContainText('تعذر التحقق');
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeDisabled();
  await expect(page.getByLabel('العنوان', { exact: true })).toHaveValue('Unsaved page two title');
  selectionResult = 'ok';
  await page.getByRole('button', { name: 'إعادة التحقق من الإعلان', exact: true }).click();
  await expect(preview.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'حفظ', exact: true })).toBeEnabled();
  selectionResult = 'missing';
  await sendListingUpdate(page, 92003);
  await expect(preview).toHaveCount(0);
  await expect(page.getByText('الإعلان المفتوح لم يعد متاحًا. حُدّثت قائمة الإعلانات.', { exact: true })).toBeVisible();
});
