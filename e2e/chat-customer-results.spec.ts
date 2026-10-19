import { expect, test, type Page } from '@playwright/test';

async function prepare(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'hamad-draft-customer', email: 'hamad@example.test', name: 'عميل' },
  } }));
  let writes = 0;
  await page.route('**/api/marketplace/listings**', route => {
    if (route.request().method() !== 'GET') writes++;
    return route.fulfill({ json: { listings: [{ id: 'public-market-ad', title: 'إعلان السوق', category: 'other', price: 100, city: 'الرياض' }],
      pagination: { page: 1, limit: 24, hasMore: false, nextPage: null } } });
  });
  return () => writes;
}

function reply(id: string, text: string, metadata: object = {}, legacyTool = false) {
  return [
    { type: 'start', messageId: id, messageMetadata: metadata },
    ...(legacyTool ? [
      { type: 'tool-input-available', toolCallId: 'old-search', toolName: 'searchMarketplaceListings', input: { query: 'old' } },
      { type: 'tool-output-available', toolCallId: 'old-search', output: { status: 'searched', listings: [{ id: 'legacy-card', title: 'نتيجة قديمة', price: 1 }] } },
    ] : []),
    { type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: text },
    { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop' },
  ].map(chunk => 'data: '+JSON.stringify(chunk)+'\n\n').join('')+'data: [DONE]\n\n';
}

test('generic ad creation offers both real methods and manual choice opens the unchanged form without writes', async ({ page }, info) => {
  const writes = await prepare(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(body.creationMethod).toBeUndefined();
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: reply('choose-method', 'كيف تفضّل إنشاء إعلانك؟', { creationChoice: true }) });
  });
  await page.goto('/?chat=1');
  const input = page.getByPlaceholder('اكتب طلبك أو أرفق صور المنتج...');
  await expect(page.getByTestId('assistant-creation-options')).toBeVisible();
  await expect(page.getByRole('button', { name: 'الإنشاء مع حمد', exact: true })).toBeVisible();
  await input.fill('أريد إنشاء إعلان');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('كيف تفضّل إنشاء إعلانك؟', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'الإنشاء اليدوي', exact: true }).click();
  await expect(page.getByLabel('عنوان الإعلان', { exact: true })).toBeVisible();
  expect(requests.length).toBe(1);
  expect(writes()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('manual-creation-choice.png'), fullPage: true });
});

test('choosing Hamad sends explicit draft mode, ignores legacy search cards and resets mode on new chat', async ({ page }, info) => {
  const writes = await prepare(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    expect(body.selectedListing).toBeUndefined();
    expect(body.resetSearchState).toBeUndefined();
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: reply('draft-reply-'+requests.length, 'ما المنتج الذي تريد تجهيز مسودته؟', { marketplaceIntent: 'create_listing' }, true) });
  });
  await page.goto('/?chat=1');
  await page.getByRole('button', { name: 'الإنشاء مع حمد', exact: true }).click();
  await expect(page.getByText('ما المنتج الذي تريد تجهيز مسودته؟', { exact: true })).toBeVisible();
  expect(requests[0].creationMethod).toBe('chat');
  expect(requests[0].beginDraftWithHamad).toBe(true);
  await expect(page.getByTestId('assistant-creation-options')).toHaveCount(0);
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'مقارنة الإعلان', exact: true })).toHaveCount(0);
  expect(writes()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('hamad-draft-choice.png'), fullPage: true });
  await page.getByRole('button', { name: 'مسح المحادثة وبدء محادثة جديدة', exact: true }).click();
  await expect(page.getByTestId('assistant-creation-options')).toBeVisible();
  const input = page.getByPlaceholder('اكتب طلبك أو أرفق صور المنتج...');
  await input.fill('كيف أستخدم المنصة؟');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].creationMethod).toBeUndefined();
  expect(requests[1].beginDraftWithHamad).toBeUndefined();
});
