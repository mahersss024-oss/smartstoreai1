import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { mockImageContentReview } from './helpers/image-content';

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

test('chat image attachment checks prohibited content without quality or category conditions', () => {
  const source = readFileSync(
    join(process.cwd(), 'agent', 'tools', 'marketplace.ts'),
    'utf8',
  );
  const addImagesTool = source.slice(
    source.indexOf('addUploadedImagesToListing: tool({'),
    source.indexOf('deleteListingImage: tool({'),
  );

  assert.doesNotMatch(addImagesTool, /checkImageMarketplaceCompliance/);
  assert.match(addImagesTool, /reviewListingImageContent/);
  assert.doesNotMatch(addImagesTool, /status: 'image_review_unavailable'|status: 'blocked'|status: 'needs_review'/);
  assert.match(addImagesTool, /targetListing.sellerId !== session.user.id/);
  assert.match(addImagesTool, /saveUploadedListingImagesForSeller/);
});

for (const reviewDecision of ['needs_review', 'unavailable'] as const) {
test(`chat creation and attachment continue when content review is ${reviewDecision}`, async (t) => {
  const session = createTestSession(`seller:chat-images-${reviewDecision}`);
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#000000' } }).png().toBuffer();
  const networkCalls = mockImageContentReview(t, reviewDecision);
  const tools = createMarketplaceTools(session, {
    latestUploadedImages: [{ data: new Uint8Array(data), mediaType: 'image/png' }],
  });
  type Result = { status: string; contentCheck?: string; listing: { id: string; images: { status: string }[] } };
  const create = tools.createListingDraft.execute as unknown as (
    input: { category: string; title: string }, options: Record<string, never>,
  ) => Promise<Result>;
  const add = tools.addUploadedImagesToListing.execute as unknown as (
    input: { listingId: string }, options: Record<string, never>,
  ) => Promise<Result>;
  const created = await create({ category: 'cars', title: 'Car listing' }, {});
  assert.equal(created.status, 'draft_created');
  assert.equal(created.listing.images.length, 1);
  assert.equal(created.listing.images[0].status, 'approved');
  const attached = await add({ listingId: created.listing.id }, {});
  assert.equal(attached.status, 'images_added');
  assert.equal(attached.contentCheck, reviewDecision === 'unavailable' ? 'unavailable' : 'allowed');
  assert.equal(attached.listing.images.length, 2);
  assert.ok(attached.listing.images.every(image => image.status === 'approved'));
  const other = createListingDraft({ sellerId: 'seller:other-photo-owner', category: 'cars', title: 'Other car' });
  assert.equal((await add({ listingId: other.id }, {})).status, 'not_found');
  assert.equal(networkCalls(), 2);
});
}

test('chat draft survives optional object-storage failure without pretending photos were saved', async (t) => {
  const previousMode = process.env.SMARTSTORE_IMAGE_STORAGE;
  const previousEndpoint = process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT;
  process.env.SMARTSTORE_IMAGE_STORAGE = 'object';
  delete process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT;
  t.after(() => {
    if (previousMode === undefined) delete process.env.SMARTSTORE_IMAGE_STORAGE;
    else process.env.SMARTSTORE_IMAGE_STORAGE = previousMode;
    if (previousEndpoint === undefined) delete process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT;
    else process.env.SMARTSTORE_OBJECT_STORAGE_ENDPOINT = previousEndpoint;
  });
  mockImageContentReview(t);
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const tools = createMarketplaceTools(createTestSession('seller:photo-storage-outage'), {
    latestUploadedImages: [{ data: new Uint8Array(data), mediaType: 'image/png' }],
  });
  const create = tools.createListingDraft.execute as unknown as (
    input: { category: string; title: string }, options: Record<string, never>,
  ) => Promise<{ status: string; message: string; listing: { images: unknown[] } }>;
  const created = await create({ category: 'other', title: 'Desk' }, {});
  assert.equal(created.status, 'draft_created');
  assert.equal(created.listing.images.length, 0);
  assert.match(created.message, /photos could not be saved/);
});
