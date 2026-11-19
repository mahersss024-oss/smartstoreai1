import assert from 'node:assert/strict';
import { beforeEach } from 'node:test';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

beforeEach(mockAllowedTextAnalysis);
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { mockImageContentReview } from './helpers/image-content';

import { createMarketplaceTools } from '@/agent/tools/marketplace';
import {
  createListingDraft,
  listSellerListings,
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

test('chat exposes no sensitive action tools even for signed-in users', () => {
  for (const session of [null, createTestSession('buyer'), { ...createTestSession('owner'), user: { ...createTestSession('owner').user, role: 'owner' as const } }]) {
    const tools = createMarketplaceTools(session);
    assert.deepEqual(Object.keys(tools).sort(), [
      'getPlatformHelp', 'createListingDraft', 'updateListing',
      'addUploadedImagesToListing', 'analyzeListingImages',
    ].sort());
    for (const name of ['setListingStatus', 'deleteListingImage', 'setPrimaryListingImage',
      'toggleFavoriteListing', 'reportMarketplaceListing', 'openMarketplaceConversation',
      'sendMessage', 'deleteAccount', 'changePermissions', 'payCommission']) {
      assert.equal(name in tools, false, name);
    }
  }
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

test('the same product title cannot create a second draft in one chat turn when details change', async () => {
  const sellerId = 'seller:duplicate-draft-turn';
  const tools = createMarketplaceTools(createTestSession(sellerId), { requestKey: 'duplicate-product-turn' });
  const create = tools.createListingDraft.execute as unknown as (
    input: Record<string, unknown>, options: Record<string, never>,
  ) => Promise<{ status: string; message: string; listing: { id: string; title: string; description?: string } }>;

  const [first, repeated] = await Promise.all([
    create({ category: 'other', title: 'Office Desk' }, {}),
    create({ category: 'other', title: 'office desk', description: 'Solid wood, confirmed by seller' }, {}),
  ]);

  assert.equal(first.status, 'draft_created');
  assert.equal(repeated.status, 'already_saved');
  assert.equal(repeated.listing.id, first.listing.id);
  assert.match(repeated.message, /Do not create it again/);
  assert.equal(listSellerListings(sellerId).length, 1);
  assert.equal(listSellerListings(sellerId)[0].description, undefined, 'new details must be added through updateListing, not silently discarded into another draft');
});

test('chat cannot change a published listing even with model-generated confirmation flags', async () => {
  const sellerId = 'seller:chat-sensitive-boundary';
  const listing = createListingDraft({ sellerId, category: 'cars', title: 'Camry for sale', price: 100 });
  publishListing(listing.id);
  const before = structuredClone(listing);
  const tools = createMarketplaceTools(createTestSession(sellerId), {
    latestUploadedImages: [{ data: new Uint8Array([1]), mediaType: 'image/png' }],
  });
  const update = tools.updateListing.execute as unknown as (
    input: Record<string, unknown>, options: Record<string, never>,
  ) => Promise<{ status: string }>;
  const attach = tools.addUploadedImagesToListing.execute as unknown as (
    input: { listingId: string }, options: Record<string, never>,
  ) => Promise<{ status: string }>;
  assert.equal((await update({ listingId: listing.id, price: 999, title: 'Changed', confirmedPriceChange: true, confirmed: true, draftOnly: false }, {})).status, 'user_action_required');
  assert.equal((await attach({ listingId: listing.id }, {})).status, 'user_action_required');
  const { getListing } = await import('@/agent/marketplace/store');
  assert.deepEqual(getListing(listing.id), before);
});

test('chat draft updates cannot inject owner identity or status fields', async () => {
  const sellerId = 'seller:chat-draft-boundary';
  const listing = createListingDraft({ sellerId, category: 'other', title: 'Desk' });
  const tools = createMarketplaceTools(createTestSession(sellerId));
  const update = tools.updateListing.execute as unknown as (
    input: Record<string, unknown>, options: Record<string, never>,
  ) => Promise<{ status: string; listing: { id: string; sellerId: string; status: string } }>;
  const result = await update({ listingId: listing.id, title: 'Prepared desk', id: 'forged', sellerId: 'attacker', status: 'published', confirmed: true }, {});
  assert.equal(result.status, 'updated');
  assert.equal(result.listing.id, listing.id);
  assert.equal(result.listing.sellerId, sellerId);
  assert.equal(result.listing.status, 'draft');
});

test('chat image attachment checks prohibited content without quality or category conditions', () => {
  const source = readFileSync(
    join(process.cwd(), 'agent', 'tools', 'marketplace.ts'),
    'utf8',
  );
  const addImagesTool = source.slice(
    source.indexOf('addUploadedImagesToListing: tool({'),
    source.indexOf('analyzeListingImages: tool({'),
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
    input: { category: string; title: string; imageIndexes: number[] }, options: Record<string, never>,
  ) => Promise<Result>;
  const add = tools.addUploadedImagesToListing.execute as unknown as (
    input: { listingId: string; imageIndexes: number[] }, options: Record<string, never>,
  ) => Promise<Result>;
  const created = await create({ category: 'cars', title: 'Car listing', imageIndexes: [0] }, {});
  assert.equal(created.status, 'draft_created');
  assert.equal(created.listing.images.length, 1);
  assert.equal(created.listing.images[0].status, 'approved');
  const attached = await add({ listingId: created.listing.id, imageIndexes: [0] }, {});
  assert.equal(attached.status, 'images_already_attached');
  assert.equal(attached.contentCheck, reviewDecision === 'unavailable' ? 'unavailable' : 'allowed');
  assert.equal(attached.listing.images.length, 1, 'reattaching the same uploaded image must not duplicate it');
  assert.ok(attached.listing.images.every(image => image.status === 'approved'));
  const other = createListingDraft({ sellerId: 'seller:other-photo-owner', category: 'cars', title: 'Other car' });
  assert.equal((await add({ listingId: other.id, imageIndexes: [0] }, {})).status, 'not_found');
  assert.equal(networkCalls(), 1, 'reuse the same content assessment when attaching the same image');
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
    input: { category: string; title: string; imageIndexes: number[] }, options: Record<string, never>,
  ) => Promise<{ status: string; message: string; listing: { images: unknown[] } }>;
  const created = await create({ category: 'other', title: 'Desk', imageIndexes: [0] }, {});
  assert.equal(created.status, 'draft_created');
  assert.equal(created.listing.images.length, 0);
  assert.match(created.message, /photos could not be saved/);
});

test('photos require an explicit source and selection and separate product drafts never inherit the whole upload', async t => {
  mockImageContentReview(t);
  const images = await Promise.all(['#ff0000', '#0000ff'].map(async background => ({
    data: new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer()),
    mediaType: 'image/png',
  })));
  const tools = createMarketplaceTools(createTestSession('seller:separate-product-photos'), {
    latestUploadedImages: images, imageSourceMessageId: 'original-photo-turn', requestKey: 'photo-selection-turn',
  });
  const create = tools.createListingDraft.execute as unknown as (
    input: Record<string, unknown>, options: Record<string, never>,
  ) => Promise<{ status: string; imageSelectionConflict?: boolean; listing?: { id: string; images: { id: string }[] } }>;
  const noSelection = await create({ category: 'other', title: 'New unrelated product' }, {});
  assert.equal(noSelection.status, 'draft_created');
  assert.equal(noSelection.listing?.images.length, 0);
  const invalid = await create({ category: 'other', title: 'Wrong source', imageIndexes: [0], imageSourceMessageId: 'different-turn' }, {});
  assert.equal(invalid.status, 'invalid_image_selection');
  assert.equal(invalid.listing, undefined);
  const outOfRange = await create({ category: 'other', title: 'Unknown index', imageIndexes: [2], imageSourceMessageId: 'original-photo-turn' }, {});
  assert.equal(outOfRange.status, 'invalid_image_selection');
  const first = await create({ category: 'other', title: 'First product', imageIndexes: [0], imageSourceMessageId: 'original-photo-turn' }, {});
  const second = await create({ category: 'other', title: 'Second product', imageIndexes: [1], imageSourceMessageId: 'original-photo-turn' }, {});
  assert.equal(first.listing?.images.length, 1);
  assert.equal(second.listing?.images.length, 1);
  assert.notEqual(first.listing?.images[0].id, second.listing?.images[0].id);
  const duplicate = await create({ category: 'other', title: 'Third unrelated product', imageIndexes: [0], imageSourceMessageId: 'original-photo-turn' }, {});
  assert.equal(duplicate.status, 'draft_created');
  assert.equal(duplicate.imageSelectionConflict, true);
  assert.equal(duplicate.listing?.images.length, 0);
});

test('a retried turn with a different product cannot attach its photo to the draft returned by the replay', async t => {
  mockImageContentReview(t);
  const sellerId = 'seller:reordered-photo-replay';
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'purple' } }).png().toBuffer();
  const create = () => createMarketplaceTools(createTestSession(sellerId), {
    requestKey: 'reordered-photo-turn',
    imageSourceMessageId: 'reordered-photo-turn',
    latestUploadedImages: [{ data, mediaType: 'image/png' }],
  }).createListingDraft.execute!;

  const toolContext = { toolCallId: 'draft', messages: [], context: {} };
  await create()({ category: 'other', title: 'Office desk' }, toolContext);
  const replay = await create()({ category: 'other', title: 'Computer monitor', imageIndexes: [0], imageSourceMessageId: 'reordered-photo-turn' }, toolContext);
  assert.ok('status' in replay);
  assert.equal(replay.status, 'already_saved');
  const drafts = listSellerListings(sellerId);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, 'Office desk');
  assert.equal(drafts[0].images.length, 0);
});

test('a photo tool distinguishes unreadable files, partial attachment, and an existing photo', async t => {
  mockImageContentReview(t);
  const sellerId = 'seller:unreadable-draft-photo';
  const draft = createListingDraft({ sellerId, category: 'other', title: 'Office desk' });
  const validPhoto = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } }).png().toBuffer();
  const tools = createMarketplaceTools(createTestSession(sellerId), {
    imageSourceMessageId: 'unreadable-photo',
    latestUploadedImages: [
      { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png' },
      { data: validPhoto, mediaType: 'image/png' },
    ],
  });
  const attach = async (imageIndexes: number[]) => {
    const result = await tools.addUploadedImagesToListing.execute!(
      { listingId: draft.id, imageIndexes, imageSourceMessageId: 'unreadable-photo' },
      { toolCallId: 'attach', messages: [], context: {} },
    );
    assert.ok('status' in result);
    assert.ok('attachedImageCount' in result);
    return result;
  };
  const result = await attach([0]);
  assert.equal(result.status, 'images_not_added');
  assert.equal(result.attachedImageCount, 0);
  const partial = await attach([0, 1]);
  assert.equal(partial.status, 'images_partially_added');
  assert.equal(partial.requestedImageCount, 2);
  assert.equal(partial.addedImageCount, 1);
  const repeated = await attach([1]);
  assert.equal(repeated.status, 'images_already_attached');
  assert.equal(repeated.attachedImageCount, 1);
  assert.equal(repeated.addedImageCount, 0);
  assert.equal(listSellerListings(sellerId)[0].images.length, 1);
});

test('the draft tool asks for an item when it only has a category or price', async () => {
  const sellerId = 'seller:missing-product';
  const tools = createMarketplaceTools(createTestSession(sellerId));
  const result = await tools.createListingDraft.execute!({ category: 'other', price: 100 }, { toolCallId: 'draft', messages: [], context: {} });
  assert.ok('status' in result);
  assert.equal(result.status, 'missing_product_details');
  assert.equal(listSellerListings(sellerId).length, 0);
});
