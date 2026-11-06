import { expect, test } from '@playwright/test';
import { prepare } from './helpers/admin-presentation-fixture';

test('maintenance admin page is retired and legacy API cannot execute operations', async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await prepare(page, baseURL!, 'owner');

  const pageResponse = await page.goto('/admin/maintenance');
  expect(pageResponse?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: /404|غير موجودة/ })).toBeVisible();

  const getResponse = await page.request.get('/api/admin/maintenance');
  expect(getResponse.status()).toBe(410);
  expect((await getResponse.json()).error).toBe('maintenance_retired');

  const postResponse = await page.request.post('/api/admin/maintenance', {
    data: {
      action: 'market_reset',
      scope: 'purge_deleted_listings',
      confirmation: 'حذف بيانات السوق والإبقاء على المستخدمين',
      reason: 'retired endpoint check',
    },
  });
  expect(postResponse.status()).toBe(410);
  expect((await postResponse.json()).error).toBe('maintenance_retired');
});
