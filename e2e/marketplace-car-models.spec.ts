import { expect, test } from '@playwright/test';
import { marketplaceCategoryOptionAttribute as brandAttr, mergeMarketplaceCategoryAttributes } from '@/lib/marketplace/category-options';
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
  let storedListing: Omit<typeof listing, 'attributes'> & { attributes: Record<string, unknown> } = structuredClone(listing);
  const requests: URLSearchParams[] = [];
  await page.route('**/api/admin/listings?**', route => {
    const filters = new URL(route.request().url()).searchParams;
    requests.push(filters);
    const matches = (!filters.get('category') || filters.get('category') === storedListing.category) &&
      (!filters.get('categoryOption') || filters.get('categoryOption') === storedListing.attributes[brandAttr]) &&
      (!filters.get('carModel') || filters.get('carModel') === storedListing.attributes[modelAttr]);
    return route.fulfill({ json: { listings: matches ? [storedListing] : [], pagination: { page: 1, hasMore: false, total: matches ? 1 : 0 } } });
  });
  let patch: Record<string, unknown> | undefined;
  await page.route('**/api/admin/listings/car-model-edit', route => {
    patch = route.request().postDataJSON();
    // The real PATCH preserves omitted classification fields and stores the
    // model inside attributes; it does not return request-only top-level fields.
    storedListing = { ...storedListing, attributes: mergeMarketplaceCategoryAttributes(storedListing.category,
      {
        ...(patch?.categoryOption !== undefined ? { [brandAttr]: patch.categoryOption } : {}),
        ...(patch?.carModel !== undefined ? { [modelAttr]: patch.carModel } : {}),
      }, { category: storedListing.category, attributes: storedListing.attributes }) };
    return route.fulfill({ json: { listing: storedListing } });
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
  expect(patch).toEqual({ carModel: 'corolla' });
  expect(storedListing).toMatchObject({ category: 'cars', attributes: { [brandAttr]: 'toyota', [modelAttr]: 'corolla' } });
  await expect(page.getByText('تم تحديث بيانات الإعلان في لوحة الإدارة.', { exact: true })).toBeVisible();
  // Read the saved record afresh without the old Camry search filter.
  await page.goto('/admin/listings');
  await page.getByRole('button', { name: 'فتح تويوتا كامري', exact: true }).click();
  await expect(page.locator('#listing-car-model-edit-category-option')).toHaveValue('toyota');
  await expect(page.locator('#listing-car-model-edit-car-model')).toHaveValue('corolla');
});
