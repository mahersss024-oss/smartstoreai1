import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createListingImageDeliveryUrls,
  normalizeListingImageDeliveryUrls,
} from '@/agent/marketplace/listing-image-delivery';

test('uses the stored object storage url for every delivery variant', () => {
  const originalUrl = 'https://images.example.com/listings/2026/09/car.jpg';

  assert.deepEqual(createListingImageDeliveryUrls(originalUrl), {
    originalUrl,
    displayUrl: originalUrl,
    thumbnailUrl: originalUrl,
  });
});

test('normalizes records to the stored object storage url without provider transforms', () => {
  const originalUrl = 'https://images.example.com/listings/2026/09/car.jpg';
  const image = normalizeListingImageDeliveryUrls({
    id: 'image-1',
    originalUrl,
    displayUrl: 'https://legacy.example.com/display.jpg',
    thumbnailUrl: 'https://legacy.example.com/thumb.jpg',
    isPrimary: true,
  });

  assert.deepEqual(image, {
    id: 'image-1',
    originalUrl,
    displayUrl: originalUrl,
    thumbnailUrl: originalUrl,
    isPrimary: true,
  });
});
