import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { ownerFixtureEmail, prepare } from './helpers/admin-presentation-fixture';

const targetId = 'souqhamad-recovery-' + 'a'.repeat(20);
const operationId = '8e1b2bb4-ef67-4694-b18b-6063b0ffac5f';
const backupId = '24a0881f-cb7e-4b4b-8cde-f47a9c73772f';
const mediaOperationId = '8b7f2adc-a517-4d71-8c64-2bd7e89a4a24';
const reason = 'اختبار استرجاع نسخة منفصلة قبل الإطلاق';
const phrase = 'استعادة نسخة منفصلة';
const now = '2026-11-03T12:00:00.000Z';

function status(enabled = true) {
  return {
    rds: { configured: true, enabled, readStatus: 'available',
      source: { identifier: 'source-fixture', resourceId: 'db-fixture', engineVersion: '18.3', status: 'available',
        earliestRestoreTime: '2026-11-01T00:00:00.000Z', latestRestoreTime: now, retentionDays: 7 },
      snapshots: [
        { id: 'snapshot-fixture-old', createdAt: '2026-11-01T10:00:00.000Z', status: 'available', type: 'automated', engineVersion: '18.3' },
        { id: 'snapshot-fixture-latest', createdAt: now, status: 'available', type: 'automated', engineVersion: '18.3' },
      ],
      targets: [{ operationId, targetId, status: 'available', createdAt: now }],
    },
    media: { configured: enabled, readStatus: enabled ? 'available' : 'not_configured', backupEnabled: enabled,
      quarantineOnly: true, productionCutoverAllowed: false,
      runs: [{ id: backupId, kind: 'backup', status: 'completed', createdAt: now, objects: 700_000, bytes: 350_000_000, errors: 0 }],
    },
    capabilities: { databaseRestore: enabled, databaseVerify: enabled, mediaBackup: enabled, mediaRestore: enabled },
    emergencyPlanDownloadPath: '/api/admin/recovery?download=plan',
  };
}

function preview(expiresAt = new Date(Date.now() + 600_000).toISOString()) {
  return { previewToken: 'owner-only-recovery-preview', expiresAt, confirmation: phrase, operationId, targetId,
    source: status().rds.source, selection: { mode: 'snapshot', snapshotId: 'snapshot-fixture-latest' },
    costWarning: 'إنشاء قاعدة منفصلة قد يضيف تكلفة AWS حتى حذفها.',
  };
}

function report() {
  return { operationId, targetId, checkedAt: now, status: 'passed', tlsVerified: true, readOnly: true, engineVersion: '18.3',
    migrations: { expected: 34, applied: 34, pending: [], unknown: [], failed: [], checksumMismatch: [] },
    schema: { tablesChecked: 29, issues: [], fingerprint: 'b'.repeat(64) },
    counts: [{ table: 'Listing', rows: 50_000 }, { table: 'User', rows: 12_000 }],
    foreignKeys: [{ relation: 'Listing.sellerId', orphanRows: 0 }], jobs: [], workersStarted: false, customerRowsReturned: false,
  };
}

async function setup(page: Page, baseURL: string, handlers: {
  get?: (route: Route) => Promise<void>;
  post?: (route: Route, body: Record<string, unknown>) => Promise<void>;
} = {}) {
  await prepare(page, baseURL, 'owner');
  const calls = { reads: 0, downloads: 0, posts: [] as Array<Record<string, unknown>> };
  await page.route('**/api/admin/recovery**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (url.searchParams.get('download') === 'plan') {
        calls.downloads++;
        return route.fulfill({ json: { generatedAt: now, productionCutoverAllowed: false, prerequisites: ['verify isolated database'] } });
      }
      calls.reads++;
      return handlers.get ? handlers.get(route) : route.fulfill({ json: status() });
    }
    const body = request.postDataJSON() as Record<string, unknown>; calls.posts.push(body);
    if (handlers.post) return handlers.post(route, body);
    if (body.action === 'preview_restore') return route.fulfill({ json: { preview: preview() } });
    if (body.action === 'restore_database') return route.fulfill({ status: 202, json: { operationId, targetId, status: 'creating' } });
    if (body.action === 'verify_database') return route.fulfill({ json: report() });
    if (body.action === 'media_status') return route.fulfill({ json: { id: mediaOperationId, kind: 'quarantine_restore', status: 'running', createdAt: now, objects: 10, bytes: 1000, errors: 0 } });
    if (body.action === 'restore_media' || body.action === 'start_media_backup') return route.fulfill({ status: 202, json: {
      id: mediaOperationId, status: 'queued', kind: body.action === 'restore_media' ? 'quarantine_restore' : 'backup',
      createdAt: now, objects: 0, bytes: 0, errors: 0,
    } });
    return route.fulfill({ status: 400, json: { error: 'unexpected_fixture_action' } });
  });
  await page.goto('/admin/maintenance');
  const panel = page.locator('[data-recovery]');
  await expect(panel.locator('summary')).toBeVisible();
  return { panel, calls };
}
async function load(panel: Locator) {
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
}
async function authorize(panel: Locator) {
  await panel.locator('input[name="recoveryReason"]').fill(reason);
  await panel.locator('input[name="recoveryConfirmation"]').fill(phrase);
  await panel.locator('input[name="recoveryCost"]').check();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

test('owner recovery reads only on request and unavailable capabilities never render live action buttons', async ({ page, baseURL }, info) => {
  const { panel, calls } = await setup(page, baseURL!, { get: route => route.fulfill({ json: status(false) }) });
  expect(calls.reads).toBe(0); expect(calls.posts).toEqual([]);
  await load(panel);
  await expect(panel.getByText('source-fixture', { exact: true })).toBeVisible();
  await expect(panel).toContainText('إنشاء قاعدة مستعادة غير مفعّل');
  await expect(panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'بدء نسخ الملفات', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'استعادة الملفات إلى العزل', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'فحص النسخة', exact: true })).toHaveCount(0);
  expect(calls.reads).toBe(1); expect(calls.posts).toEqual([]);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('owner-recovery-readonly.png'), fullPage: true });
});

test('separate database restore requires fresh preview, cost, reason and phrase before one request', async ({ page, baseURL }, info) => {
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  const { panel, calls } = await setup(page, baseURL!, { post: async (route, body) => {
    if (body.action === 'preview_restore') return route.fulfill({ json: { preview: preview() } });
    await held; await route.fulfill({ status: 202, json: { operationId, targetId, status: 'creating' } });
  } });
  try {
    await load(panel);
    await expect(panel.getByLabel('النسخة المحفوظة', { exact: true })).toHaveValue('snapshot-fixture-latest');
    await panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true }).click();
    const execute = panel.getByRole('button', { name: 'إنشاء القاعدة المنفصلة', exact: true });
    await expect(execute).toBeDisabled();
    await panel.locator('input[name="recoveryReason"]').fill(`  ${reason}  `);
    await panel.locator('input[name="recoveryConfirmation"]').fill(phrase);
    await expect(execute).toBeDisabled();
    await panel.locator('input[name="recoveryCost"]').check();
    await expect(execute).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('owner-recovery-confirmation.png'), fullPage: true });
    await execute.click();
    await expect.poll(() => calls.posts.filter(body => body.action === 'restore_database').length).toBe(1);
    await expect(execute).toBeDisabled();
    expect(calls.posts).toEqual([
      { action: 'preview_restore', mode: 'snapshot', snapshotId: 'snapshot-fixture-latest' },
      { action: 'restore_database', previewToken: 'owner-only-recovery-preview', reason, confirmation: phrase, costAcknowledged: true },
    ]);
    release();
    await expect(panel.getByRole('status')).toContainText('بدأ إنشاء قاعدة منفصلة');
    await expect(panel.locator('[data-recovery-preview]')).toHaveCount(0);
    await expect(panel).toContainText('لا يتغير اتصال التطبيق بقاعدة الإنتاج');
    expect(calls.posts).toHaveLength(2);
  } finally { release(); }
});

test('changing restore selection discards approval and expired previews cannot execute', async ({ page, baseURL }) => {
  let expired = false;
  const { panel, calls } = await setup(page, baseURL!, { post: (route, body) => route.fulfill({ json: {
    preview: preview(expired ? '2020-01-01T00:00:00.000Z' : undefined), selection: body.mode,
  } }) });
  await load(panel);
  const previewButton = panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true });
  await previewButton.click(); await authorize(panel);
  await panel.getByLabel('النسخة المحفوظة', { exact: true }).selectOption('snapshot-fixture-old');
  await expect(panel.locator('[data-recovery-preview]')).toHaveCount(0);
  expired = true;
  await previewButton.click();
  await expect(panel.getByRole('alert')).toContainText('انتهت المعاينة');
  await expect(panel.locator('input[name="recoveryReason"]')).toHaveValue('');
  await expect(panel.locator('input[name="recoveryCost"]')).not.toBeChecked();
  await expect(panel.getByRole('button', { name: 'إنشاء القاعدة المنفصلة', exact: true })).toBeDisabled();
  expect(calls.posts.every(body => body.action === 'preview_restore')).toBe(true);
});

test('point-in-time preview sends the selected instant and server report exposes counts without cutover controls', async ({ page, baseURL }, info) => {
  const { panel, calls } = await setup(page, baseURL!);
  await load(panel);
  await panel.getByLabel('مصدر الاستعادة', { exact: true }).selectOption('point_in_time');
  const input = panel.locator('input[name="recoveryTime"]');
  await input.fill('2026-11-02T12:30');
  const expected = await input.evaluate(element => new Date((element as HTMLInputElement).value).toISOString());
  await panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true }).click();
  expect(calls.posts[0]).toEqual({ action: 'preview_restore', mode: 'point_in_time', restoreTime: expected });
  await panel.getByRole('button', { name: 'فحص النسخة', exact: true }).click();
  await expect(panel.locator('[data-recovery-report]')).toContainText('نجح فحص النسخة');
  await panel.locator('[data-recovery-report] summary').click();
  await expect(panel.locator('[data-recovery-report]')).toContainText('Listing');
  expect(calls.posts.at(-1)).toEqual({ action: 'verify_database', targetId });
  await expect(panel.getByRole('button', { name: /تحويل الإنتاج|تغيير الاتصال|حذف القاعدة/ })).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('owner-recovery-report.png'), fullPage: true });
});

test('uncertain database or media responses never retry automatically or retain executable approvals', async ({ page, baseURL }) => {
  const { panel, calls } = await setup(page, baseURL!, { post: (route, body) => body.action === 'preview_restore'
    ? route.fulfill({ json: { preview: preview() } }) : route.abort('connectionreset') });
  await load(panel);
  await panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true }).click();
  await authorize(panel);
  await panel.getByRole('button', { name: 'إنشاء القاعدة المنفصلة', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('قد تكون العملية بدأت');
  await expect(panel.locator('[data-recovery-preview]')).toHaveCount(0);
  expect(calls.posts.filter(body => body.action === 'restore_database')).toHaveLength(1);
  await panel.locator('input[name="recoveryMediaReason"]').fill(reason);
  const backup = panel.getByRole('button', { name: 'بدء نسخ الملفات', exact: true });
  await backup.click();
  await expect(panel.getByRole('alert')).toContainText('قد تكون العملية بدأت');
  await expect(backup).toBeDisabled();
  await expect(panel.locator('input[name="recoveryMediaReason"]')).toHaveValue('');
  expect(calls.posts.filter(body => body.action === 'start_media_backup')).toHaveLength(1);
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect(panel.getByText('source-fixture', { exact: true })).toBeVisible();
  expect(calls.posts.filter(body => body.action === 'start_media_backup')).toHaveLength(1);
});

test('revoked API access clears previously loaded recovery data and owner revocation discards pending responses', async ({ page, baseURL }) => {
  let accessStatus = 200;
  const { panel, calls } = await setup(page, baseURL!, { get: route => accessStatus === 200
    ? route.fulfill({ json: status() }) : route.fulfill({ status: accessStatus, json: { error: 'owner_required' } }) });
  await load(panel);
  for (const forbidden of [401, 403]) {
    accessStatus = forbidden;
    await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(forbidden === 401 ? 'انتهت جلسة الدخول' : 'لمالك المنصة');
    await expect(panel.getByText('source-fixture', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true })).toHaveCount(0);
  }
  expect(calls.posts).toHaveLength(0);
  accessStatus = 200;
  await panel.getByRole('button', { name: 'تحديث حالة الاسترجاع', exact: true }).click();
  await expect(panel.getByText('source-fixture', { exact: true })).toBeVisible();
  let release = () => {}; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/admin/recovery', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await held; await route.fulfill({ json: { preview: preview() } }).catch(() => {});
  });
  await panel.getByRole('button', { name: 'معاينة استعادة قاعدة منفصلة', exact: true }).click();
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true,
    user: { id: 'presentation-admin', email: 'presentation-admin@example.test', role: 'admin' } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel).toHaveCount(0);
  release();
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true,
    user: { id: 'presentation-admin', email: ownerFixtureEmail, role: 'owner' } } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(panel.locator('summary')).toBeVisible();
  await panel.locator('summary').click();
  await expect(panel.locator('[data-recovery-preview]')).toHaveCount(0);
  await expect(panel.getByText('source-fixture', { exact: true })).toHaveCount(0);
});

test('media recovery sends quarantine-only actions and downloads the fixed private emergency plan', async ({ page, baseURL }, info) => {
  const { panel, calls } = await setup(page, baseURL!);
  await load(panel);
  await panel.locator('input[name="recoveryMediaReason"]').fill(reason);
  await panel.getByLabel('نسخة الملفات', { exact: true }).selectOption(backupId);
  const restore = panel.getByRole('button', { name: 'استعادة الملفات إلى العزل', exact: true });
  await expect(restore).toBeDisabled();
  await panel.locator('input[name="recoveryMediaConfirmation"]').fill('استعادة ملفات إلى العزل');
  await restore.click();
  await expect(panel.getByRole('status')).toContainText('أُضيفت مهمة استعادة الملفات إلى العزل');
  expect(calls.posts[0]).toMatchObject({ action: 'restore_media', backupId, reason, confirmation: 'استعادة ملفات إلى العزل' });
  expect(calls.posts[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(calls.posts[0]).not.toHaveProperty('targetBucket');
  await panel.getByRole('button', { name: 'تحديث مهمة الملفات', exact: true }).first().click();
  await expect(panel).toContainText('running');
  expect(calls.posts.at(-1)).toEqual({ action: 'media_status', operationId: mediaOperationId, kind: 'quarantine_restore' });
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'تنزيل خطة الطوارئ', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('souqhamad-emergency-recovery-plan.json');
  expect(calls.downloads).toBe(1);
  await expect(panel).toContainText('لا تعيد الصور إلى إعلانات العملاء');
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('owner-recovery-quarantine.png'), fullPage: true });
});
