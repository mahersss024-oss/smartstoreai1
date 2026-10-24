import { expect, test } from '@playwright/test';
import { marketplaceCategoryOptionAttribute as brandAttr } from '@/lib/marketplace/category-options';
import { marketplaceCarModelAttribute as modelAttr } from '@/lib/marketplace/car-models';
import { createSessionCookie } from '@/lib/auth/session';

const user = { id: 'car-model-user', email: 'car-models@example.test', name: 'عميل تجريبي' };
const listing = { id: 'car-model-edit', sellerId: user.id, category: 'cars', title: 'تويوتا كامري',
  description: 'تفاصيل السيارة من العميل', city: 'الرياض', price: 20000, priceMode: null, condition: null,
  status: 'draft', images: [], attributes: { [brandAttr]: 'toyota', [modelAttr]: 'camry', brand: 'تويوتا', model: 'كامري' },
  views: 0, messageCount: 0, favoriteCount: 0 };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, user } }));
});

test('administration uses the same car choices for filtering and audited editing', async ({ page, baseURL }, info) => {
  const admin = { id: 'car-model-admin', email: 'car-model-admin@example.test', role: 'admin' };
  const [name, value] = createSessionCookie(admin).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true, user: admin } }));
  await page.route('**/api/admin/moderation?**', route => route.fulfill({ json: { notifications: [], pagination: { page: 1, hasMore: false } } }));
  const requests: URLSearchParams[] = [];
  await page.route('**/api/admin/listings?**', route => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { listings: [listing], pagination: { page: 1, hasMore: false, total: 1 } } });
  });
  let patch: Record<string, unknown> | undefined;
  await page.route('**/api/admin/listings/car-model-edit', route => {
    patch = route.request().postDataJSON();
    return route.fulfill({ json: { listing: { ...listing, ...patch } } });
  });
  await page.goto('/admin/listings');
  await page.locator('select[name="listingCategoryFilter"]').selectOption('cars');
  await page.locator('#admin-listing-category-option-filter').selectOption('toyota');
  await page.locator('#admin-listing-car-model-filter').selectOption('camry');
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.get('carModel')).toBe('camry');
  expect(requests.at(-1)?.get('categoryOption')).toBe('toyota');
  await page.getByRole('button', { name: 'فتح تويوتا كامري', exact: true }).click();
  const model = page.locator('#listing-car-model-edit-car-model');
  await expect(model).toHaveValue('camry');
  await model.selectOption('corolla');
  await model.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('admin-car-model.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => patch?.carModel).toBe('corolla');
  expect(patch?.categoryOption).toBe('toyota');
});
