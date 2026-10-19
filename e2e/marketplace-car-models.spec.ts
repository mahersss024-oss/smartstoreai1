import { expect, test } from '@playwright/test';
import { getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute as brandAttr } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModels, marketplaceCarModelAttribute as modelAttr } from '@/lib/marketplace/car-models';
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

test('each car brand exposes its shared models without years or trims in manual creation', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  await form.locator('select').first().selectOption('cars');
  const brand = form.locator('#manual-listing-category-option');
  const model = form.locator('#manual-listing-car-model');
  await expect(model).toHaveCount(0);
  for (const option of getMarketplaceCategoryOptions('cars')) {
    await brand.selectOption(option.id);
    const choices = getMarketplaceCarModels(option.id);
    if (!choices.length) { await expect(model).toHaveCount(0); continue; }
    await expect(model).toHaveValue('');
    expect(await model.locator('option').evaluateAll(items => items.slice(1).map(item => ({ id: (item as HTMLOptionElement).value, label: item.textContent })))).toEqual(choices);
    await model.selectOption(choices[0].id);
    await expect(model).toHaveValue(choices[0].id);
  }
  await brand.selectOption('toyota');
  await model.selectOption('camry');
  await model.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('manual-car-model.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await form.locator('select').first().selectOption('mobile_phones');
  await expect(model).toHaveCount(0);
});

test('title and description suggestions include a valid car model and preserve customer correction when saving', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  let calls = 0;
  await page.route('**/api/marketplace/listing-category', route => {
    calls++;
    return route.fulfill({ json: { category: 'cars', categoryOption: 'toyota', carModel: 'camry', status: 'suggested' } });
  });
  await page.route('**/api/marketplace/listings**', route => {
    if (route.request().method() === 'POST') {
      payload = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { listing: { ...listing, ...payload } } });
    }
    return route.fulfill({ json: { listings: [], pagination: { page: 1, hasMore: false } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  await form.locator('input[maxlength="140"]').fill('تويوتا للبيع');
  await form.locator('textarea').fill('كامري نظيفة، اللون أبيض');
  const model = form.locator('#manual-listing-car-model');
  await expect(model).toHaveValue('camry');
  await model.selectOption('corolla');
  const previousCalls = calls;
  await form.locator('textarea').fill('كورولا نظيفة، اللون أبيض');
  await page.waitForTimeout(1100);
  await expect(model).toHaveValue('corolla');
  expect(calls).toBe(previousCalls);
  await form.getByRole('button', { name: 'اختر المدينة', exact: true }).click();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  await form.getByLabel('السعر', { exact: true }).fill('20000');
  await form.getByRole('button', { name: 'حفظ الإعلان', exact: true }).click();
  await expect.poll(() => (payload?.attributes as Record<string, unknown>)?.[modelAttr]).toBe('corolla');
  expect((payload?.attributes as Record<string, unknown>)[brandAttr]).toBe('toyota');
  expect(payload?.condition).toBeUndefined();
});

test('car filtering reaches the database API, survives navigation and clears on a brand change', async ({ page }, info) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/marketplace/listings**', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const listings = [
      { ...listing, id: 'car-camry', status: 'published', image: '/hamad-market-logo.webp' },
      { ...listing, id: 'car-corolla', title: 'تويوتا كورولا', status: 'published', image: '/hamad-market-logo.webp', attributes: { [brandAttr]: 'toyota', [modelAttr]: 'corolla' } },
    ].filter(item => !params.get('carModel') || item.attributes[modelAttr] === params.get('carModel'));
    return route.fulfill({ json: { listings, pagination: { page: 1, hasMore: false } } });
  });
  await page.goto('/');
  const categories = page.locator('[data-marketplace-categories]');
  await categories.getByRole('button', { name: 'سيارات ومركبات', exact: true }).click();
  await categories.getByRole('button', { name: 'السيارات', exact: true }).click();
  await page.locator('#marketplace-category-option').selectOption('toyota');
  const model = page.locator('#marketplace-car-model');
  await model.selectOption('camry');
  await expect(model).toBeInViewport();
  await expect.poll(() => requests.at(-1)?.get('carModel')).toBe('camry');
  expect(requests.at(-1)?.get('categoryOption')).toBe('toyota');
  const cards = page.locator('.marketplace-listings-content .marketplace-listing-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('كامري');
  await page.screenshot({ path: info.outputPath('car-filtered-market.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accountLink = page.locator('a[href="/account"]:visible').first();
  if (await accountLink.count()) await accountLink.click();
  else await page.getByRole('button', { name: 'حسابي', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goBack();
  await expect(model).toHaveValue('camry');
  await expect(cards).toHaveCount(1);
  await page.locator('#marketplace-category-option').selectOption('nissan');
  await expect(model).toHaveValue('');
  await expect(model.locator('option[value="camry"]')).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.get('categoryOption')).toBe('nissan');
  expect(requests.at(-1)?.has('carModel')).toBe(false);
});

test('seller editing retains the car model and clears it before selecting another brand', async ({ page }, info) => {
  let patch: Record<string, unknown> | undefined;
  await page.route('**/api/marketplace/me/listings**', route => route.fulfill({ json: { listings: [listing], pagination: { page: 1, hasMore: false } } }));
  await page.route('**/api/marketplace/listings/car-model-edit', route => {
    patch = route.request().postDataJSON();
    return route.fulfill({ json: { listing: { ...listing, ...patch, attributes: { ...listing.attributes, ...patch?.attributes as object } } } });
  });
  await page.goto('/account/listings');
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const brand = page.locator('#listing-car-model-edit-category-option');
  const model = page.locator('#listing-car-model-edit-car-model');
  await expect(model).toHaveValue('camry');
  await brand.selectOption('nissan');
  await expect(model).toHaveValue('');
  await model.selectOption('patrol');
  await model.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('seller-car-model.png') });
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => (patch?.attributes as Record<string, unknown>)?.[modelAttr]).toBe('patrol');
  expect((patch?.attributes as Record<string, unknown>)[brandAttr]).toBe('nissan');
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  await expect(model).toHaveValue('patrol');
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
