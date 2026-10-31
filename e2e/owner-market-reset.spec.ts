import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { ownerFixtureEmail, prepare } from './helpers/admin-presentation-fixture';

const phrase = 'حذف بيانات السوق والإبقاء على المستخدمين';
const reason = 'إعادة تجهيز بيانات السوق للاختبار المعزول';

function preview(expiresAt = new Date(Date.now() + 600_000).toISOString()) {
  return {
    previewToken: 'isolated-market-reset-preview', expiresAt,
    counts: [
      { kind: 'Listing', label: 'الإعلانات', count: 5, mode: 'delete' },
      { kind: 'Conversation', label: 'المحادثات', count: 3, mode: 'delete' },
      { kind: 'EvidenceCase', label: 'قضايا الأدلة', count: 3, mode: 'delete' },
      { kind: 'Commission', label: 'الرسوم والعمولات', count: 2, mode: 'delete' },
      { kind: 'MobilePushToken', label: 'تسجيلات إشعارات الجوال', count: 2, mode: 'delete' },
      { kind: 'ImageObjectCleanup', label: 'مهام تنظيف الملفات', count: 2, mode: 'cleanup' },
    ],
    preserved: { users: 9, profileImages: 6 },
    blockers: [],
    protectedData: { evidenceCases: 3, heldEvidenceCases: 1, commissions: 2 },
    maxRows: 50_000, totalRows: 26, canExecute: true,
  };
}

async function setup(page: Page, baseURL: string, handlers: {
  get?: (route: Route) => Promise<void>;
  post?: (route: Route) => Promise<void>;
} = {}) {
  await prepare(page, baseURL, 'owner');
  const calls = { previews: 0, resets: [] as Array<Record<string, unknown>> };
  await page.route('**/api/admin/maintenance**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('resource') === 'market_reset') {
      calls.previews++;
      if (handlers.get) return handlers.get(route);
      return route.fulfill({ json: { preview: preview() } });
    }
    if (request.method() === 'POST' && request.postDataJSON()?.action === 'market_reset') {
      calls.resets.push(request.postDataJSON());
      if (handlers.post) return handlers.post(route);
      return route.fulfill({ json: {
        status: 'completed', operationId: 'isolated-reset-operation',
        deleted: { Listing: 5, Conversation: 3, Commission: 2 },
        preservedUsers: 9, pendingStorageJobs: 4,
      } });
    }
    return route.fallback();
  });
  await page.goto('/admin/maintenance');
  const panel = page.locator('[data-market-reset]');
  await expect(panel.locator('summary')).toBeVisible();
  return { calls, panel };
}

async function authorize(panel: Locator) {
  await panel.locator('input[name="marketResetReason"]').fill(reason);
  await panel.locator('input[name="marketResetConfirmation"]').fill(phrase);
  await panel.locator('input[name="marketResetBackup"]').check();
  await panel.locator('input[name="marketResetProtectedData"]').check();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

test('owner reset requires an explicit preview and every confirmation before one bounded request', async ({ page, baseURL }, info) => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const { calls, panel } = await setup(page, baseURL!, {
    post: async route => {
      await held;
      await route.fulfill({ json: {
        status: 'completed', operationId: 'isolated-reset-operation',
        deleted: { Listing: 5, Conversation: 3, Commission: 2 }, preservedUsers: 9, pendingStorageJobs: 4,
      } });
    },
  });
  try {
    await expect(panel).not.toHaveAttribute('open', '');
    expect(calls.previews).toBe(0);
    expect(calls.resets).toEqual([]);
    await panel.locator('summary').click();
    const load = panel.getByRole('button', { name: 'معاينة إعادة ضبط السوق', exact: true });
    await expect(load).toBeVisible();
    expect(calls.previews).toBe(0);
    await load.click();
    await expect(panel.getByRole('status')).toContainText('حساب مستخدم');
    const execute = panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true });
    await expect(execute).toBeDisabled();
    await panel.locator('input[name="marketResetReason"]').fill(`  ${reason}  `);
    await panel.locator('input[name="marketResetConfirmation"]').fill(phrase);
    await expect(execute).toBeDisabled();
    await panel.locator('input[name="marketResetBackup"]').check();
    await expect(execute).toBeDisabled();
    await panel.locator('input[name="marketResetProtectedData"]').check();
    await expect(execute).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('owner-reset-confirmation.png'), fullPage: true });
    await execute.click();
    await expect.poll(() => calls.resets.length).toBe(1);
    await expect(load).toBeDisabled();
    await expect(panel.getByRole('status')).toContainText('جارٍ تنفيذ إعادة الضبط');
    expect(calls.resets[0]).toEqual({
      action: 'market_reset', previewToken: 'isolated-market-reset-preview', reason,
      confirmation: phrase, backupConfirmed: true, includeProtectedData: true,
    });
    release();
    await expect(panel.getByRole('status')).toContainText('اكتملت إعادة ضبط السوق');
    await expect(panel.getByRole('status')).toContainText('حذف بيانات السوق لا يعني اكتمال حذف الملفات بعد');
    await expect(panel.getByRole('status')).toContainText('isolated-reset-operation');
    await expect(panel.locator('input')).toHaveCount(0);
    await expect(load).toBeEnabled();
    expect(calls.previews).toBe(1);
    expect(calls.resets).toHaveLength(1);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('owner-reset-completed.png'), fullPage: true });
  } finally { release(); }
});

test('expired and stale previews cannot be reused or retain destructive acknowledgements', async ({ page, baseURL }, info) => {
  let expired = true;
  const { calls, panel } = await setup(page, baseURL!, {
    get: route => route.fulfill({ json: { preview: preview(expired
      ? new Date(Date.now() - 1000).toISOString()
      : new Date(Date.now() + 600_000).toISOString()) } }),
    post: route => route.fulfill({ status: 409, json: { error: 'preview_stale' } }),
  });
  await panel.locator('summary').click();
  const load = panel.getByRole('button', { name: 'معاينة إعادة ضبط السوق', exact: true });
  await load.click();
  await expect(panel.getByRole('alert')).toContainText('انتهت المعاينة');
  await authorize(panel);
  await expect(panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true })).toBeDisabled();
  expect(calls.resets).toHaveLength(0);
  expired = false;
  await load.click();
  await expect(panel.locator('input[name="marketResetReason"]')).toHaveValue('');
  await expect(panel.locator('input[name="marketResetBackup"]')).not.toBeChecked();
  await expect(panel.locator('input[name="marketResetProtectedData"]')).not.toBeChecked();
  await authorize(panel);
  await panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('تغيّرت البيانات أو انتهت المعاينة');
  await expect(panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true })).toHaveCount(0);
  expect(calls.resets).toHaveLength(1);
  await load.click();
  await expect(panel.locator('input[name="marketResetConfirmation"]')).toHaveValue('');
  await expect(panel.locator('input[name="marketResetBackup"]')).not.toBeChecked();
  await expect(panel.locator('input[name="marketResetProtectedData"]')).not.toBeChecked();
  expect(calls.previews).toBe(3);
  expect(calls.resets).toHaveLength(1);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('owner-reset-fresh-confirmation.png'), fullPage: true });
});

test('lost execution response remains uncertain and never retries the destructive request', async ({ page, baseURL }, info) => {
  await page.clock.install();
  const { calls, panel } = await setup(page, baseURL!, { post: route => route.abort('connectionreset') });
  await panel.locator('summary').click();
  const load = panel.getByRole('button', { name: 'معاينة إعادة ضبط السوق', exact: true });
  await load.click();
  await authorize(panel);
  await panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('تعذّر تأكيد نتيجة إعادة الضبط');
  await expect(panel.getByRole('alert')).toContainText('قد يكون الحذف قد اكتمل');
  await expect(panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true })).toHaveCount(0);
  await page.clock.fastForward(60_000);
  expect(calls.resets).toHaveLength(1);
  await expect(panel.getByRole('status')).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('owner-reset-uncertain.png'), fullPage: true });
  await load.click();
  await expect(panel.locator('input[name="marketResetReason"]')).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true })).toBeDisabled();
  expect(calls.previews).toBe(2);
  expect(calls.resets).toHaveLength(1);
});

test('losing owner access discards a pending preview and cannot restore its form after access returns', async ({ page, baseURL }, info) => {
  let release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const { calls, panel } = await setup(page, baseURL!, {
    get: async route => {
      await held;
      // An aborted browser request may already be closed when the fixture is released.
      await route.fulfill({ json: { preview: preview() } }).catch(() => {});
    },
  });
  try {
    await panel.locator('summary').click();
    await panel.getByRole('button', { name: 'معاينة إعادة ضبط السوق', exact: true }).click();
    await expect.poll(() => calls.previews).toBe(1);
    await expect(panel.getByRole('status')).toContainText('جارٍ حساب أثر إعادة الضبط');
    await page.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: true,
      user: { id: 'presentation-admin', email: 'presentation-admin@example.test', role: 'admin' },
    } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.admin-workspace')).toBeVisible();
    await expect(panel).toHaveCount(0);
    release();
    await page.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: true,
      user: { id: 'presentation-admin', email: ownerFixtureEmail, role: 'owner' },
    } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(panel.locator('summary')).toBeVisible();
    await expect(panel).not.toHaveAttribute('open', '');
    await panel.locator('summary').click();
    await expect(panel.locator('input')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'حذف بيانات السوق نهائيًا', exact: true })).toHaveCount(0);
    expect(calls.previews).toBe(1);
    expect(calls.resets).toHaveLength(0);
    await noOverflow(page);
    await page.screenshot({ path: info.outputPath('owner-reset-access-restored.png'), fullPage: true });
  } finally { release(); }
});
