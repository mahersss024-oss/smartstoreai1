import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

for (const role of ['admin', 'moderator']) {
  test(`existing report details expose evidence and preserve ${role} permissions`, async ({ page, baseURL }, testInfo) => {
    const user = { id: 'evidence-admin', email: 'evidence-admin@example.test', role };
    const cookie = createSessionCookie(user).split(';')[0].split('=');
    await page.context().addCookies([{ name: cookie[0], value: cookie[1], url: baseURL! }]);
    await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, user } }));
    const listing = { id: 'evidence-listing', title: 'إعلان محفوظ', sellerId: 'seller', category: 'other', status: 'published' };
    const report = { id: 'evidence-report', listingId: listing.id, reporterId: 'buyer', reason: 'fraud', status: 'open', createdAt: new Date().toISOString(), listing };
    await page.route('**/api/admin/moderation**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/admin/moderation') {
        return route.fulfill({ json: { listings: [], reports: [report], userReports: [] } });
      }
      return route.fulfill({ json: {
        evidenceCase: { id: 'case', status: 'open', captureStatus: 'complete', snapshotHash: 'a'.repeat(64), retainUntil: null, legalHold: false, snapshot: { listing: { ...listing, description: 'الوصف الأصلي وقت البلاغ', price: 100 }, report, participants: [{ id: 'buyer', name: 'المبلّغ' }], messages: [{ id: 'message', senderId: 'seller', body: 'نص محفوظ من المحادثة', createdAt: new Date().toISOString() }] } },
        assets: [], events: [{ id: 'event', action: 'case.opened', createdAt: new Date().toISOString(), actorId: null, payload: {} }], page: 1, hasMore: false,
      } });
    });
    await page.goto('/admin/moderation');
    await page.getByRole('button', { name: 'الأدلة المحفوظة', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'الأدلة مكتملة' })).toBeVisible();
    await page.getByText('الإعلان وقت البلاغ', { exact: true }).click();
    await expect(page.getByText('الوصف الأصلي وقت البلاغ')).toBeVisible();
    await page.getByText('المحادثة المحفوظة', { exact: true }).click();
    await expect(page.getByText('نص محفوظ من المحادثة', { exact: true })).toBeVisible();
    if (role === 'admin') {
      await page.getByText('إدارة الاحتفاظ والإتلاف', { exact: true }).click();
      await expect(page.getByRole('button', { name: 'إتلاف الأدلة', exact: true })).toBeDisabled();
      await page.getByLabel('سبب الإجراء', { exact: true }).fill('سبب إداري موثق للمراجعة');
      await expect(page.getByRole('button', { name: 'تمديد الاحتفاظ' })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'إتلاف الأدلة', exact: true })).toBeDisabled();
    } else {
      await expect(page.getByText('إدارة الاحتفاظ والإتلاف', { exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole('button', { name: 'رفض البلاغ', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`evidence-${role}.png`), fullPage: true });
  });
}
