import assert from 'node:assert/strict';
import test from 'node:test';
import * as store from '@/agent/marketplace/store';

test('seller deletion is terminal for pause, sale, publication and content edits', () => {
  const sellerId = `terminal-seller-${crypto.randomUUID()}`;
  const listing = store.createListingDraft({ sellerId, category: 'furniture',
    title: 'Local terminal-state fixture', description: 'Synthetic listing, not a real offer.' });
  listing.compliance = { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false, checkStatus: 'completed' };
  assert.equal(store.setListingStatusForSeller(listing.id, sellerId, 'published')?.status, 'published');
  assert.equal(store.setListingStatusForSeller(listing.id, sellerId, 'deleted')?.status, 'deleted');
  assert.equal(store.setListingStatusForSeller(listing.id, sellerId, 'paused'), null);
  assert.equal(store.setListingStatusForSeller(listing.id, sellerId, 'sold'), null);
  assert.notEqual(store.setListingStatusForSeller(listing.id, sellerId, 'published')?.status, 'published');
  assert.equal(store.updateListingForSeller(listing.id, sellerId, { title: 'Changed after deletion' }), null);
  assert.equal(store.getListing(listing.id)?.status, 'deleted');
});
