import assert from 'node:assert/strict';
import test from 'node:test';

import { createMarketplaceTools } from '@/agent/tools/marketplace';
import {
  addListingImageForSeller,
  createListingDraft,
} from '@/agent/marketplace/store';
import type { AuthSession } from '@/lib/auth/session';

function createTestSession(userId: string): AuthSession {
  return {
    user: {
      id: userId,
      email: `${userId}@example.test`,
      name: userId,
    },
    issuedAt: 1,
    expiresAt: 9999999999,
  };
}

test('publishes the latest matching seller draft when listingId is omitted', async () => {
  const sellerId = 'seller:tool-publish-current-draft';
  const listing = createListingDraft({
    sellerId,
    category: 'cars',
    title: 'Toyota Camry',
  });

  addListingImageForSeller(listing.id, sellerId, {
    id: 'tool-publish-current-draft-image',
    listingId: listing.id,
    originalUrl: 'https://images.example.test/camry-original.jpg',
    displayUrl: 'https://images.example.test/camry-display.jpg',
    thumbnailUrl: 'https://images.example.test/camry-thumb.jpg',
    isPrimary: true,
    qualityScore: 92,
    status: 'approved',
    enhancements: [],
  });

  const tools = createMarketplaceTools(createTestSession(sellerId));
  const executeSetListingStatus = tools.setListingStatus.execute as unknown as (
    input: { status: 'published' },
    options: Record<string, never>,
  ) => Promise<{ status: string; listingUrl?: string; listing: { id: string } }>;
  const result = await executeSetListingStatus(
    { status: 'published' },
    {},
  );

  assert.equal(result?.status, 'published');
  assert.equal(result?.listing.id, listing.id);
  assert.equal(
    result?.listingUrl,
    `http://localhost:3000/listings/${encodeURIComponent(listing.id)}`,
  );
});

test('marketplace tools do not let assistant chat open buyer seller conversations', () => {
  const tools = createMarketplaceTools(createTestSession('buyer:no-chat-open'));

  assert.equal('openMarketplaceConversation' in tools, false);
});

test('adds many follow-up details to the current draft when listingId is omitted', async () => {
  const sellerId = 'seller:tool-update-current-draft';
  const listing = createListingDraft({
    sellerId,
    category: 'cars',
    title: 'Camry for sale',
    attributes: {
      brand: 'Toyota',
    },
  });

  const tools = createMarketplaceTools(createTestSession(sellerId));
  const executeUpdateListing = tools.updateListing.execute as unknown as (
    input: {
      price: number;
      city: string;
      condition: 'used';
      attributes: Record<string, unknown>;
    },
    options: Record<string, never>,
  ) => Promise<{
    status: string;
    listing: {
      id: string;
      price?: number | 'bid' | 'negotiable';
      city?: string;
      condition?: string;
      attributes: Record<string, unknown>;
    };
  }>;

  const result = await executeUpdateListing(
    {
      price: 85000,
      city: 'Riyadh',
      condition: 'used',
      attributes: {
        model: 'Camry',
        year: 2020,
        mileageKm: 90000,
        transmission: 'automatic',
        fuelType: 'gasoline',
        exteriorColor: 'white',
        interiorColor: 'beige',
        bodyCondition: 'clean',
        accidentHistory: 'none_reported',
        ownership: 'first_owner',
        warranty: 'expired',
        serviceHistory: 'available',
        tireCondition: 'good',
        batteryCondition: 'good',
        inspectionStatus: 'valid',
        registrationStatus: 'valid',
        saleTerms: 'fixed',
        accessories: ['spare_key', 'floor_mats'],
        defects: 'no known defects',
        sellerNotes: 'ready for inspection',
      },
    },
    {},
  );

  assert.equal(result.status, 'updated');
  assert.equal(result.listing.id, listing.id);
  assert.equal(result.listing.price, 85000);
  assert.equal(result.listing.city, 'Riyadh');
  assert.equal(result.listing.condition, 'used');
  assert.equal(result.listing.attributes.brand, 'Toyota');
  assert.equal(result.listing.attributes.model, 'Camry');
  assert.equal(result.listing.attributes.year, 2020);
  assert.deepEqual(result.listing.attributes.accessories, [
    'spare_key',
    'floor_mats',
  ]);
});
