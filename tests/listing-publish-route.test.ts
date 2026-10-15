import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '@/app/api/marketplace/listings/route';
import { PATCH } from '@/app/api/marketplace/listings/[listingId]/route';
import { createSessionCookie } from '@/lib/auth/session';

test('existing routes support photo-free publication, auto category and unchanged ownership', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const headers = {
      Cookie: createSessionCookie({ id: 'photo-free-seller', email: 'photo-free@example.test' }).split(';')[0],
      'Content-Type': 'application/json',
    };
    const created = await POST(new Request('http://localhost/api/marketplace/listings', {
      method: 'POST', headers,
      body: JSON.stringify({ category: 'other', autoCategory: true, title: 'iPhone 15' }),
    }));
    assert.equal(created.status, 201);
    const { listing } = await created.json();
    assert.equal(listing.category, 'mobile_phones');
    assert.deepEqual(listing.images, []);
    const context = { params: Promise.resolve({ listingId: listing.id }) };
    const url = `http://localhost/api/marketplace/listings/${listing.id}`;
    const publish = (requestHeaders: Record<string, string>) => PATCH(new Request(url, {
      method: 'PATCH', headers: requestHeaders, body: JSON.stringify({ action: 'publish' }),
    }), context);
    assert.equal((await publish({ 'Content-Type': 'application/json' })).status, 401);
    assert.equal((await publish({ ...headers, Cookie: createSessionCookie({ id: 'other-seller', email: 'other@example.test' }).split(';')[0] })).status, 404);
    const response = await publish(headers);
    assert.equal(response.status, 200);
    const published = (await response.json()).listing;
    assert.equal(published.status, 'published');
    assert.deepEqual(published.images, []);
    assert.ok(published.firstPublishedAt);
    const repeated = (await (await publish(headers)).json()).listing;
    assert.equal(repeated.firstPublishedAt, published.firstPublishedAt);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
