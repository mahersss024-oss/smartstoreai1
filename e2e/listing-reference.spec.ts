import { expect, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

test('manual API creation returns the unified format and keeps an unpublished listing out of public ID search', async ({ request, baseURL }, info) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  const actor = `reference-seller-${info.project.name}`;
  const headers = { Cookie: createSessionCookie({
    id: actor, email: `${actor}@example.test`, name: 'Reference customer',
  }).split(';')[0] };
  const response = await request.post('/api/marketplace/listings', {
    headers,
    data: { category: 'furniture', autoCategory: false, title: 'New reference desk', city: '\u0627\u0644\u0631\u064a\u0627\u0636', price: 150 },
  });
  expect(response.status()).toBe(201);
  const { listing } = await response.json();
  expect(listing.id).toMatch(/^c[a-z0-9]{24}$/);
  expect(listing.status).toBe('draft');
  const searched = await request.get(`/api/marketplace/listings?q=${listing.id}`, { headers });
  expect(searched.status()).toBe(200);
  expect((await searched.json()).listings).toEqual([]);
});
