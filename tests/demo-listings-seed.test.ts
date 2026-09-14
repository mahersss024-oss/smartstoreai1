import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDemoListingSeed,
  createDemoListingImageDataUrl,
  demoDatasetId,
  demoListingCategories,
} from '@/scripts/demo-listing-data';

test('demo listing seed covers every marketplace category', () => {
  const seed = buildDemoListingSeed(1000, 20);
  const categories = new Set(seed.map((entry) => entry.listing.category));

  assert.equal(seed.length, 1000);
  assert.equal(categories.size, demoListingCategories.length);

  for (const category of demoListingCategories) {
    assert.ok(categories.has(category.category));
  }
});

test('demo listing seed keeps sellers under the configured per-seller count', () => {
  const seed = buildDemoListingSeed(1000, 20);
  const sellerCounts = new Map<string, number>();

  for (const entry of seed) {
    sellerCounts.set(entry.seller.id, (sellerCounts.get(entry.seller.id) ?? 0) + 1);
  }

  assert.ok(sellerCounts.size > 1);
  assert.ok([...sellerCounts.values()].every((count) => count <= 20));
});

test('demo listing records are clearly marked as test data', () => {
  const [firstEntry] = buildDemoListingSeed(1, 20);

  assert.ok(firstEntry);
  assert.match(firstEntry.listing.title ?? '', /^\[تجريبي\]/);
  assert.equal(firstEntry.listing.attributes?.demoDataset, demoDatasetId);
  assert.equal(firstEntry.listing.attributes?.demo, true);
});

test('demo listing image data includes a visible test watermark', () => {
  const [firstEntry] = buildDemoListingSeed(1, 20);

  assert.ok(firstEntry);

  const dataUrl = createDemoListingImageDataUrl(firstEntry);
  const [, base64Payload] =
    dataUrl.match(/^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/) ?? [];
  const svg = Buffer.from(base64Payload ?? '', 'base64').toString('utf8');

  assert.match(svg, /تجريبي/);
  assert.match(svg, new RegExp(firstEntry.categoryLabel));
  assert.match(svg, /SmartStore AI Demo/);
});
