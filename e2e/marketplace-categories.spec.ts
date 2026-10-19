import { expect, test } from '@playwright/test';
import { marketplaceCategoryDefinitions, marketplaceCategoryGroups } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';
import { createSessionCookie } from '@/lib/auth/session';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'catalog-user', email: 'catalog@example.test', name: 'Catalog User' },
  } }));
});

test('every shared group and category filters the existing marketplace cards', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
    listings: marketplaceCategoryDefinitions.map(category => ({
      id: `catalog-${category.id}`, sellerId: 'catalog-seller', category: category.id,
      title: `Catalog ${category.id}`, price: 100, city: 'الرياض', status: 'published',
      image: '/hamad-market-logo.webp', imageUrls: ['/hamad-market-logo.webp'],
      createdAt: '2026-10-13T08:00:00.000Z',
    })), pagination: { page: 1, limit: 48, hasMore: false, nextPage: null },
  } }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  const categories = page.locator('[data-marketplace-categories]');
  const cards = page.locator('.marketplace-listings-content .marketplace-listing-card');
  await expect(cards).toHaveCount(marketplaceCategoryDefinitions.length);
  for (const group of marketplaceCategoryGroups) {
    await categories.locator(':scope > div').first().getByRole('button', { name: group.label, exact: true }).click();
    await expect(cards).toHaveCount(group.categories.length);
    for (const label of group.categories) {
      const category = marketplaceCategoryDefinitions.find(category => category.label === label)!;
      await categories.locator(':scope > div').nth(1).getByRole('button', { name: label, exact: true }).click();
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText(`Catalog ${category.id}`);
      await expect(cards.first()).toContainText(label);
    }
  }
  await categories.locator(':scope > div').first().getByRole('button', { name: 'الكل', exact: true }).click();
  await expect(cards).toHaveCount(marketplaceCategoryDefinitions.length);
  await page.screenshot({ path: info.outputPath('shared-categories.png') });
});

test('manual creation and account editing expose identical category IDs and labels', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const select = page.locator('.marketplace-home-controls form select').first();
  const expected = marketplaceCategoryDefinitions.map(category => ({ value: category.id, label: category.label }));
  const creationOptions = await select.locator('option').evaluateAll(options => options.map(option => ({
    value: (option as HTMLOptionElement).value, label: option.textContent?.trim(),
  })));
  expect(creationOptions).toEqual(expected);
  await select.selectOption('cameras');
  await page.locator('.marketplace-home-controls form input[maxlength="140"]').fill('iPhone 15');
  await page.locator('.marketplace-home-controls form textarea').focus();
  await expect(select).toHaveValue('cameras');
  await page.screenshot({ path: info.outputPath('manual-categories.png') });
  await page.route('**/api/marketplace/me/listings**', route => route.fulfill({ json: {
    listings: [{ id: 'catalog-edit', sellerId: 'catalog-user', category: 'computers', title: 'Catalog computer',
      price: 100, status: 'draft', city: 'الرياض', images: [], createdAt: '2026-10-13T08:00:00.000Z' }],
    pagination: { page: 1, limit: 24, hasMore: false, nextPage: null },
  } }));
  await page.goto('/account/listings');
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const editing = page.locator('select[name="listing-catalog-edit-category"]');
  expect(await editing.locator('option').evaluateAll(options => options.map(option => ({
    value: (option as HTMLOptionElement).value, label: option.textContent?.trim(),
  })))).toEqual(expected);
  await expect(editing).toHaveValue('computers');
  await editing.selectOption('home_appliances');
  await expect(editing).toHaveValue('home_appliances');
  await page.screenshot({ path: info.outputPath('account-categories.png') });
});

test('manual title uses model suggestions while typing and preserves explicit category selection', async ({ page }) => {
  await page.route('**/api/marketplace/listing-category', route => {
    const { title } = route.request().postDataJSON();
    const fixtures: Record<string, string> = {
      'وايت سكس للبيع': 'heavy_equipment', 'تريله للبيع': 'heavy_equipment', 'سطحه للبيع': 'heavy_equipment',
      'قطع غيار تريله': 'auto_parts', 'كنبة للبيع': 'furniture',
    };
    return route.fulfill({ json: { category: fixtures[title] ?? null, status: fixtures[title] ? 'suggested' : 'uncertain' } });
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  const title = form.locator('input[maxlength="140"]');
  const select = form.locator('select').first();
  for (const value of ['وايت سكس للبيع', 'تريله للبيع', 'سطحه للبيع']) {
    await title.fill(value);
    await expect(select).toHaveValue('heavy_equipment');
    await expect(title).toBeFocused();
    await expect(form.getByText('أدخل التصنيف', { exact: true })).toHaveCount(0);
  }
  await title.fill('قطع غيار تريله');
  await expect(select).toHaveValue('auto_parts');
  await title.fill('كنبة للبيع');
  await expect(select).toHaveValue('furniture');
  await select.selectOption('cameras');
  await title.fill('وايت سكس للبيع');
  await page.waitForTimeout(1200);
  await expect(select).toHaveValue('cameras');
  await form.locator('textarea').focus();
  await expect(select).toHaveValue('cameras');
});

test('model suggestions debounce input and discard stale responses without overriding manual choice', async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/marketplace/listing-category', async route => {
    calls++;
    const { title } = route.request().postDataJSON();
    if (title === 'طلب قديم') await delayed;
    await route.fulfill({ json: { category: title === 'طلب قديم' ? 'cars' : 'networking', status: 'suggested' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  const title = form.locator('input[maxlength="140"]');
  const select = form.locator('select').first();
  try {
    await title.pressSequentially('طلب قديم', { delay: 30 });
    expect(calls).toBe(0);
    await expect.poll(() => calls).toBe(1);
    await expect(form.getByText('جار اقتراح التصنيف...')).toHaveCount(0);
    await expect(form.getByText('أدخل التصنيف', { exact: true })).toHaveCount(0);
    await title.fill('طلب جديد');
    await expect(select).toHaveValue('networking');
    release();
    await page.waitForTimeout(300);
    await expect(select).toHaveValue('networking');
    await select.selectOption('cameras');
    await title.fill('طلب آخر');
    await page.waitForTimeout(1200);
    await expect(select).toHaveValue('cameras');
    expect(calls).toBe(2);
  } finally { release(); }
});

test('unavailable or uncertain model suggestions leave manual classification available without keyword fallback', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/marketplace/listing-category', route => route.fulfill({
    status: unavailable ? 503 : 200,
    json: { category: null, status: unavailable ? 'unavailable' : 'uncertain' },
  }));
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  const title = form.locator('input[maxlength="140"]');
  const select = form.locator('select').first();
  await title.fill('iPhone');
  await expect(form.getByText('أدخل التصنيف', { exact: true })).toBeVisible();
  await expect(form.getByText('تعذر اقتراح التصنيف. يمكنك اختياره يدويًا.')).toHaveCount(0);
  await expect(select).toHaveValue('other');
  unavailable = false;
  const uncertainResponse = page.waitForResponse(response =>
    response.url().includes('/api/marketplace/listing-category') &&
    response.request().postDataJSON()?.title === 'Toyota Camry',
  );
  await title.fill('Toyota Camry');
  await uncertainResponse;
  await expect(form.getByText('أدخل التصنيف', { exact: true })).toBeVisible();
  await expect(form.getByText('التصنيف غير واضح. اختره يدويًا.')).toHaveCount(0);
  await expect(select).toHaveValue('other');
  await select.selectOption('cars');
  await expect(select).toHaveValue('cars');
  await expect(form.getByText('أدخل التصنيف', { exact: true })).toHaveCount(0);
});

test('manual creation uses one flat brand or type list for every category without clothing brands', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  const category = form.locator('select').first();
  for (const definition of marketplaceCategoryDefinitions) {
    await category.selectOption(definition.id);
    const select = form.locator('#manual-listing-category-option');
    const choices = getMarketplaceCategoryOptions(definition.id);
    if (!choices.length) { await expect(select).toHaveCount(0); continue; }
    expect(await select.locator('option').evaluateAll(items => items.slice(1).map(item => ({ id: (item as HTMLOptionElement).value, label: item.textContent })))).toEqual(choices);
    await select.selectOption(choices[0].id);
    await expect(select).toHaveValue(choices[0].id);
    expect(await form.locator('[id$="category-option"]').count()).toBe(1);
  }
  await category.selectOption('fashion');
  await expect(form.locator('#manual-listing-category-option')).toHaveAttribute('aria-label', 'النوع');
  await expect(form.locator('#manual-listing-category-option')).toHaveValue('');
  await expect(form.getByRole('option', { name: 'محلات للتنازل', exact: true })).toHaveCount(0);
  await category.selectOption('real_estate');
  await form.locator('#manual-listing-category-option').selectOption('shops_transfer');
  await page.screenshot({ path: info.outputPath('property-type-catalog.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('brand filtering reaches the market API, survives navigation and clears when the category changes', async ({ page }, info) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/marketplace/listings**', route => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    const listings = [
      { id: 'brand-apple', category: 'mobile_phones', title: 'جوال آبل', attributes: { [marketplaceCategoryOptionAttribute]: 'apple' } },
      { id: 'brand-samsung', category: 'mobile_phones', title: 'جوال سامسونج', attributes: { [marketplaceCategoryOptionAttribute]: 'samsung' } },
    ].filter(listing => !params.get('categoryOption') || listing.attributes[marketplaceCategoryOptionAttribute] === params.get('categoryOption'));
    return route.fulfill({ json: { listings: listings.map(listing => ({ ...listing, sellerId: 'catalog-seller', city: 'الرياض', price: 100, image: '/hamad-market-logo.webp', status: 'published' })), pagination: { page: 1, hasMore: false } } });
  });
  await page.goto('/');
  const categories = page.locator('[data-marketplace-categories]');
  await categories.getByRole('button', { name: 'الأجهزة والإلكترونيات', exact: true }).click();
  await categories.getByRole('button', { name: 'الجوالات', exact: true }).click();
  const select = page.locator('#marketplace-category-option');
  await select.selectOption('apple');
  await expect(select).toBeInViewport();
  const bounds = await select.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(32);
  await expect.poll(() => requests.some(params => params.get('category') === 'mobile_phones' && params.get('categoryOption') === 'apple')).toBe(true);
  const cards = page.locator('.marketplace-listings-content .marketplace-listing-card');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('جوال آبل');
  await page.screenshot({ path: info.outputPath('brand-filtered-market.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const accountLink = page.locator('a[href="/account"]:visible').first();
  if (await accountLink.count()) await accountLink.click();
  else await page.getByRole('button', { name: 'حسابي', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goBack();
  await expect(select).toHaveValue('apple');
  await expect(cards).toHaveCount(1);
  await categories.getByRole('button', { name: 'الحواسيب وملحقاتها', exact: true }).click();
  await expect(select).toHaveValue('');
  await expect.poll(() => requests.at(-1)?.get('category')).toBe('computers');
  expect(requests.at(-1)?.has('categoryOption')).toBe(false);
});

test('seller editing preserves the saved choice and sends explicit changes using the shared catalog', async ({ page }, info) => {
  let patch: Record<string, unknown> | undefined;
  const listing = { id: 'option-edit', sellerId: 'catalog-user', category: 'mobile_phones', title: 'جوال آبل',
    description: 'جوال تجريبي', city: 'الرياض', price: 100, status: 'draft', images: [], attributes: { [marketplaceCategoryOptionAttribute]: 'apple', color: 'grey' } };
  await page.route('**/api/marketplace/me/listings**', route => route.fulfill({ json: { listings: [listing], pagination: { page: 1, hasMore: false } } }));
  await page.route('**/api/marketplace/listings/option-edit', route => {
    patch = route.request().postDataJSON();
    return route.fulfill({ json: { listing: { ...listing, ...patch, attributes: { ...listing.attributes, ...patch?.attributes as object } } } });
  });
  await page.goto('/account/listings');
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  const select = page.locator('#listing-option-edit-category-option');
  await expect(select).toHaveValue('apple');
  await select.selectOption('samsung');
  await page.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => (patch?.attributes as Record<string, unknown>)?.[marketplaceCategoryOptionAttribute]).toBe('samsung');
  await page.getByRole('button', { name: 'تعديل', exact: true }).click();
  await expect(select).toHaveValue('samsung');
  await page.locator('select[name="listing-option-edit-category"]').selectOption('cars');
  await expect(select).toHaveValue('');
  await expect(select.getByRole('option', { name: 'تويوتا', exact: true })).toHaveCount(1);
  await expect(select.getByRole('option', { name: 'آبل', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('seller-brand-edit.png') });
});

test('manual suggestions use title and description together and respect customer correction', async ({ page }) => {
  const requests: Array<{ title: string; description: string }> = [];
  await page.route('**/api/marketplace/listing-category', route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    return route.fulfill({ json: { category: input.description ? 'computers' : 'mobile_phones', categoryOption: 'apple', status: 'suggested' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  await form.locator('input[maxlength="140"]').fill('جهاز آبل للبيع');
  const select = form.locator('#manual-listing-category-option');
  await expect(select).toHaveValue('apple');
  await form.locator('textarea').fill('حاسب محمول ماك بوك مع الشاحن');
  await expect(form.locator('select').first()).toHaveValue('computers');
  await expect(select).toHaveValue('apple');
  expect(requests).toEqual([
    { title: 'جهاز آبل للبيع', description: '' },
    { title: 'جهاز آبل للبيع', description: 'حاسب محمول ماك بوك مع الشاحن' },
  ]);
  await select.selectOption('samsung');
  await form.locator('input[maxlength="140"]').fill('عنوان معدل');
  await form.locator('textarea').fill('وصف معدل بعد اختيار العميل');
  await page.waitForTimeout(1100);
  await expect(select).toHaveValue('samsung');
  expect(requests).toHaveLength(2);
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
