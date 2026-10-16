import assert from 'node:assert/strict';
import test from 'node:test';

import { hardMaxListingImages } from '@/agent/marketplace/listing-image-limits';
import type { ListingImage } from '@/agent/marketplace/types';

function shouldRunDatabaseIntegration() {
  return (
    Boolean(process.env.DATABASE_URL?.trim()) &&
    (process.env.SMARTSTORE_DB_INTEGRATION === '1' ||
      process.env.npm_lifecycle_event === 'test:db:integration')
  );
}

test('future first-publication timestamps survive concurrent publish, edits and republication without enrolling legacy rows', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = crypto.randomUUID();
  const seller = { id: `publication-seller-${suffix}`, email: `publication-${suffix}@smartstore.local` };
  const { prisma } = await import('@/lib/db/prisma');
  try {
    const repository = await import('@/agent/marketplace/repository');
    const listing = await repository.createListingDraft(seller, { category: 'other', title: 'Desk' });
    assert.equal(listing.firstPublicationTracked, true);
    assert.equal(listing.firstPublishedAt, undefined);
    await prisma.listingImage.create({ data: {
      listingId: listing.id, originalUrl: 'https://example.com/desk.webp',
      displayUrl: 'https://example.com/desk.webp', thumbnailUrl: 'https://example.com/desk.webp',
      status: 'approved', qualityScore: 95,
    } });
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      repository.setListingStatusForSeller(listing.id, seller.id, 'published')));
    const firstPublishedAt = results[0]!.firstPublishedAt;
    assert.ok(firstPublishedAt);
    assert.ok(results.every(result => result?.firstPublishedAt === firstPublishedAt));
    await repository.updateListingForSeller(listing.id, seller.id, { title: 'Updated desk' });
    await repository.setListingStatusForSeller(listing.id, seller.id, 'paused');
    const republished = await repository.setListingStatusForSeller(listing.id, seller.id, 'published');
    assert.equal(republished?.firstPublishedAt, firstPublishedAt);
    assert.equal(republished?.createdAt, listing.createdAt);

    const legacy = await prisma.listing.create({ data: {
      sellerId: seller.id, category: 'other', title: 'Legacy desk', status: 'paused',
      compliance: { decision: 'allow', reasons: [] },
      images: { create: {
        originalUrl: 'https://example.com/old.webp', displayUrl: 'https://example.com/old.webp',
        thumbnailUrl: 'https://example.com/old.webp', status: 'approved', qualityScore: 95,
      } },
    } });
    assert.equal(legacy.firstPublicationTracked, false);
    const legacyPublished = await repository.setListingStatusForSeller(legacy.id, seller.id, 'published');
    assert.equal(legacyPublished?.firstPublishedAt, undefined);
    assert.equal(legacyPublished?.firstPublicationTracked, false);
    const feed = await repository.listMarketplaceListings({ take: 80 });
    const newIndex = feed.findIndex(item => item.id === listing.id);
    const legacyIndex = feed.findIndex(item => item.id === legacy.id);
    if (legacyIndex !== -1) assert.ok(newIndex !== -1 && newIndex < legacyIndex);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

function createImage(index: number, listingId: string): ListingImage {
  return {
    id: `db-integration-image-${Date.now()}-${index}`,
    listingId,
    originalUrl: `https://example.com/db-integration-${index}.jpg`,
    displayUrl: `https://example.com/db-integration-${index}.jpg`,
    thumbnailUrl: `https://example.com/db-integration-${index}.jpg`,
    isPrimary: false,
    qualityScore: 95,
    status: 'approved',
    enhancements: [],
  };
}

test('database listing reports remain unique under concurrent requests', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = crypto.randomUUID();
  const seller = { id: `report-seller-${suffix}`, email: `seller-${suffix}@smartstore.local` };
  const buyer = `report-buyer-${suffix}`;
  const { prisma } = await import('@/lib/db/prisma');
  let listingId: string | undefined;
  try {
    const repository = await import('@/agent/marketplace/repository');
    const listing = await repository.createListingDraft(seller, { category: 'other', title: 'Desk' });
    listingId = listing.id;
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'published' } });
    await prisma.user.upsert({ where: { id: buyer }, update: {}, create: { id: buyer, email: `${buyer}@smartstore.local` } });
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      repository.reportListing(listing.id, buyer, 'fraud')));
    assert.equal(new Set(results.map(result => result.report?.id)).size, 1);
    assert.equal(await prisma.report.count({ where: { listingId, reporterId: buyer } }), 1);
    assert.equal(await repository.hasReportedListing(listing.id, buyer), true);
  } finally {
    if (listingId) {
      const cases = await prisma.evidenceCase.findMany({ where: { listingId }, select: { id: true } });
      const ids = cases.map(item => item.id);
      await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposing' } });
      await prisma.evidenceEvent.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.evidenceAsset.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposed', snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null } });
      await prisma.evidenceCase.deleteMany({ where: { id: { in: ids } } });
      await prisma.listing.deleteMany({ where: { id: listingId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer] } } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database image writes keep listing images within the hard limit under concurrency', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }

  const env = process.env as Record<string, string | undefined>;
  const previousStore = env.SMARTSTORE_MARKETPLACE_STORE;
  const previousImageLimit = env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
  const seller = {
    id: `db-integration-seller-${Date.now()}`,
    email: `db-integration-${Date.now()}@smartstore.local`,
  };
  let listingId: string | null = null;

  env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  env.SMARTSTORE_MAX_IMAGES_PER_LISTING = String(hardMaxListingImages);

  try {
    const [{ prisma }, repository] = await Promise.all([
      import('@/lib/db/prisma'),
      import('@/agent/marketplace/repository'),
    ]);
    const listing = await repository.createListingDraft(seller, {
      category: 'cars',
      title: 'DB integration image limit listing',
      description: 'Synthetic listing used by the optional database integration test.',
      city: 'Riyadh',
      price: 1000,
    });
    listingId = listing.id;

    await Promise.all(
      Array.from({ length: hardMaxListingImages + 6 }, (_, index) =>
        repository.addListingImageForSeller(
          listing.id,
          seller.id,
          createImage(index, listing.id),
        ),
      ),
    );

    const updated = await repository.getListing(listing.id);

    assert.equal(updated?.images.length, hardMaxListingImages);
    assert.equal(
      updated?.images.filter((image) => image.isPrimary).length,
      1,
    );

    await prisma.$disconnect();
  } finally {
    try {
      const { prisma } = await import('@/lib/db/prisma');

      if (listingId) {
        await prisma.listing.deleteMany({ where: { id: listingId } });
      }

      await prisma.user.deleteMany({ where: { id: seller.id } });
      await prisma.$disconnect();
    } finally {
      if (previousStore === undefined) {
        delete env.SMARTSTORE_MARKETPLACE_STORE;
      } else {
        env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
      }

      if (previousImageLimit === undefined) {
        delete env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
      } else {
        env.SMARTSTORE_MAX_IMAGES_PER_LISTING = previousImageLimit;
      }
    }
  }
});

test('database favorite toggles keep the counter consistent under concurrency', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }

  const env = process.env as Record<string, string | undefined>;
  const previousStore = env.SMARTSTORE_MARKETPLACE_STORE;
  const seller = {
    id: `db-integration-favorite-seller-${Date.now()}`,
    email: `db-integration-favorite-seller-${Date.now()}@smartstore.local`,
  };
  const buyer = {
    id: `db-integration-favorite-buyer-${Date.now()}`,
    email: `db-integration-favorite-buyer-${Date.now()}@smartstore.local`,
  };
  let listingId: string | null = null;

  env.SMARTSTORE_MARKETPLACE_STORE = 'database';

  try {
    const [{ prisma }, repository] = await Promise.all([
      import('@/lib/db/prisma'),
      import('@/agent/marketplace/repository'),
    ]);
    const listing = await repository.createListingDraft(seller, {
      category: 'cars',
      title: 'DB integration favorite race listing',
      description: 'Synthetic listing used by the optional favorite race test.',
      city: 'Riyadh',
      price: 1000,
    });
    listingId = listing.id;

    await repository.addListingImageForSeller(
      listing.id,
      seller.id,
      createImage(1, listing.id),
    );
    await repository.setListingStatusForSeller(
      listing.id,
      seller.id,
      'published',
    );

    await Promise.all([
      repository.toggleFavoriteListing(listing.id, buyer),
      repository.toggleFavoriteListing(listing.id, buyer),
    ]);

    const [favoriteCount, updatedListing] = await Promise.all([
      prisma.favorite.count({ where: { listingId: listing.id } }),
      repository.getListing(listing.id),
    ]);

    assert.equal(favoriteCount, 0);
    assert.equal(updatedListing?.favoriteCount, favoriteCount);

    await prisma.$disconnect();
  } finally {
    try {
      const { prisma } = await import('@/lib/db/prisma');

      if (listingId) {
        await prisma.listing.deleteMany({ where: { id: listingId } });
      }

      await prisma.user.deleteMany({
        where: { id: { in: [seller.id, buyer.id] } },
      });
      await prisma.$disconnect();
    } finally {
      if (previousStore === undefined) {
        delete env.SMARTSTORE_MARKETPLACE_STORE;
      } else {
        env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
      }
    }
  }
});
