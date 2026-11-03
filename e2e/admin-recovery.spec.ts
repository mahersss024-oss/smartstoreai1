import { expect, test, type Page } from '@playwright/test';
import { prepare } from './helpers/admin-presentation-fixture';

const now = '2026-11-03T12:00:00.000Z';
const backupId = '24a0881f-cb7e-4b4b-8cde-f47a9c73772f';
function status(oldEnabledFlags = false) {
  return { monitoringOnly: true,
    rds: { configured: true, enabled: oldEnabledFlags, readStatus: 'available',
      source: { identifier: 'source-fixture', resourceId: 'db-fixture', engineVersion: '18.3', status: 'available',
        earliestRestoreTime: '2026-11-01T00:00:00.000Z', latestRestoreTime: now, retentionDays: 7 },
      snapshots: [{ id: 'snapshot-fixture', createdAt: now, status: 'available', type: 'automated', engineVersion: '18.3' }], targets: [] },
    media: { configured: true, readStatus: 'available', backupEnabled: oldEnabledFlags, quarantineOnly: true,
      productionCutoverAllowed: false, runs: [{ id: backupId, kind: 'backup', status: 'completed', createdAt: now,
        objects: 70_000, bytes: 350_000_000, errors: 0 }] },
    capabilities: { databaseRestore: oldEnabledFlags, databaseVerify: oldEnabledFlags, mediaBackup: oldEnabledFlags, mediaRestore: oldEnabledFlags },
    productionCutoverAllowed: false, emergencyPlanDownloadPath: '/api/admin/recovery?download=plan',
  };
}
async function setup(page: Page, baseURL: string, oldEnabledFlags = false) {
  await prepare(page, baseURL, 'owner');
  const calls = { reads: 0, downloads: 0, writes: [] as string[] };
  await page.route('**/api/admin/recovery**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') { calls.writes.push(request.method()); return route.fulfill({ status: 403, json: { error: 'recovery_read_only' } }); }
    if (new URL(request.url()).searchParams.get('download') === 'plan') {
      calls.downloads++; return route.fulfill({ json: { generatedAt: now, automaticProductionCutover: false,
        steps: ['استعادة من AWS بحساب تشغيل مستقل'] } });
    }
    calls.reads++; return route.fulfill({ json: status(oldEnabledFlags) });
  });
  await page.goto('/admin/maintenance');
  const panel = page.locator('[data-recovery]');
  await expect(panel.locator('summary')).toBeVisible();
  return { panel, calls };
}
test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

for (const oldEnabledFlags of [false, true]) test(`backup monitoring never offers cloud execution even when old capabilities are ${oldEnabledFlags}`, async ({ page, baseURL }, info) => {
  const { panel, calls } = await setup(page, baseURL!, oldEnabledFlags);
  expect(calls.reads).toBe(0);
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect(panel.getByText('source-fixture', { exact: true })).toBeVisible();
  await expect(panel).toContainText('18.3');
  await expect(panel).toContainText(backupId);
  await expect(panel.locator('form, input, textarea, select')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /معاينة|استعادة ملفات|إنشاء القاعدة|بدء نسخ|فحص النسخة|تحديث مهمة الملفات/ })).toHaveCount(0);
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect.poll(() => calls.reads).toBe(2); expect(calls.writes).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('backup-monitoring-only.png'), fullPage: true });
});

test('recovery access revocation clears previously displayed metadata', async ({ page, baseURL }) => {
  const { panel, calls } = await setup(page, baseURL!);
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect(panel.getByText('source-fixture', { exact: true })).toBeVisible();
  await page.route('**/api/admin/recovery**', route => route.fulfill({ status: 403, json: { error: 'owner_required' } }));
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect(panel.getByText('source-fixture', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('alert')).toBeVisible(); expect(calls.writes).toEqual([]);
});

test('the monitoring emergency guide is downloaded with GET only', async ({ page, baseURL }) => {
  const { panel, calls } = await setup(page, baseURL!);
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'تنزيل خطة الطوارئ', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
  expect(calls.downloads).toBe(1); expect(calls.writes).toEqual([]);
});
