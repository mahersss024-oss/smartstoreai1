import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '@/app/api/marketplace/listings/[listingId]/route';
import { addListingImageForSeller, createListingDraft, deleteListingImageForSeller, publishListing, setListingStatusForSeller } from '@/agent/marketplace/store';
import { getOrSetPublicJsonCache } from '@/lib/api/public-json-cache';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

test('detail bypasses old cached snapshots after an image is removed or the listing is paused', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const previousRedisUrl = process.env.UPSTASH_REDIS_REST_URL;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  process.env.UPSTASH_REDIS_REST_URL = '';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    if (previousRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousRedisUrl;
  });
  mockAllowedTextAnalysis(t);
  const draft = createListingDraft({ sellerId: 'fresh-image-owner', category: 'other', title: 'Desk' });
  const image = {
    id: 'freshness-image', listingId: draft.id,
    originalUrl: 'https://images.example.test/freshness.jpg',
    displayUrl: 'https://images.example.test/freshness-display.webp',
    thumbnailUrl: 'https://images.example.test/freshness-thumbnail.webp',
    isPrimary: true, status: 'approved' as const, qualityScore: 90, enhancements: [],
  };
  addListingImageForSeller(draft.id, draft.sellerId, image);
  publishListing(draft.id);
  const context = { params: Promise.resolve({ listingId: draft.id }) };
  const read = () => GET(new Request(`https://souqhamad.test/api/marketplace/listings/${draft.id}`), context);
  const before = await read();
  assert.equal(before.status, 200);
  const snapshot = await before.json();
  assert.equal(snapshot.listing.images.length, 1);
  // Seed the old shared cache deliberately: the route must ignore it entirely.
  await getOrSetPublicJsonCache(`public-listing-detail:${draft.id}`, { ttlSeconds: 60, load: async () => snapshot });
  deleteListingImageForSeller(draft.id, draft.sellerId, image.id);
  const after = await read();
  assert.equal((await after.json()).listing.images.length, 0);
  assert.match(after.headers.get('cache-control')!, /no-store/);
  assert.doesNotMatch(after.headers.get('cache-control')!, /s-maxage|stale-while-revalidate/);
  setListingStatusForSeller(draft.id, draft.sellerId, 'paused');
  const hidden = await read();
  assert.equal(hidden.status, 404);
  assert.match(hidden.headers.get('cache-control')!, /no-store/);
});
