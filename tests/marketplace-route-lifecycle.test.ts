import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

beforeEach(mockAllowedTextAnalysis);
import test from 'node:test';

import { POST as createListing } from '@/app/api/marketplace/listings/route';
import { GET as readListing, PATCH as updateListing } from '@/app/api/marketplace/listings/[listingId]/route';
import { GET as readFavorite, POST as toggleFavorite } from '@/app/api/marketplace/listings/[listingId]/favorite/route';
import { POST as createConversation } from '@/app/api/marketplace/conversations/route';
import { GET as readConversation, DELETE as deleteConversation } from '@/app/api/marketplace/conversations/[conversationId]/route';
import { GET as sellerListings } from '@/app/api/marketplace/me/listings/route';
import { createSessionCookie } from '@/lib/auth/session';

function request(path: string, actor: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Cookie: createSessionCookie({ id: actor, email: `${actor}@example.test` }).split(';')[0],
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('listing routes preserve ownership through create, edit, publish, favorites, contact, pause, sale and deletion', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  const seller = 'lifecycle-contract-seller';
  const buyer = 'lifecycle-contract-buyer';
  const outsider = 'lifecycle-contract-outsider';
  try {
    assert.equal((await createListing(request('/api/marketplace/listings', seller, 'POST', { title: '' }))).status, 400);
    const created = await createListing(request('/api/marketplace/listings', seller, 'POST', {
      title: 'Solid wooden desk', description: 'Used desk in good condition', category: 'furniture', price: 100,
    }));
    assert.equal(created.status, 201);
    const { listing } = await created.json();
    assert.equal(listing.sellerId, seller);
    assert.equal(listing.status, 'draft');
    const path = `/api/marketplace/listings/${listing.id}`;
    const context = { params: Promise.resolve({ listingId: listing.id }) };
    const read = () => readListing(request(path, buyer), context);
    const update = (actor: string, body: unknown) => updateListing(request(path, actor, 'PATCH', body), context);
    assert.equal((await read()).status, 404);
    assert.equal((await update(outsider, { title: 'Unauthorized edit' })).status, 404);
    assert.equal((await update(seller, { price: -1 })).status, 400);
    const edited = await update(seller, { title: 'Solid wooden office desk', price: 150 });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).listing.price, 150);
    const published = await update(seller, { action: 'publish' });
    assert.equal(published.status, 200);
    assert.equal((await published.json()).listing.status, 'published');
    // Public detail cache deliberately has a TTL; a fresh listing avoids asserting
    // immediate consistency against an earlier cached missing/draft response.
    const owned = await sellerListings(request('/api/marketplace/me/listings', seller));
    assert.ok((await owned.json()).listings.some((item: { id: string }) => item.id === listing.id));
    const others = await sellerListings(request('/api/marketplace/me/listings', outsider));
    assert.ok(!(await others.json()).listings.some((item: { id: string }) => item.id === listing.id));
    const favoritePath = `${path}/favorite`;
    assert.equal((await (await readFavorite(request(favoritePath, buyer), context)).json()).isFavorite, false);
    assert.equal((await toggleFavorite(request(favoritePath, seller, 'POST'), context)).status, 409);
    const favorite = await toggleFavorite(request(favoritePath, buyer, 'POST'), context);
    assert.equal(favorite.status, 200);
    assert.equal((await favorite.json()).status, 'saved');
    assert.equal((await (await readFavorite(request(favoritePath, buyer), context)).json()).isFavorite, true);
    assert.equal((await (await readFavorite(request(favoritePath, outsider), context)).json()).isFavorite, false);
    assert.equal((await (await toggleFavorite(request(favoritePath, buyer, 'POST'), context)).json()).status, 'removed');
    assert.equal((await (await readFavorite(request(favoritePath, buyer), context)).json()).isFavorite, false);
    assert.equal((await createConversation(request('/api/marketplace/conversations', seller, 'POST', { listingId: listing.id }))).status, 409);
    const contact = await createConversation(request('/api/marketplace/conversations', buyer, 'POST', { listingId: listing.id }));
    assert.equal(contact.status, 201);
    const { conversation } = await contact.json();
    const conversationPath = `/api/marketplace/conversations/${conversation.id}`;
    const conversationContext = { params: Promise.resolve({ conversationId: conversation.id }) };
    assert.equal((await readConversation(request(conversationPath, outsider), conversationContext)).status, 404);
    assert.equal((await readConversation(request(conversationPath, seller), conversationContext)).status, 200);
    assert.equal((await deleteConversation(request(conversationPath, outsider, 'DELETE'), conversationContext)).status, 404);
    assert.equal((await deleteConversation(request(conversationPath, buyer, 'DELETE'), conversationContext)).status, 200);
    for (const [action, status] of [['pause', 'paused'], ['publish', 'published'], ['mark_sold', 'sold'], ['delete', 'deleted']]) {
      const response = await update(seller, { action });
      assert.equal(response.status, 200, action);
      assert.equal((await response.json()).listing.status, status);
    }
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
