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
