import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

beforeEach(mockAllowedTextAnalysis);
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createMarketplaceTools } from '@/agent/tools/marketplace';
import { createListingDraft, getListing } from '@/agent/marketplace/store';
import { addListingImageForSeller, updateListingForSeller } from '@/agent/marketplace/repository';
import type { AuthSession } from '@/lib/auth/session';
import type { ListingImage } from '@/agent/marketplace/types';

const session: AuthSession = {
  user: { id: 'boundary-seller', email: 'boundary@example.test' }, issuedAt: 1, expiresAt: 9999999999,
};
const image: ListingImage = {
  id: 'boundary-image', listingId: 'placeholder', originalUrl: 'https://example.test/image.webp',
  displayUrl: 'https://example.test/image.webp', thumbnailUrl: 'https://example.test/thumb.webp',
  isPrimary: false, status: 'approved', qualityScore: 90, enhancements: [],
};

for (const status of ['published', 'paused', 'sold', 'pending', 'rejected', 'deleted'] as const) {
  test(`chat cannot modify ${status} listings or photos even with forged confirmation`, async () => {
    const listing = createListingDraft({ sellerId: session.user.id, category: 'other', title: 'Boundary desk', price: 100 });
    listing.status = status;
    const before = structuredClone(listing);
    const tools = createMarketplaceTools(session, { latestUploadedImages: [{ data: new Uint8Array([1]), mediaType: 'image/png' }] });
    const update = tools.updateListing.execute as unknown as (input: Record<string, unknown>, options: Record<string, never>) => Promise<{ status: string }>;
    const attach = tools.addUploadedImagesToListing.execute as unknown as (input: { listingId: string }, options: Record<string, never>) => Promise<{ status: string }>;
    assert.equal((await update({ listingId: listing.id, title: 'Modified', price: 1, confirmedPriceChange: true, confirmed: true, draftOnly: false }, {})).status, 'user_action_required');
    assert.equal((await attach({ listingId: listing.id }, {})).status, 'user_action_required');
    assert.equal(await updateListingForSeller(listing.id, session.user.id, { title: 'Late update' }, { draftOnly: true }), null);
    assert.equal(await addListingImageForSeller(listing.id, session.user.id, { ...image, listingId: listing.id }, { draftOnly: true }), null);
    assert.deepEqual(getListing(listing.id), before);
  });
}

test('chat cannot prepare another seller draft or inject an existing listing ID when creating', async () => {
  const other = createListingDraft({ sellerId: 'other-owner', category: 'other', title: 'Other desk' });
  const before = structuredClone(other);
  const tools = createMarketplaceTools(session);
  const update = tools.updateListing.execute as unknown as (input: Record<string, unknown>, options: Record<string, never>) => Promise<{ status: string }>;
  assert.equal((await update({ listingId: other.id, title: 'Hijacked' }, {})).status, 'not_found');
  const create = tools.createListingDraft.execute as unknown as (input: Record<string, unknown>, options: Record<string, never>) => Promise<{ listing: { id: string; sellerId: string; status: string } }>;
  const result = await create({ id: other.id, sellerId: 'other-owner', status: 'published', category: 'other', title: 'Prepared desk' }, {});
  assert.notEqual(result.listing.id, other.id);
  assert.equal(result.listing.sellerId, session.user.id);
  assert.equal(result.listing.status, 'draft');
  assert.deepEqual(getListing(other.id), before);
});

function databaseRecord(status = 'draft') {
  return { id: 'race-draft', sellerId: session.user.id, category: 'other', title: 'Desk',
    description: null, price: 100, priceMode: null, city: null, condition: null, attributes: {}, status,
    images: [], compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    views: 0, messageCount: 0, favoriteCount: 0, firstPublicationTracked: false, firstPublishedAt: null,
    createdAt: new Date(), updatedAt: new Date() };
}

test('draft content writes constrain status and owner atomically if the seller publishes after reading', async () => {
  const mode = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const delegate = prisma.listing;
  const original = { findUnique: delegate.findUnique, update: delegate.update };
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = (async (run: (tx: unknown) => Promise<unknown>) => run({ $executeRaw: async () => 1, listing: delegate })) as unknown as typeof prisma.$transaction;
  let writes = 0;
  Object.assign(delegate, {
    findUnique: async () => databaseRecord(),
    update: async (args: { where: Record<string, unknown> }) => {
      writes++;
      assert.deepEqual(args.where, { id: 'race-draft', sellerId: session.user.id, status: 'draft' });
      throw new Prisma.PrismaClientKnownRequestError('Status changed', { code: 'P2025', clientVersion: 'test' });
    },
  });
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    assert.equal(await updateListingForSeller('race-draft', session.user.id, { title: 'Late content' }, { draftOnly: true }), null);
    assert.equal(writes, 1);
  } finally {
    Object.assign(delegate, original);
    prisma.$transaction = originalTransaction;
    if (mode === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = mode;
  }
});

test('draft image writes recheck status inside the serializable transaction', async () => {
  const mode = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalTransaction = prisma.$transaction;
  let inserts = 0;
  Object.assign(prisma, { $transaction: async (
    run: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string },
  ) => {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    return run({ listing: { findUnique: async () => databaseRecord('published') },
      listingImage: { create: async () => { inserts++; } } });
  } });
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    assert.equal(await addListingImageForSeller('race-draft', session.user.id, image, { draftOnly: true }), null);
    assert.equal(inserts, 0);
  } finally {
    Object.assign(prisma, { $transaction: originalTransaction });
    if (mode === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = mode;
  }
});
