import { expect, test } from '@playwright/test';
import { marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';


import { createSessionCookie } from '@/lib/auth/session';


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'catalog-user', email: 'catalog@example.test', name: 'Catalog User' },
  } }));
});

test('administration filters and edits the same brands and property types on desktop and mobile', async ({ page, baseURL }, info) => {
  const user = { id: 'catalog-admin', email: 'catalog-admin@example.test', role: 'admin' };
  const [name, value] = createSessionCookie(user).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, user } }));
  await page.route('**/api/admin/moderation?**', route => route.fulfill({ json: { notifications: [], pagination: { page: 1, hasMore: false } } }));
  const requests: URLSearchParams[] = [];
  await page.route('**/api/admin/listings?**', route => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { listings: [{ id: 'admin-option-edit', sellerId: 'catalog-seller', category: 'real_estate', title: 'محل للتنازل',
      description: 'وصف المحل', city: 'الرياض', price: 100, priceMode: null, condition: null, status: 'draft', images: [],
      attributes: { [marketplaceCategoryOptionAttribute]: 'shops_transfer' }, views: 0, messageCount: 0, favoriteCount: 0 }],
      pagination: { page: 1, hasMore: false, total: 1 } } });
  });
  await page.goto('/admin/listings');
  await page.locator('select[name="listingCategoryFilter"]').selectOption('real_estate');
  await page.locator('#admin-listing-category-option-filter').selectOption('shops_transfer');
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.get('categoryOption')).toBe('shops_transfer');
  expect(requests.at(-1)?.get('category')).toBe('real_estate');
  await page.getByRole('button', { name: 'فتح محل للتنازل', exact: true }).click();
  const category = page.locator('select[name="listing-admin-option-edit-category"]');
  const select = page.locator('#listing-admin-option-edit-category-option');
  await expect(select).toHaveValue('shops_transfer');
  await category.selectOption('mobile_phones');
  await expect(select).toHaveValue('');
  await select.selectOption('apple');
  await expect(select).toHaveValue('apple');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('admin-category-options.png') });
});
