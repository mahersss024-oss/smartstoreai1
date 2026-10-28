import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { GET } from '@/app/api/marketplace/users/[userId]/profile/route';
import * as store from '@/agent/marketplace/store';
import { prisma } from '@/lib/db/prisma';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

function useStore(t: TestContext, mode: 'file' | 'database') {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = mode;
  t.after(() => {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  });
}

function publicProfile(sellerId: string) {
  return GET(new Request(`http://localhost/api/marketplace/users/${encodeURIComponent(sellerId)}/profile`), {
    params: Promise.resolve({ userId: sellerId }),
  });
}

type SellerFixture = {
  id: string;
  name: string;
  picture: null;
  phoneNumber: string;
  role: string;
  createdAt: Date;
  deletedAt: Date | null;
};

function mockDatabaseSellerReads(t: TestContext, seller: SellerFixture | null) {
  // Replace every database read used by this repository operation. No database
  // connection or database fixture writes are needed for these privacy checks.
  const original = {
    user: prisma.user.findUnique,
    listings: prisma.listing.findMany,
    listingCount: prisma.listing.count,
    followCount: prisma.sellerFollow.count,
    ratings: prisma.sellerRating.aggregate,
  };
  t.after(() => {
    prisma.user.findUnique = original.user;
    prisma.listing.findMany = original.listings;
    prisma.listing.count = original.listingCount;
    prisma.sellerFollow.count = original.followCount;
    prisma.sellerRating.aggregate = original.ratings;
  });
  prisma.user.findUnique = (async () => seller) as unknown as typeof prisma.user.findUnique;
  prisma.listing.findMany = (async () => []) as unknown as typeof prisma.listing.findMany;
  prisma.listing.count = (async () => 0) as unknown as typeof prisma.listing.count;
  prisma.sellerFollow.count = (async () => 0) as unknown as typeof prisma.sellerFollow.count;
  prisma.sellerRating.aggregate = (async () => ({
    _avg: { rating: null }, _count: { rating: 0 },
  })) as unknown as typeof prisma.sellerRating.aggregate;
}

function sellerFixture(id: string): SellerFixture {
  return {
    id, name: 'Public profile fixture', picture: null,
    phoneNumber: 'private-contact-fixture', role: 'user',
    createdAt: new Date('2026-01-01T00:00:00.000Z'), deletedAt: null,
  };
}

test('guests can read a public seller profile containing only published listings', async t => {
  useStore(t, 'file');
  mockAllowedTextAnalysis(t);
  const sellerId = `public-profile-${randomUUID()}`;
  const published = store.createListingDraft({ sellerId, category: 'other', title: 'Public listing fixture' });
  const draft = store.createListingDraft({ sellerId, category: 'other', title: 'Private draft fixture' });
  const paused = store.createListingDraft({ sellerId, category: 'other', title: 'Paused listing fixture' });
  assert.equal(store.setListingStatusForSeller(published.id, sellerId, 'published')?.status, 'published');
  assert.equal(store.setListingStatusForSeller(paused.id, sellerId, 'paused')?.status, 'paused');
  assert.equal(draft.status, 'draft');

  const response = await publicProfile(sellerId);
  assert.equal(response.status, 200);
  const { seller } = await response.json();
  assert.equal(seller.id, sellerId);
  assert.equal(typeof seller.name, 'string');
  assert.equal(seller.publishedListingCount, 1);
  assert.equal(typeof seller.ratingAverage, 'number');
  assert.equal(typeof seller.ratingCount, 'number');
  assert.equal(typeof seller.followerCount, 'number');
  assert.deepEqual(seller.listings.map((listing: { id: string }) => listing.id), [published.id]);
  assert.equal(seller.listings[0].status, 'published');
  assert.equal(Object.hasOwn(seller, 'phoneNumber'), false);
  assert.equal(Object.hasOwn(seller, 'email'), false);
});

test('a missing seller or file-store seller without published listings returns 404 to guests', async t => {
  useStore(t, 'file');
  mockAllowedTextAnalysis(t);
  const suffix = randomUUID();
  const draftSellerId = `profile-draft-only-${suffix}`;
  const pausedSellerId = `profile-paused-only-${suffix}`;
  store.createListingDraft({ sellerId: draftSellerId, category: 'other', title: 'Unpublished profile fixture' });
  const paused = store.createListingDraft({ sellerId: pausedSellerId, category: 'other', title: 'Paused profile fixture' });
  assert.equal(store.setListingStatusForSeller(paused.id, pausedSellerId, 'paused')?.status, 'paused');

  for (const sellerId of [`profile-missing-${suffix}`, draftSellerId, pausedSellerId]) {
    const response = await publicProfile(sellerId);
    assert.equal(response.status, 404, sellerId);
    assert.deepEqual(await response.json(), { error: 'seller_not_found' });
  }
});

test('public database seller responses omit a stored private phone number', async t => {
  useStore(t, 'database');
  const fixture = sellerFixture(`profile-contact-${randomUUID()}`);
  mockDatabaseSellerReads(t, fixture);

  const response = await publicProfile(fixture.id);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.seller.id, fixture.id);
  assert.equal(body.seller.name, fixture.name);
  assert.equal(body.seller.joinedAt, fixture.createdAt.toISOString());
  assert.equal(body.seller.publishedListingCount, 0);
  assert.deepEqual(body.seller.listings, []);
  assert.equal(Object.hasOwn(body.seller, 'phoneNumber'), false);
  assert.equal(Object.hasOwn(body.seller, 'email'), false);
  assert.equal(JSON.stringify(body).includes(fixture.phoneNumber), false);
});

test('missing and deleted database sellers return 404 without exposing their profiles', async t => {
  useStore(t, 'database');
  const sellerId = `profile-unavailable-${randomUUID()}`;
  for (const deletedAt of [null, new Date('2026-01-02T00:00:00.000Z')]) {
    await t.test(deletedAt ? 'deleted seller' : 'missing seller', async child => {
      mockDatabaseSellerReads(child, deletedAt ? { ...sellerFixture(sellerId), deletedAt } : null);
      const response = await publicProfile(sellerId);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: 'seller_not_found' });
    });
  }
});


test('summary profile skips listing payload queries and still returns accurate public counts', async t => {
  useStore(t, 'database');
  const fixture = sellerFixture(`profile-summary-${randomUUID()}`);
  mockDatabaseSellerReads(t, fixture);
  let listingReads = 0;
  prisma.listing.findMany = (async () => { listingReads++; throw new Error('Summary must not load seller listings'); }) as unknown as typeof prisma.listing.findMany;
  prisma.listing.count = (async () => 37) as unknown as typeof prisma.listing.count;
  const response = await GET(new Request(`http://localhost/api/marketplace/users/${fixture.id}/profile?summary=1`), {
    params: Promise.resolve({ userId: fixture.id }),
  });
  assert.equal(response.status, 200);
  const { seller } = await response.json();
  assert.equal(seller.publishedListingCount, 37);
  assert.deepEqual(seller.listings, []);
  assert.equal(Object.hasOwn(seller, 'phoneNumber'), false);
  assert.equal(listingReads, 0);
});
