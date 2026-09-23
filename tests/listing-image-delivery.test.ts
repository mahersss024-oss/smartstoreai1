import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createListingImageDeliveryUrls,
  normalizeListingImageDeliveryUrls,
} from '@/agent/marketplace/listing-image-delivery';

test('uses the stored object storage url as a fallback for every delivery variant', () => {
  const originalUrl = 'https://images.example.com/listings/2026/09/car.jpg';

  assert.deepEqual(createListingImageDeliveryUrls(originalUrl), {
    originalUrl,
    displayUrl: originalUrl,
    thumbnailUrl: originalUrl,
  });
});

test('uses explicit display and thumbnail delivery variants when present', () => {
  const originalUrl = 'https://images.example.com/listings/2026/09/car.jpg';
  const displayUrl = 'https://images.example.com/listings/2026/09/car-display.jpg';
  const thumbnailUrl =
    'https://images.example.com/listings/2026/09/car-thumbnail.jpg';

  assert.deepEqual(
    createListingImageDeliveryUrls(originalUrl, {
      displayUrl,
      thumbnailUrl,
    }),
    {
      originalUrl,
      displayUrl,
      thumbnailUrl,
    },
  );
});

test('normalizes records while preserving stored delivery variants', () => {
  const originalUrl = 'https://images.example.com/listings/2026/09/car.jpg';
  const displayUrl = 'https://legacy.example.com/display.jpg';
  const thumbnailUrl = 'https://legacy.example.com/thumb.jpg';
  const image = normalizeListingImageDeliveryUrls({
    id: 'image-1',
    originalUrl,
    displayUrl,
    thumbnailUrl,
    isPrimary: true,
  });

  assert.deepEqual(image, {
    id: 'image-1',
    originalUrl,
    displayUrl,
    thumbnailUrl,
    isPrimary: true,
  });
});
