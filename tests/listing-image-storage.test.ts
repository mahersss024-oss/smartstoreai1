import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelMessage } from 'ai';

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

test('extracts the latest uploaded product images from prior chat context', () => {
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
  const image = images[0];

  assert.equal(images.length, 1);
  assert.ok(image);
  assert.equal(image.mediaType, 'image/png');
  assert.equal(image.fileName, 'chair.png');
  assert.deepEqual([...image.data], [1, 2, 3]);
});

test('accepts gif image payloads from chat context', () => {
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

  assert.equal(images.length, 1);
  assert.equal(images[0]?.mediaType, 'image/gif');
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

    await saveUploadedListingImagesForSeller({
      listingId: listing.id,
      sellerId: 'seller:chat-image-limit',
      images: [
        { data: new Uint8Array([4]), mediaType: 'image/png' },
        { data: new Uint8Array([5]), mediaType: 'image/png' },
      ],
    });

    const updated = listSellerListings('seller:chat-image-limit').find(
      (sellerListing) => sellerListing.id === listing.id,
    );

    assert.equal(updated?.images.length, defaultMaxListingImages);
    assert.equal(
      updated?.images.some(
        (image) => image.originalUrl === 'data:image/png;base64,BA==',
      ),
      true,
    );
    assert.equal(
      updated?.images.some(
        (image) => image.originalUrl === 'data:image/png;base64,BQ==',
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
