import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { addListingImageForSeller } from '@/agent/marketplace/repository';
import * as store from '@/agent/marketplace/store';

const image = { id: 'terminal-image', listingId: 'listing', originalUrl: 'https://images.example.test/image.webp',
  displayUrl: 'https://images.example.test/display.webp', thumbnailUrl: 'https://images.example.test/thumbnail.webp',
  status: 'approved' as const, isPrimary: true, qualityScore: 90, enhancements: [] };

function fixture(t: TestContext, status: string, deleteWhileLocking = false) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  const row = { id: 'listing', sellerId: 'seller', status, category: 'furniture', title: 'Synthetic image fixture',
    attributes: {}, images: [] as typeof image[], compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    price: null, city: null, condition: null, description: null, priceMode: null,
    views: 0, messageCount: 0, favoriteCount: 0, createdAt: new Date(0), updatedAt: new Date(0) };
  let inserted = 0; let rowLocked = false;
  const locks: string[] = [];
  const original = prisma.$transaction;
  prisma.$transaction = (async (work: (tx: unknown) => Promise<unknown>) => work({
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('pg_advisory_xact_lock')) {
        locks.push(String(values[0]));
        if (deleteWhileLocking && locks.length === 1) row.status = 'deleted';
      } else {
        assert.match(strings.join('?'), /FOR UPDATE/);
        assert.deepEqual(locks, ['listing:listing', 'user:seller']); rowLocked = true;
      }
      return 1;
    },
    listing: { findUnique: async () => { assert.ok(rowLocked); return row; } },
    listingImage: { create: async ({ data }: { data: typeof image }) => { inserted++; row.images.push(data); return data; } },
    listingImageUpload: { count: async () => 0 },
  })) as never;
  t.after(() => { prisma.$transaction = original; });
  return { inserted: () => inserted, row };
}

for (const scenario of ['already-deleted', 'deleted-while-waiting']) {
  test(`legacy image addition refuses a listing ${scenario}`, async t => {
    const state = fixture(t, scenario === 'already-deleted' ? 'deleted' : 'published', scenario === 'deleted-while-waiting');
    assert.equal(await addListingImageForSeller('listing', 'seller', image), null);
    assert.equal(state.inserted(), 0); assert.equal(state.row.images.length, 0);
  });
}

test('file-store image addition observes the same terminal deletion rule', () => {
  store.resetMarketplaceStoreForTests();
  const listing = store.createListingDraft({ sellerId: 'terminal-file-owner', category: 'other', title: 'Synthetic terminal fixture' });
  store.setListingStatusForSeller(listing.id, listing.sellerId, 'deleted');
  assert.equal(store.addListingImageForSeller(listing.id, listing.sellerId, { ...image, listingId: listing.id }), null);
  assert.equal(store.getListing(listing.id)!.images.length, 0);
});
