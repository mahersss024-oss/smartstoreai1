import { expect, test, type Page } from '@playwright/test';
import { createListingId } from '@/lib/marketplace/listing-id';
import { createSessionCookie } from '@/lib/auth/session';

async function prepare(page: Page, baseURL: string, actor: string) {
  const cookie = createSessionCookie({ id: actor, email: `${actor}@example.test`, name: 'Reference customer' });
  await page.context().addCookies([{ name: 'smartstore_session',
    value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')), url: baseURL }]);
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => sessionStorage.setItem('test-copied-listing-id', text),
    } });
  });
  await page.route('**/api/realtime/stream**', route => route.fulfill({
    contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n',
  }));
}

async function search(page: Page, query: string) {
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/marketplace/listings' && url.searchParams.get('q') === query;
  });
  await page.getByPlaceholder('\u0627\u0628\u062d\u062b \u0641\u064a \u0643\u0644 \u0627\u0644\u0633\u0648\u0642', { exact: true }).fill(query);
  const result = await response;
  expect(result.status()).toBe(200);
  return result.json() as Promise<{ listings: { id: string }[] }>;
}

test('market ID search uses the real API, opens the same URL and copies the complete visible ID', async ({ page, baseURL }, info) => {
  const id = createListingId('e2e-reference-seller', info.project.name);
  await prepare(page, baseURL!, `reference-buyer-${info.project.name}`);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  expect((await search(page, id)).listings.map(listing => listing.id)).toEqual([id]);
  const cards = page.locator('.marketplace-listing-card');
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
  const reference = page.locator('[data-listing-reference]');
  await reference.scrollIntoViewIfNeeded();
  await expect(reference.locator('strong')).toHaveText(id);
  expect(await reference.locator('strong').evaluate(element => {
    const style = getComputedStyle(element);
    return element.scrollWidth <= element.clientWidth + 1 && style.textOverflow !== 'ellipsis';
  })).toBe(true);
  await reference.getByRole('button', { name: '\u0646\u0633\u062e \u0631\u0642\u0645 \u0627\u0644\u0625\u0639\u0644\u0627\u0646', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('test-copied-listing-id'))).toBe(id);
  await page.screenshot({ path: info.outputPath('listing-reference.png') });
  await page.goBack();
  await expect(page.getByPlaceholder('\u0627\u0628\u062d\u062b \u0641\u064a \u0643\u0644 \u0627\u0644\u0633\u0648\u0642', { exact: true })).toHaveValue(id);
  await expect(cards).toHaveCount(1);
  expect((await search(page, `https://example.test/listings/${id}`)).listings.map(listing => listing.id)).toEqual([id]);
  const oldId = `chat-draft-e2e-reference-${info.project.name}`;
  expect((await search(page, oldId)).listings.map(listing => listing.id)).toEqual([oldId]);
  await expect(cards).toHaveCount(1);
  await cards.first().click();
  await expect(page).toHaveURL(new RegExp(`/listings/${oldId}$`));
  await expect(page.locator('[data-listing-reference] strong')).toHaveText(oldId);
  expect(errors).toEqual([]);
});

test('manual API creation returns the unified format and keeps an unpublished listing out of public ID search', async ({ page, baseURL }, info) => {
  await prepare(page, baseURL!, `reference-seller-${info.project.name}`);
  const response = await page.request.post('/api/marketplace/listings', {
    data: { category: 'furniture', autoCategory: false, title: 'New reference desk', city: '\u0627\u0644\u0631\u064a\u0627\u0636', price: 150 },
  });
  expect(response.status()).toBe(201);
  const { listing } = await response.json();
  expect(listing.id).toMatch(/^c[a-z0-9]{24}$/);
  expect(listing.status).toBe('draft');
  const searched = await page.request.get(`/api/marketplace/listings?q=${listing.id}`);
  expect(searched.status()).toBe(200);
  expect((await searched.json()).listings).toEqual([]);
});
