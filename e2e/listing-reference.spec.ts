import { expect, test, type Page } from '@playwright/test';

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
