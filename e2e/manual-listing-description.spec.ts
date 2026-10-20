import { expect, test } from '@playwright/test';

for (const category of ['animals', 'mobile_phones']) {
  test(`manual ${category} creation uses the description and never sends a product condition`, async ({ page }, info) => {
    await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
    await page.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: true, user: { id: 'manual-description-user', email: 'manual-description@example.test' },
    } }));
    let payload: Record<string, unknown> | undefined;
    await page.route('**/api/marketplace/listings**', route => {
      if (route.request().method() === 'POST') {
        payload = route.request().postDataJSON();
        return route.fulfill({ status: 201, json: { listing: { ...payload, id: 'manual-description-draft', status: 'draft', images: [] } } });
      }
      return route.fulfill({ json: { listings: [], pagination: { page: 1, hasMore: false } } });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
    const form = page.locator('.marketplace-home-controls form');
    expect(await form.locator('input[maxlength="140"]').evaluate(input =>
      Boolean(input.closest('label')?.nextElementSibling?.querySelector('textarea')))).toBe(true);
    const titleBox = await form.locator('input[maxlength="140"]').boundingBox();
    const descriptionBox = await form.locator('textarea').boundingBox();
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    await form.locator('select').first().selectOption(category);
    await expect(form.getByText('حالة المنتج', { exact: true })).toHaveCount(0);
    for (const value of ['used', 'new', 'like_new', 'damaged']) {
      await expect(form.locator(`select option[value="${value}"]`)).toHaveCount(0);
    }
    const description = category === 'animals' ? 'أغنام بصحة جيدة، عمرها سنة.' : 'جوال جديد لم يستخدم، مع كامل الملحقات.';
    await form.locator('input[maxlength="140"]').fill(category === 'animals' ? 'أغنام للبيع' : 'جوال للبيع');
    await form.locator('textarea').fill(description);
    await form.getByRole('button', { name: 'اختر المدينة', exact: true }).click();
    await page.getByRole('option', { name: 'الرياض', exact: true }).click();
    await form.getByLabel('السعر', { exact: true }).fill('100');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await form.evaluate(element => { element.closest('.marketplace-home-controls')!.scrollTop = 0; });
    await page.screenshot({ path: info.outputPath(`manual-${category}-description.png`) });
    await form.getByRole('button', { name: 'حفظ الإعلان', exact: true }).click();
    await expect.poll(() => payload?.description).toBe(description);
    expect(payload?.category).toBe(category);
    expect(Object.hasOwn(payload!, 'condition')).toBe(false);
  });
}

test('changing the description neither cancels a title suggestion nor starts another classification', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'description-context-user', email: 'description-context@example.test' },
  } }));
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const requests: Array<{ title: string }> = [];
  await page.route('**/api/marketplace/listing-category', async route => {
    const input = route.request().postDataJSON();
    requests.push(input);
    await delayed;
    await route.fulfill({ json: { category: 'furniture', status: 'suggested' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  await form.locator('input[maxlength="140"]').fill('مكتب للبيع');
  await form.locator('textarea').fill('الوصف السابق');
  try {
    await expect.poll(() => requests.length).toBe(1);
    await form.locator('textarea').fill('الوصف الجديد');
    await page.waitForTimeout(1100);
    expect(requests).toEqual([{ title: 'مكتب للبيع' }]);
    release();
    await expect(form.locator('select').first()).toHaveValue('furniture');
    await expect(form.locator('textarea')).toHaveValue('الوصف الجديد');
    expect(requests).toEqual([{ title: 'مكتب للبيع' }]);
  } finally { release(); }
});
