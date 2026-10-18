import { expect, test } from '@playwright/test';
import { marketplaceCategoryDefinitions, marketplaceCategoryGroups } from '@/lib/marketplace/categories';

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
  await expect(form.getByText('تعذر اقتراح التصنيف. يمكنك اختياره يدويًا.')).toBeVisible();
  await expect(select).toHaveValue('other');
  unavailable = false;
  await title.fill('Toyota Camry');
  await expect(form.getByText('التصنيف غير واضح. اختره يدويًا.')).toBeVisible();
  await expect(select).toHaveValue('other');
  await select.selectOption('cars');
  await expect(select).toHaveValue('cars');
});
