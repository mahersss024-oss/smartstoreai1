import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createListingImageDeliveryUrls,
  normalizeListingImageDeliveryUrls,
} from '@/agent/marketplace/listing-image-delivery';

const originalUrl =
  'https://res.cloudinary.com/demo/image/upload/v123/listings/car.jpg';

test('creates non-cropping Cloudinary delivery variants', () => {
  const urls = createListingImageDeliveryUrls(originalUrl);

  assert.equal(urls.originalUrl, originalUrl);
  assert.equal(
    urls.thumbnailUrl,
    'https://res.cloudinary.com/demo/image/upload/c_limit,w_640,h_640,q_auto:best,f_auto/v123/listings/car.jpg',
  );
  assert.equal(
    urls.displayUrl,
    'https://res.cloudinary.com/demo/image/upload/c_limit,w_1600,h_1600,q_auto:best,f_auto/v123/listings/car.jpg',
  );
  assert.ok(!urls.thumbnailUrl.includes('c_fill'));
  assert.ok(!urls.displayUrl.includes('c_fill'));
});

test('keeps non-Cloudinary image urls unchanged', () => {
  assert.deepEqual(
    createListingImageDeliveryUrls('https://images.example.com/car.jpg'),
    {
      originalUrl: 'https://images.example.com/car.jpg',
      displayUrl: 'https://images.example.com/car.jpg',
      thumbnailUrl: 'https://images.example.com/car.jpg',
    },
  );
});

test('does not apply the same delivery transformation twice', () => {
  const firstPass = createListingImageDeliveryUrls(originalUrl);
  const secondPass = createListingImageDeliveryUrls(firstPass.thumbnailUrl);

  assert.equal(secondPass.thumbnailUrl, firstPass.thumbnailUrl);
});

test('normalizes legacy Cloudinary records without changing image metadata', () => {
  const image = normalizeListingImageDeliveryUrls({
    id: 'image-1',
    originalUrl,
    displayUrl: originalUrl,
    thumbnailUrl: originalUrl,
    isPrimary: true,
  });

  assert.equal(image.id, 'image-1');
  assert.equal(image.isPrimary, true);
  assert.match(image.displayUrl, /c_limit,w_1600,h_1600/);
  assert.match(image.thumbnailUrl, /c_limit,w_640,h_640/);
});
