import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { createMarketplaceTools } from '@/agent/tools/marketplace';
import {
  addListingImageForSeller,
  createListingDraft,
  publishListing,
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

test('pauses the latest matching seller listing when listingId is omitted', async () => {
  const sellerId = 'seller:tool-pause-current-listing';
  const listing = createListingDraft({
    sellerId,
    category: 'cars',
    title: 'Toyota Camry',
  });

  addListingImageForSeller(listing.id, sellerId, {
    id: 'tool-pause-current-listing-image',
    listingId: listing.id,
    originalUrl: 'https://images.example.test/camry-original.jpg',
    displayUrl: 'https://images.example.test/camry-display.jpg',
    thumbnailUrl: 'https://images.example.test/camry-thumb.jpg',
    isPrimary: true,
    qualityScore: 92,
    status: 'approved',
    enhancements: [],
  });
  publishListing(listing.id);

  const tools = createMarketplaceTools(createTestSession(sellerId));
  const executeSetListingStatus = tools.setListingStatus.execute as unknown as (
    input: { status: 'paused'; confirmed: boolean },
    options: Record<string, never>,
  ) => Promise<{ status: string; listingUrl?: string; listing: { id: string } }>;
  const result = await executeSetListingStatus(
    { status: 'paused', confirmed: true },
    {},
  );

  assert.equal(result?.status, 'paused');
  assert.equal(result?.listing.id, listing.id);
  assert.equal(result?.listingUrl, undefined);
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
      confirmedPriceChange: boolean;
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
      confirmedPriceChange: true,
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

test('sensitive marketplace tools require explicit confirmation flags', async () => {
  const sellerId = 'seller:tool-confirmation-lock';
  const listing = createListingDraft({
    sellerId,
    category: 'cars',
    title: 'Confirmed Camry',
  });

  addListingImageForSeller(listing.id, sellerId, {
    id: 'tool-confirmation-image',
    listingId: listing.id,
    originalUrl: 'https://images.example.test/confirmed-original.jpg',
    displayUrl: 'https://images.example.test/confirmed-display.jpg',
    thumbnailUrl: 'https://images.example.test/confirmed-thumb.jpg',
    isPrimary: true,
    qualityScore: 88,
    status: 'approved',
    enhancements: [],
  });
  publishListing(listing.id);

  const tools = createMarketplaceTools(createTestSession(sellerId));
  const executeSetListingStatus = tools.setListingStatus.execute as unknown as (
    input: { listingId: string; status: 'paused'; confirmed: boolean },
    options: Record<string, never>,
  ) => Promise<{ status: string; message: string }>;
  const executeDeleteListingImage = tools.deleteListingImage.execute as unknown as (
    input: { listingId: string; imageId: string; confirmed: boolean },
    options: Record<string, never>,
  ) => Promise<{ status: string; message: string }>;
  const executeUpdateListing = tools.updateListing.execute as unknown as (
    input: { listingId: string; price: number; confirmedPriceChange?: boolean },
    options: Record<string, never>,
  ) => Promise<{ status: string; message: string }>;

  const pauseResult = await executeSetListingStatus(
    { listingId: listing.id, status: 'paused', confirmed: false },
    {},
  );
  const imageDeleteResult = await executeDeleteListingImage(
    { listingId: listing.id, imageId: 'tool-confirmation-image', confirmed: false },
    {},
  );
  const priceResult = await executeUpdateListing(
    { listingId: listing.id, price: 87000 },
    {},
  );

  assert.equal(pauseResult.status, 'needs_confirmation');
  assert.match(pauseResult.message, /Confirm/);
  assert.equal(imageDeleteResult.status, 'needs_confirmation');
  assert.match(imageDeleteResult.message, /Confirm/);
  assert.equal(priceResult.status, 'needs_confirmation');
  assert.match(priceResult.message, /Confirm/);
});

test('chat image attachment tool rechecks retained images before saving', () => {
  const source = readFileSync(
    join(process.cwd(), 'agent', 'tools', 'marketplace.ts'),
    'utf8',
  );
  const addImagesTool = source.slice(
    source.indexOf('addUploadedImagesToListing: tool({'),
    source.indexOf('deleteListingImage: tool({'),
  );

  assert.match(addImagesTool, /checkImageMarketplaceCompliance/);
  assert.match(addImagesTool, /status: 'image_review_unavailable'/);
  assert.match(addImagesTool, /status: 'blocked'/);
  assert.match(addImagesTool, /status: 'needs_review'/);
  assert.match(addImagesTool, /saveUploadedListingImagesForSeller/);
});
