import { expect, test } from '@playwright/test';

const assistantImages = 'img[src*="/hamad-assistant-"]';
const assistantPreloads = 'link[rel="preload"][href*="/hamad-assistant-"]';

test('non-home routes do not render or request assistant images', async ({ page }, testInfo) => {
  const requestedAssets: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/hamad-assistant-')) {
      requestedAssets.push(request.url());
    }
  });
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));

  for (const path of [
    `/listings/e2e-report-${testInfo.project.name}`,
    '/account', '/favorites', '/conversations', '/privacy', '/terms',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(200);
    await expect(page.locator('.smartstore-ai-bubble'), path).toHaveCount(0);
    await expect(page.locator(assistantImages), path).toHaveCount(0);
    await expect(page.locator(assistantPreloads), path).toHaveCount(0);
  }

  expect(requestedAssets).toEqual([]);
});

test('floating assistant leaves with home and returns after client navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.goto('/');

  const bubble = page.getByRole('button', { name: '\u0641\u062a\u062d \u062d\u0645\u062f', exact: true });
  await expect(bubble).toBeVisible();
  await expect.poll(() => bubble.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('home-assistant.png') });

  await page.getByRole('button', { name: '\u062d\u0633\u0627\u0628\u064a', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.locator('.smartstore-ai-bubble')).toHaveCount(0);
  await expect(page.locator(assistantImages)).toHaveCount(0);
  await expect(page.locator(assistantPreloads)).toHaveCount(0);

  await page.getByRole('button', { name: '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(bubble).toBeVisible();

  await bubble.click();
  await expect(bubble).toHaveCount(0);
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
});
