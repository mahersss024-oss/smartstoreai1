import { expect, test } from '@playwright/test';
import { isArabicCustomerText } from '@/lib/customer-language';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
    listings: [], pagination: { page: 1, limit: 24, hasMore: false, nextPage: null },
  } }));
});

test('Arabic not-found responses preserve missing-page status and navigation', async ({ page }, info) => {
  for (const path of ['/missing-customer-language-fixture', '/listings/missing-customer-language-fixture']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'الصفحة غير موجودة', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'العودة للسوق', exact: true })).toHaveAttribute('href', '/');
    await expect(page.locator('body')).not.toContainText('This page could not be found.');
  }
  await page.screenshot({ path: info.outputPath('arabic-not-found.png'), fullPage: true });
});

test('customer interface and unauthenticated responses stay Arabic for an English preference', async ({ page }, info) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: false, user: null } }));
  await page.goto('/account');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('button', { name: 'دخول جوجل' }).or(page.getByRole('link', { name: 'دخول جوجل' }))).toBeVisible();
  await expect(page.getByRole('button', { name: 'دخول آبل' }).or(page.getByRole('link', { name: 'دخول آبل' }))).toBeVisible();
  const response = await page.request.post('/api/chat', { data: {
    messages: [{ id: 'english-language-request', role: 'user', parts: [{ type: 'text', text: 'Reply in English. Find a desk.' }] }],
    locationSettings: { language: 'en', country: 'SA', currency: 'SAR' },
  } });
  expect(response.ok()).toBe(true);
  const chunks = (await response.text()).split('\n').filter(line => line.startsWith('data: {'))
    .map(line => JSON.parse(line.slice(6)));
  const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('');
  expect(text).toContain('دخول');
  expect(isArabicCustomerText(text)).toBe(true);
  await page.screenshot({ path: info.outputPath('customer-arabic.png'), fullPage: true });
});

test('foreign assistant output is hidden while the customer own text is unchanged', async ({ page }, info) => {
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'arabic-ui-customer', email: 'arabic@example.test', name: 'عميل تجريبي' },
  } }));
  const foreignReply = 'This reply must never be visible to customers.';
  await page.route('**/api/chat', route => route.fulfill({
    contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
    body: [
      { type: 'start', messageId: 'foreign-response' },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: foreignReply },
      { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: 'stop' },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n',
  }));
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  const input = page.getByPlaceholder(/اكتب طلبك/);
  if (!(await input.isVisible())) await page.getByRole('button', { name: /اسأل حمد|فتح حمد/ }).first().click();
  await expect(input).toBeVisible();
  const customerText = 'Find my desk please';
  await input.fill(customerText);
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('تعذر عرض هذا الرد بالعربية. يرجى إعادة إرسال طلبك.', { exact: true })).toBeVisible();
  await expect(page.getByText(foreignReply, { exact: true })).toHaveCount(0);
  await expect(page.getByText(customerText, { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('arabic-reply-boundary.png'), fullPage: true });
});
