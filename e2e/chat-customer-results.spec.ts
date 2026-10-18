import { expect, test } from '@playwright/test';

test('customer chat displays verified cards, replaces them with an empty new search and fits the viewport', async ({ page }, info) => {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'chat-flow-customer', email: 'chat-flow@example.test', name: '\u0639\u0645\u064a\u0644' },
  } }));
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
    listings: [], pagination: { page: 1, limit: 24, hasMore: false, nextPage: null },
  } }));
  let searches = 0;
  await page.route('**/api/chat', async route => {
    searches++;
    const body = route.request().postDataJSON();
    expect(body.messages.at(-1).id).toBeTruthy();
    const listings = searches === 1 ? [{ id: 'verified-chat-ad', sellerId: 'verified-seller',
      title: '\u0647\u0627\u062a\u0641 \u0644\u0644\u0628\u064a\u0639', category: 'other', price: 123, city: '\u0627\u0644\u0631\u064a\u0627\u0636',
      image: '/hamad-market-logo.webp', status: 'published' }] : [];
    const chunks = [
      { type: 'start', messageId: `verified-response-${searches}` },
      { type: 'tool-input-available', toolCallId: `search-${searches}`, toolName: 'searchMarketplaceListings', input: { query: 'customer product', understoodIntent: { searchMode: 'new_search' } } },
      { type: 'tool-output-available', toolCallId: `search-${searches}`, output: { status: 'searched', listings } },
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: searches === 1 ? '\u0647\u0630\u0647 \u0646\u062a\u0627\u0626\u062c \u0627\u0644\u0628\u062d\u062b.' : '\u0644\u0627 \u062a\u0648\u062c\u062f \u0646\u062a\u0627\u0626\u062c \u0645\u0637\u0627\u0628\u0642\u0629.' },
      { type: 'text-end', id: 'answer' }, { type: 'finish', finishReason: 'stop' },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/?chat=1');
  await expect(page.locator('.app-welcome')).toBeHidden();
  const input = page.getByPlaceholder('\u0627\u0643\u062a\u0628 \u0637\u0644\u0628\u0643 \u0623\u0648 \u0623\u0631\u0641\u0642 \u0635\u0648\u0631 \u0627\u0644\u0645\u0646\u062a\u062c...');
  await input.fill('\u0627\u0628\u062d\u062b \u0639\u0646 \u0647\u0627\u062a\u0641');
  await page.getByRole('button', { name: '\u0625\u0631\u0633\u0627\u0644', exact: true }).click();
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(1);
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: '\u0627\u0644\u0639\u0648\u062f\u0629 \u0644\u0644\u0625\u0639\u0644\u0627\u0646\u0627\u062a', exact: true }).click();
  await expect(page.locator('.smart-assistant-result-card')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('verified-chat-results.png'), fullPage: true });
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: '\u0641\u062a\u062d \u062d\u0645\u062f', exact: true }).click();
  await input.fill('\u0627\u0628\u062d\u062b \u0639\u0646 \u062b\u0644\u0627\u062c\u0629');
  await page.getByRole('button', { name: '\u0625\u0631\u0633\u0627\u0644', exact: true }).click();
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(0);
  expect(searches).toBe(2);
});
