import { expect, test } from '@playwright/test';
import { marketplaceCategoryDefinitions, marketplaceCategoryGroups } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModels, marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: true,
    user: { id: 'filter-row-user', email: 'filter-row@example.test' } } }));
});

test('filter rows show All only at the root and leave compact branches unselected until clicked', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: { listings: [], pagination: { page: 1, hasMore: false } } }));
  await page.goto('/');
  const categories = page.locator('[data-marketplace-categories]');
  const groups = categories.locator('[data-marketplace-filter-row="groups"]');
  expect(await groups.getByRole('button').allTextContents()).toEqual(['الكل', ...marketplaceCategoryGroups.map(group => group.label)]);
  const primaryHeight = (await groups.boundingBox())!.height;
  expect(primaryHeight).toBe(32);
  for (const group of marketplaceCategoryGroups) {
    await groups.getByRole('button', { name: group.label, exact: true }).click();
    const row = categories.locator('[data-marketplace-filter-row="categories"]');
    expect(await row.getByRole('button').allTextContents()).toEqual(group.categories);
    await expect(row.locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(categories.locator('[data-marketplace-filter-row="options"], [data-marketplace-filter-row="models"]')).toHaveCount(0);
    expect((await row.boundingBox())!.height).toBeLessThan(primaryHeight);
    for (const label of group.categories) {
      await row.getByRole('button', { name: label, exact: true }).click();
      const category = marketplaceCategoryDefinitions.find(category => category.label === label)!;
      const choices = getMarketplaceCategoryOptions(category.id);
      const options = categories.locator('[data-marketplace-filter-row="options"]');
      if (!choices.length) { await expect(options).toHaveCount(0); continue; }
      expect(await options.getByRole('button').allTextContents()).toEqual(choices.map(option => option.label));
      await expect(options.locator('[aria-pressed="true"]')).toHaveCount(0);
      expect((await options.boundingBox())!.height).toBe(28);
    }
  }
  await groups.getByRole('button', { name: 'الكل', exact: true }).click();
  await groups.getByRole('button', { name: 'سيارات ومركبات', exact: true }).click();
  await categories.locator('[data-marketplace-filter-row="categories"]').getByRole('button', { name: 'السيارات', exact: true }).click();
  await categories.locator('[data-marketplace-filter-row="options"]').getByRole('button', { name: 'تويوتا', exact: true }).click();
  const models = categories.locator('[data-marketplace-filter-row="models"]');
  expect(await models.getByRole('button').allTextContents()).toEqual(getMarketplaceCarModels('toyota').map(model => model.label));
  await expect(models.locator('[aria-pressed="true"]')).toHaveCount(0);
  await models.getByRole('button', { name: 'كامري', exact: true }).click();
  const rows = await categories.locator('[data-marketplace-filter-row]').evaluateAll(elements => elements.map(element => {
    const row = element.getBoundingClientRect();
    const first = element.querySelector('button')!.getBoundingClientRect();
    return { height: row.height, firstRight: first.right, rowRight: row.right,
      fits: [...element.querySelectorAll('button')].every(button => button.scrollWidth <= button.clientWidth + 1) };
  }));
  expect(rows.map(row => row.height)).toEqual([32, 28, 28, 28]);
  expect(rows.every(row => row.fits)).toBe(true);
  expect(rows.every(row => Math.abs(row.firstRight - row.rowRight) <= 1)).toBe(true);
  await expect(categories.getByRole('button', { name: 'الكل', exact: true })).toHaveCount(1);
  await expect(categories.locator('select, label')).toHaveCount(0);
  for (const label of ['البراند', 'السيارة', 'النوع']) await expect(categories.getByText(label, { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('compact-car-filter-rows.png') });
});

test('branch filters reach the API only after explicit clicks and parent changes clear descendants', async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/marketplace/listings**', route => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { listings: [], pagination: { page: 1, hasMore: false } } });
  });
  await page.goto('/');
  await page.getByPlaceholder('ابحث في كل السوق', { exact: true }).fill('سيارة');
  await page.locator('.marketplace-tools-region').getByRole('button').click();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  const row = (level: string) => page.locator(`[data-marketplace-filter-row="${level}"]`);
  const choose = (level: string, name: string) => row(level).getByRole('button', { name, exact: true }).click();
  await choose('groups', 'سيارات ومركبات');
  await expect.poll(() => requests.at(-1)?.has('categories')).toBe(true);
  expect(requests.at(-1)?.has('category')).toBe(false);
  expect(requests.at(-1)?.has('categoryOption')).toBe(false);
  expect(requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('categories').locator('[aria-pressed="true"]')).toHaveCount(0);
  await choose('categories', 'السيارات');
  await expect.poll(() => requests.at(-1)?.get('category')).toBe('cars');
  expect(requests.at(-1)?.has('categoryOption')).toBe(false);
  expect(requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('options').locator('[aria-pressed="true"]')).toHaveCount(0);
  await expect(row('models')).toHaveCount(0);
  await choose('options', 'تويوتا');
  await expect.poll(() => requests.at(-1)?.get('categoryOption')).toBe('toyota');
  expect(requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('models').locator('[aria-pressed="true"]')).toHaveCount(0);
  await choose('models', 'كامري');
  await expect.poll(() => requests.at(-1)?.get('carModel')).toBe('camry');
  await expect.poll(() => requests.at(-1)?.get('q')).toBe('سيارة');
  await expect.poll(() => requests.at(-1)?.get('city')).toBe('الرياض');
  const unchanged = () => {
    expect(requests.at(-1)?.get('q')).toBe('سيارة');
    expect(requests.at(-1)?.get('city')).toBe('الرياض');
  };
  await choose('options', 'نيسان');
  await expect.poll(() => requests.at(-1)?.get('categoryOption')).toBe('nissan');
  await expect.poll(() => requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('models').locator('[aria-pressed="true"]')).toHaveCount(0);
  expect(requests.at(-1)?.get('category')).toBe('cars');
  unchanged();
  await choose('models', 'باترول');
  await expect.poll(() => requests.at(-1)?.get('carModel')).toBe('patrol');
  await choose('categories', 'السيارات');
  await expect(row('models')).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.has('categoryOption')).toBe(false);
  expect(requests.at(-1)?.get('category')).toBe('cars');
  expect(requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('options').locator('[aria-pressed="true"]')).toHaveCount(0);
  unchanged();
  await choose('groups', 'العقار');
  await expect.poll(() => requests.at(-1)?.has('categories')).toBe(true);
  expect(requests.at(-1)?.has('category')).toBe(false);
  expect(requests.at(-1)?.has('categoryOption')).toBe(false);
  expect(requests.at(-1)?.has('carModel')).toBe(false);
  await expect(row('options')).toHaveCount(0);
  await expect(row('categories').locator('[aria-pressed="true"]')).toHaveCount(0);
  unchanged();
  await choose('groups', 'الكل');
  await expect(page.locator('[data-marketplace-filter-row]')).toHaveCount(1);
  await expect.poll(() => requests.at(-1)?.has('categories')).toBe(false);
  unchanged();
});

test('the existing general filter clears explicit category choices without clearing the text query', async ({ page }) => {
  const requests: URLSearchParams[] = [];
  await page.route('**/api/marketplace/listings**', route => {
    requests.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { listings: [], pagination: { page: 1, hasMore: false } } });
  });
  await page.goto('/');
  await page.getByPlaceholder('ابحث في كل السوق', { exact: true }).fill('سيارة');
  await page.locator('.marketplace-tools-region').getByRole('button').click();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  const choose = (level: string, name: string) => page.locator(`[data-marketplace-filter-row="${level}"]`).getByRole('button', { name, exact: true }).click();
  await choose('groups', 'سيارات ومركبات');
  await choose('categories', 'السيارات');
  await choose('options', 'تويوتا');
  await choose('models', 'كامري');
  await expect.poll(() => requests.at(-1)?.get('carModel')).toBe('camry');
  await page.getByRole('button', { name: /^تصفية البحث/ }).click();
  await page.getByRole('button', { name: 'مسح الفلاتر', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.has('category')).toBe(false);
  for (const key of ['categories', 'categoryOption', 'carModel', 'city']) expect(requests.at(-1)?.has(key)).toBe(false);
  expect(requests.at(-1)?.get('q')).toBe('سيارة');
  await expect(page.locator('[data-marketplace-filter-row]')).toHaveCount(1);
  await expect(page.locator('[data-marketplace-filter-row="groups"]').getByRole('button', { name: 'الكل', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'مسح الفلاتر', exact: true })).toHaveCount(0);
});

test('off-screen selected category chips restore visibly without scrolling the page or changing the feed position', async ({ page }, info) => {
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
    listings: [{ id: 'filter-row-car', sellerId: 'filter-row-seller', category: 'cars', title: 'فيات دوكاتو للبيع', city: 'الرياض', price: 100,
      status: 'published', image: '/hamad-market-logo.webp', attributes: { [marketplaceCategoryOptionAttribute]: 'fiat', [marketplaceCarModelAttribute]: 'ducato' } }],
    pagination: { page: 1, hasMore: false },
  } }));
  await page.goto('/');
  const row = (level: string) => page.locator(`[data-marketplace-filter-row="${level}"]`);
  await row('groups').getByRole('button', { name: 'سيارات ومركبات', exact: true }).click();
  await row('categories').getByRole('button', { name: 'السيارات', exact: true }).click();
  await row('options').getByRole('button', { name: 'فيات', exact: true }).click();
  await row('models').getByRole('button', { name: 'دوكاتو', exact: true }).click();
  const card = page.locator('.marketplace-listing-card').first();
  await expect(card).toBeVisible();
  await page.locator('.marketplace-listings-content').evaluate(element => Promise.all(element.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const before = await card.boundingBox();
  const account = page.locator('a[href="/account"]:visible').first();
  if (await account.count()) await account.click();
  else await page.getByRole('button', { name: 'حسابي', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goBack();
  await expect(row('options').getByRole('button', { name: 'فيات', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(row('options').getByRole('button', { name: 'فيات', exact: true })).toBeInViewport();
  await expect(row('models').getByRole('button', { name: 'دوكاتو', exact: true })).toBeInViewport();
  await expect.poll(async () => (await card.boundingBox())?.y).toBeCloseTo(before!.y, 0);
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop)).toBe(0);
  await page.screenshot({ path: info.outputPath('restored-filter-row-selection.png') });
});
