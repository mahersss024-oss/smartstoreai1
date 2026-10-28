import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { ModelMessage } from 'ai';
import sharp from 'sharp';

import { POST as uploadListingImage } from '@/app/api/marketplace/listings/[listingId]/images/route';
import {
  canUseImageDataUrlFallback,
  createPersistentImageDataUrl,
  createPersistentListingImageUrl,
  extractLatestUploadedListingImages,
  saveUploadedListingImagesForSeller,
} from '@/agent/marketplace/listing-image-storage';
import { defaultMaxListingImages } from '@/agent/marketplace/listing-image-limits';
import {
  addListingImageForSeller,
  createListingDraft,
  listSellerListings,
} from '@/agent/marketplace/store';
import { createSessionCookie } from '@/lib/auth/session';
import { mockImageContentReview } from './helpers/image-content';

test('does not implicitly extract an earlier product photo from a text-only follow-up', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'للنشر كرسي مكتب في تبوك' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: new Uint8Array([1, 2, 3]),
          filename: 'chair.png',
        },
      ],
    },
    {
      role: 'assistant',
      content: 'الصورة مناسبة، هل تعتمد الإعلان؟',
    },
    {
      role: 'user',
      content: [{ type: 'text', text: 'اعتمد الإعلان' }],
    },
  ];

  const images = extractLatestUploadedListingImages(messages);
  assert.equal(images.length, 0);
  const currentUpload = extractLatestUploadedListingImages(messages.slice(0, 2));
  const image = currentUpload[0];
  assert.equal(currentUpload.length, 1);
  assert.ok(image);
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.fileName, 'chair.png');
  assert.deepEqual([...image.data], [1, 2, 3]);
});

test('rejects gif image payloads from chat context', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'image/gif',
          data: new Uint8Array([1]),
        },
      ],
    },
  ];

  const images = extractLatestUploadedListingImages(messages);

  assert.equal(images.length, 0);
});

test('ignores unsupported non-image payloads', () => {
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: new Uint8Array([1]),
        },
      ],
    },
  ];

  assert.deepEqual(extractLatestUploadedListingImages(messages), []);
});

test('creates a persistent image data URL for database-backed listings', () => {
  const url = createPersistentImageDataUrl(
    new Uint8Array([1, 2, 3]),
    'image/png',
  );

  assert.equal(url, 'data:image/png;base64,AQID');
});

test('disables listing image data URL fallback in production', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousStorage = env.SMARTSTORE_IMAGE_STORAGE;
  env.NODE_ENV = 'production';
  delete env.SMARTSTORE_IMAGE_STORAGE;

  try {
    assert.equal(canUseImageDataUrlFallback(), false);
    await assert.rejects(
      createPersistentListingImageUrl({
        data: new Uint8Array([1, 2, 3]),
        mediaType: 'image/png',
        imageId: 'production-image',
      }),
      /object storage is required in production/,
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete env.NODE_ENV;
    } else {
      env.NODE_ENV = previousNodeEnv;
    }

    if (previousStorage === undefined) {
      delete env.SMARTSTORE_IMAGE_STORAGE;
    } else {
      env.SMARTSTORE_IMAGE_STORAGE = previousStorage;
    }
  }
});

test('returns a controlled error for malformed listing image uploads', async () => {
  const listing = createListingDraft({
    sellerId: 'seller:malformed-image-upload',
    category: 'cars',
    title: 'Malformed upload listing',
  });
  const response = await uploadListingImage(
    new Request(
      `https://smartstore.test/api/marketplace/listings/${listing.id}/images`,
      {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=broken',
          cookie: createSessionCookie({
            id: 'seller:malformed-image-upload',
            email: 'malformed-upload@example.com',
          }),
        },
        body: 'not-a-valid-multipart-body',
      },
    ),
    { params: Promise.resolve({ listingId: listing.id }) },
  );
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_multipart_form_data');
});

for (const reviewDecision of ['allow', 'needs_review', 'unavailable'] as const) {
test(`manual upload ignores ${reviewDecision} model availability, accepts eight images and rejects the ninth`, async (t) => {
  const listing = createListingDraft({
    sellerId: `seller:unconditional-images-${reviewDecision}`, category: 'cars', title: 'Car listing',
  });
  const cookie = createSessionCookie({ id: listing.sellerId, email: 'images@example.test' });
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#000000' } }).png().toBuffer();
  const networkCalls = mockImageContentReview(t, reviewDecision);
  for (let index = 0; index < defaultMaxListingImages; index++) {
    const data = new FormData();
    data.set('image', new File([bytes], `small-${index}.png`, { type: 'image/png' }));
    data.set('isRelevantToListing', 'false');
    data.set('hasDetectedSensitiveInfo', 'true');
    const response = await uploadListingImage(new Request(
      `https://smartstore.test/api/marketplace/listings/${listing.id}/images`,
      { method: 'POST', headers: { cookie }, body: data },
    ), { params: Promise.resolve({ listingId: listing.id }) });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.image.status, 'approved');
    assert.equal(body.contentCheck, 'not_checked');
    assert.equal(body.compliance, null);
    assert.equal(body.image.contentReviewStatus, 'not_checked');
    assert.ok(body.image.thumbnailUrl);
    assert.ok(body.image.displayUrl);
  }
  const response = await uploadListingImage(new Request(
    `https://smartstore.test/api/marketplace/listings/${listing.id}/images`,
    { method: 'POST', headers: { cookie } },
  ), { params: Promise.resolve({ listingId: listing.id }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'listing_image_limit_reached');
  assert.equal(networkCalls(), 0, 'manual image upload never requests model assessment');
  assert.equal(listSellerListings(listing.sellerId)[0].images.length, defaultMaxListingImages);
});
}

test('manual image upload never requests a content model even when provider would reject', async (t) => {
  const networkCalls = mockImageContentReview(t, 'block');
  const listing = createListingDraft({ sellerId: 'seller:blocked-image', category: 'other', title: 'Desk' });
  addListingImageForSeller(listing.id, listing.sellerId, {
    id: 'approved-before-block', listingId: listing.id,
    originalUrl: 'https://example.com/a.jpg', displayUrl: 'https://example.com/a.jpg', thumbnailUrl: 'https://example.com/a.jpg',
    status: 'approved', qualityScore: 90, isPrimary: true, enhancements: [],
  });
  const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const data = new FormData();
  data.set('image', new File([bytes], 'product.png', { type: 'image/png' }));
  const response = await uploadListingImage(new Request(
    `https://smartstore.test/api/marketplace/listings/${listing.id}/images`,
    { method: 'POST', headers: { cookie: createSessionCookie({ id: listing.sellerId, email: 'blocked@example.test' }) }, body: data },
  ), { params: Promise.resolve({ listingId: listing.id }) });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.compliance, null);
  assert.equal(payload.contentCheck, 'not_checked');
  assert.equal(payload.image.contentReviewStatus, 'not_checked');
  assert.equal(networkCalls(), 0);
  assert.equal(listSellerListings(listing.sellerId)[0].images.length, 2);
});

test('rejects listing image uploads when declared type does not match bytes', async () => {
  const listing = createListingDraft({
    sellerId: 'seller:spoofed-image-upload',
    category: 'cars',
    title: 'Spoofed upload listing',
  });
  addListingImageForSeller(listing.id, 'seller:spoofed-image-upload', {
    id: 'existing-approved-primary-image',
    listingId: listing.id,
    originalUrl: 'https://example.com/existing.jpg',
    displayUrl: 'https://example.com/existing-display.webp',
    thumbnailUrl: 'https://example.com/existing-thumbnail.webp',
    isPrimary: true,
    qualityScore: 90,
    status: 'approved',
    enhancements: [],
  });
  const jpegBytes = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: '#ffffff',
    },
  })
    .jpeg()
    .toBuffer();
  const formData = new FormData();
  formData.set(
    'image',
    new File([jpegBytes], 'spoofed.png', { type: 'image/png' }),
  );

  const response = await uploadListingImage(
    new Request(
      `https://smartstore.test/api/marketplace/listings/${listing.id}/images`,
      {
        method: 'POST',
        headers: {
          cookie: createSessionCookie({
            id: 'seller:spoofed-image-upload',
            email: 'spoofed-upload@example.com',
          }),
        },
        body: formData,
      },
    ),
    { params: Promise.resolve({ listingId: listing.id }) },
  );
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 415);
  assert.equal(body.error, 'image_type_mismatch');
});

test('rejects non-image bytes even with an image file extension', async () => {
  const listing = createListingDraft({
    sellerId: 'seller:invalid-chat-image',
    category: 'cars',
    title: 'Invalid chat image listing',
  });

  await saveUploadedListingImagesForSeller({
    listingId: listing.id,
    sellerId: 'seller:invalid-chat-image',
    images: [
      {
        data: new Uint8Array([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74]),
        mediaType: 'image/png',
        fileName: 'payload.png',
      },
    ],
  });

  const updated = listSellerListings('seller:invalid-chat-image').find(
    (sellerListing) => sellerListing.id === listing.id,
  );

  assert.equal(updated?.images.length, 0);
});

test('database listing image writes use serializable transactions', () => {
  const repository = readFileSync(
    'agent/marketplace/repository.ts',
    'utf8',
  );

  assert.match(repository, /addListingImageForSeller/);
  assert.match(repository, /prisma\.\$transaction/);
  assert.match(repository, /TransactionIsolationLevel\.Serializable/);
});

test('saves only the remaining available image slots for chat uploads', async () => {
  const originalLimit = process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
  process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = String(defaultMaxListingImages);

  try {
    const listing = createListingDraft({
      sellerId: 'seller:chat-image-limit',
      category: 'cars',
      title: 'Toyota Camry chat image limit',
    });

    for (let index = 0; index < defaultMaxListingImages - 1; index += 1) {
      addListingImageForSeller(listing.id, 'seller:chat-image-limit', {
        id: `chat-image-existing-${index}`,
        listingId: listing.id,
        originalUrl: `https://example.com/existing-${index}.jpg`,
        displayUrl: `https://example.com/existing-${index}.jpg`,
        thumbnailUrl: `https://example.com/existing-${index}.jpg`,
        isPrimary: index === 0,
        qualityScore: 90,
        status: 'approved',
        enhancements: [],
      });
    }

    const firstImage = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: '#ffffff',
      },
    })
      .png()
      .toBuffer();
    const secondImage = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: '#eeeeee',
      },
    })
      .png()
      .toBuffer();

    await saveUploadedListingImagesForSeller({
      listingId: listing.id,
      sellerId: 'seller:chat-image-limit',
      images: [
        { data: new Uint8Array(firstImage), mediaType: 'image/png' },
        { data: new Uint8Array(secondImage), mediaType: 'image/png' },
      ],
    });

    const updated = listSellerListings('seller:chat-image-limit').find(
      (sellerListing) => sellerListing.id === listing.id,
    );

    assert.equal(updated?.images.length, defaultMaxListingImages);
    assert.equal(
      updated?.images.some(
        (image) => image.originalUrl.startsWith('data:image/webp;base64,'),
      ),
      true,
    );
    assert.equal(
      updated?.images.some(
        (image) =>
          image.originalUrl.startsWith('data:image/png;base64,') ||
          image.originalUrl.includes('BQ=='),
      ),
      false,
    );
  } finally {
    if (originalLimit === undefined) {
      delete process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
    } else {
      process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING = originalLimit;
    }
  }
});
