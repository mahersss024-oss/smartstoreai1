import { expect, test, type Page } from '@playwright/test';

const assistantImages = 'img[src*="/hamad-assistant-"]';
const assistantPreloads = 'link[rel="preload"][href*="/hamad-assistant-"]';

async function expectAccessibleBubble(page: Page) {
  const bubble = page.locator('.smartstore-ai-bubble');
  await expect(bubble).toBeVisible();
  await expect.poll(() => bubble.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const banner = document.querySelector('.open-in-app-banner')?.getBoundingClientRect();
    const navigation = document.querySelector('.marketplace-bottom-nav')?.getBoundingClientRect();
    const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return rect.top >= (banner?.bottom ?? 0) + 14 && rect.left >= 14 &&
      rect.right <= innerWidth - 14 && rect.bottom <= (navigation?.top ?? innerHeight) - 14 &&
      target !== null && element.contains(target);
  })).toBe(true);
}

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

test('saved and dragged assistant positions stay reachable between the app banner and navigation', async ({ page }, info) => {
  test.skip(!info.project.name.includes('mobile'), 'Requires the real mobile app banner.');
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    localStorage.setItem('smartstore-ai-bubble-position-v1', JSON.stringify({ x: 14, y: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('.open-in-app-banner')).toBeVisible();
  await expectAccessibleBubble(page);
  const bubble = page.locator('.smartstore-ai-bubble');
  const initial = (await bubble.boundingBox())!;
  await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
  await page.mouse.down();
  await page.mouse.move(1, 1, { steps: 8 });
  await page.mouse.up();
  await expectAccessibleBubble(page);
  await page.setViewportSize({ width: 360, height: 640 });
  await expectAccessibleBubble(page);
  await page.screenshot({ path: info.outputPath('reachable-assistant.png'), fullPage: true });
  await bubble.click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await page.getByRole('button', { name: '\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062a', exact: true }).click();
  await expectAccessibleBubble(page);
  await bubble.click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
});
