import { expect, test, type Page } from '@playwright/test';
import { prepare } from './helpers/admin-presentation-fixture';

const monitoredPaths = ['/api/admin/maintenance', '/api/admin/recovery', '/api/admin/site-message'];
const counts = { deletedListings: 11, deletedListingImages: 22, closedReports: 33, closedUserReports: 44,
  searchStates: 55, idempotencyKeys: 66, modelReviews: 77 };

async function setup(page: Page, baseURL: string, staleControls = false) {
  await prepare(page, baseURL, 'owner');
  const writes: string[] = []; const reads: string[] = [];
  page.on('request', request => {
    if (monitoredPaths.includes(new URL(request.url()).pathname) && request.method() !== 'GET') writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.route('**/api/admin/maintenance**', async route => {
    const url = new URL(route.request().url());
    reads.push(url.search);
    if (url.searchParams.get('resource') === 'database') return route.fallback();
    return route.fulfill({ json: { counts, monitoringOnly: true, productionCleanupEnabled: staleControls,
      scopes: staleControls ? [{ scope: 'closed_reports', canExecute: true, previewToken: 'obsolete-cleanup-token' }] : [],
      ...(staleControls ? { preview: { previewToken: 'obsolete-reset-token', canExecute: true } } : {}) } });
  });
  await page.route('**/api/admin/site-message', route => route.fulfill({ json: { monitoringOnly: true,
    siteMessage: { message: 'رسالة متابعة محفوظة', type: 'info', isEnabled: true, expiresAt: null } } }));
  await page.goto('/admin/maintenance');
  await expect(page.getByRole('heading', { name: 'الصيانة والمراقبة', exact: true })).toBeVisible();
  return { writes, reads };
}

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

for (const staleControls of [false, true]) test(`maintenance is monitoring-only and ignores ${staleControls ? 'obsolete executable previews' : 'empty cleanup capabilities'}`, async ({ page, baseURL }, info) => {
  const { writes, reads } = await setup(page, baseURL!, staleControls);
  const summary = page.getByRole('region', { name: 'ملخص الصيانة', exact: true });
  await expect(summary).toContainText('الإعلانات');
  await expect(summary).toContainText(/١١|11/);
  await expect(page.getByRole('region', { name: 'رسالة الموقع الحالية', exact: true })).toContainText('رسالة متابعة محفوظة');
  await expect(page.locator('[data-market-reset]')).toHaveCount(0);
  await expect(page.locator('form, textarea')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /تنفيذ التنظيف|حذف بيانات السوق|معاينة إعادة ضبط السوق|نشر رسالة|حفظ رسالة/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'تحديث حالة الصيانة', exact: true }).click();
  await expect.poll(() => reads.filter(search => search === '').length).toBeGreaterThanOrEqual(2);
  expect(reads.some(search => search.includes('market_reset') || search.includes('scope='))).toBe(false);
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('maintenance-monitoring-only.png'), fullPage: true });
});

test('a revoked owner loses the maintenance view without sending a mutation', async ({ page, baseURL }) => {
  const { writes } = await setup(page, baseURL!);
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'presentation-admin', email: 'appointed@example.test', role: 'admin' },
  } }));
  await page.getByRole('button', { name: 'تحديث حالة الصيانة', exact: true }).click();
  await expect(page.getByText('رسالة متابعة محفوظة', { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});
