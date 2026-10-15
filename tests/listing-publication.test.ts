import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Prisma } from '@prisma/client';

import {
  comparePublicationFeed,
  recordDatabaseFirstPublication,
  recordFirstPublication,
} from '@/agent/marketplace/listing-publication';
import {
  addListingImageForSeller,
  createListingDraft,
  listMarketplaceListings,
  publishListing,
  resetMarketplaceStoreForTests,
  setListingModerationStatus,
  setListingStatusForSeller,
  toggleFavoriteListing,
  updateListingForSeller,
} from '@/agent/marketplace/store';

function draft(id: string) {
  return createListingDraft({ id, sellerId: `seller-${id}`, category: 'other', title: 'Desk' });
}

function approveImage(listing: ReturnType<typeof draft>) {
  addListingImageForSeller(listing.id, listing.sellerId, {
    id: `image-${listing.id}`, listingId: listing.id,
    originalUrl: 'https://example.com/desk.webp', displayUrl: 'https://example.com/desk.webp',
    thumbnailUrl: 'https://example.com/desk.webp', isPrimary: true,
    qualityScore: 95, status: 'approved', enhancements: [],
  });
}

test('only successful first publication stamps new drafts; edits and republication preserve it', () => {
  resetMarketplaceStoreForTests();
  const listing = draft('new');
  const createdAt = listing.createdAt;
  assert.equal(listing.firstPublicationTracked, true);
  assert.equal(listing.firstPublishedAt, undefined);
  assert.equal(setListingStatusForSeller(listing.id, 'wrong-seller', 'published'), null);
  assert.equal(setListingStatusForSeller(listing.id, listing.sellerId, 'published')?.status, 'published');
  const first = listing.firstPublishedAt;
  assert.ok(first);
  approveImage(listing);
  assert.equal(setListingStatusForSeller(listing.id, listing.sellerId, 'published')!.firstPublishedAt, first);
  updateListingForSeller(listing.id, listing.sellerId, { title: 'Updated desk' });
  toggleFavoriteListing(listing.id, 'buyer');
  setListingStatusForSeller(listing.id, listing.sellerId, 'paused');
  setListingStatusForSeller(listing.id, listing.sellerId, 'published');
  publishListing(listing.id);
  const moderated = setListingModerationStatus(listing.id, 'published').listing!;
  assert.equal(moderated.firstPublishedAt, first);
  assert.equal(moderated.createdAt, createdAt);
});

test('legacy listings remain untracked through seller and admin republication', () => {
  resetMarketplaceStoreForTests();
  const legacy = draft('legacy');
  delete legacy.firstPublicationTracked;
  approveImage(legacy);
  publishListing(legacy.id);
  setListingStatusForSeller(legacy.id, legacy.sellerId, 'paused');
  setListingStatusForSeller(legacy.id, legacy.sellerId, 'published');
  setListingModerationStatus(legacy.id, 'published');
  assert.equal(legacy.firstPublishedAt, undefined);
  assert.equal(legacy.firstPublicationTracked, undefined);
});

test('feed sorts future listings by first publication, preserves legacy order and paginates before returning', () => {
  resetMarketplaceStoreForTests();
  const oldA = draft('legacy-a');
  const oldB = draft('legacy-b');
  delete oldA.firstPublicationTracked;
  delete oldB.firstPublicationTracked;
  publishListing(oldA.id);
  publishListing(oldB.id);
  oldA.updatedAt = '2026-01-02T00:00:00.000Z';
  oldB.updatedAt = '2026-01-01T00:00:00.000Z';
  const earlierDraft = draft('earlier-draft');
  const laterDraft = draft('later-draft');
  publishListing(laterDraft.id);
  publishListing(earlierDraft.id);
  earlierDraft.firstPublishedAt = '2026-10-16T00:00:00.000Z';
  laterDraft.firstPublishedAt = '2026-10-15T00:00:00.000Z';
  laterDraft.updatedAt = '2030-01-01T00:00:00.000Z';
  assert.deepEqual(listMarketplaceListings().map(item => item.id),
    [earlierDraft.id, laterDraft.id, oldA.id, oldB.id]);
  // Existing filtered sorting continues to use last update.
  assert.equal(listMarketplaceListings({ category: 'other' })[0].id, laterDraft.id);
  assert.deepEqual(listMarketplaceListings({ page: 2, limit: 2 }).map(item => item.id), [oldA.id, oldB.id]);
});

test('equal publication timestamps use a stable ID, not subsequent updates', () => {
  const a = { id: 'a', status: 'published', updatedAt: '2030', firstPublishedAt: '2026-10-15' };
  const b = { ...a, id: 'b', updatedAt: '2020' };
  assert.ok(comparePublicationFeed(a, b) > 0);
  a.updatedAt = '2040';
  assert.ok(comparePublicationFeed(a, b) > 0);
  const legacy = { id: 'legacy', status: 'published', updatedAt: '2050' };
  recordFirstPublication(legacy, '2026-10-15');
  assert.equal('firstPublishedAt' in legacy, false);
});

test('database publication uses an atomic opt-in and null guard, and ignores non-publishing transitions', async () => {
  const writes: unknown[] = [];
  const tx = { listing: { updateMany: async (input: unknown) => { writes.push(input); return { count: 1 }; } } } as unknown as Prisma.TransactionClient;
  await recordDatabaseFirstPublication(tx, 'new', 'pending');
  await recordDatabaseFirstPublication(tx, 'new', 'paused');
  assert.equal(writes.length, 0);
  await recordDatabaseFirstPublication(tx, 'new', 'published');
  assert.equal(writes.length, 1);
  const write = writes[0] as { where: unknown; data: { firstPublishedAt: Date } };
  assert.deepEqual(write.where, { id: 'new', firstPublicationTracked: true, firstPublishedAt: null });
  assert.ok(write.data.firstPublishedAt instanceof Date);
});

test('migration is additive, leaves legacy dates empty and indexes the unfiltered feed', () => {
  const sql = readFileSync('prisma/migrations/20261015120000_track_future_first_publication/migration.sql', 'utf8');
  assert.match(sql, /"firstPublicationTracked" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /"firstPublishedAt" TIMESTAMP\(3\)/);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP)\b/i);
  assert.match(sql, /CREATE INDEX "Listing_publication_feed_idx"/);
});

test('both repository publication paths and inline admin updates use the same guard', () => {
  const repository = readFileSync('agent/marketplace/repository.ts', 'utf8');
  const admin = readFileSync('app/api/admin/listings/[listingId]/route.ts', 'utf8');
  assert.match(repository, /recordDatabaseFirstPublication\(tx, listingId, nextStatus\)/);
  assert.match(repository, /recordDatabaseFirstPublication\(tx, listingId, status\)/);
  assert.match(admin, /recordDatabaseFirstPublication\(tx, listingId, parsed.data.status\)/);
  assert.match(repository, /isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead/);
});
