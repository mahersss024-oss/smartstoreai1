import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';

import {
  createListingImageVariants,
  listingDisplayMaxDimension,
  listingThumbnailMaxDimension,
} from '@/agent/marketplace/listing-image-variants';
import {
  getListingDisplayUrl,
  getListingFullUrl,
  getListingThumbnailUrl,
} from '@/agent/marketplace/listing-image-delivery';

test('creates independent webp display and thumbnail variants without upscaling', async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 4, background: { r: 10, g: 90, b: 140, alpha: 0.5 } },
  }).png().toBuffer();
  const variants = await createListingImageVariants({ data: source, mediaType: 'image/png', fileName: 'sample.png' });

  assert.ok(variants);
  assert.equal(variants.display.mediaType, 'image/webp');
  assert.equal(variants.thumbnail.mediaType, 'image/webp');
  assert.equal(variants.display.width, listingDisplayMaxDimension);
  assert.equal(variants.thumbnail.width, listingThumbnailMaxDimension);
  assert.ok(variants.thumbnail.data.byteLength < source.byteLength);
  assert.notDeepEqual(variants.display.data, variants.thumbnail.data);
});

test('listing image selectors enforce surface-specific fallback order', () => {
  const image = { originalUrl: 'original.png', displayUrl: 'display.webp', thumbnailUrl: 'thumbnail.webp' };
  assert.equal(getListingThumbnailUrl(image), 'thumbnail.webp');
  assert.equal(getListingDisplayUrl(image), 'display.webp');
  assert.equal(getListingFullUrl(image), 'original.png');
  assert.equal(getListingThumbnailUrl({ originalUrl: 'old.png' }), 'old.png');
  assert.equal(getListingDisplayUrl({ originalUrl: 'old.png' }), 'old.png');
});

test('chat and multipart uploads generate server variants when clients omit them', async () => {
  const storage = await readFile(new URL('../agent/marketplace/listing-image-storage.ts', import.meta.url), 'utf8');
  const route = await readFile(new URL('../app/api/marketplace/listings/[listingId]/images/route.ts', import.meta.url), 'utf8');
  assert.match(storage, /createListingImageVariants\(uploadedImage\)/);
  assert.match(route, /createListingImageVariants\(\{/);
  assert.match(route, /variant: 'display'/);
  assert.match(route, /variant: 'thumbnail'/);
});

test('backfill is batched, dry-run by default, idempotent by database state and preserves originals', async () => {
  const script = await readFile(new URL('../scripts/backfill-listing-image-variants.ts', import.meta.url), 'utf8');
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /take: batchSize/);
  assert.match(script, /cursor:/);
  assert.match(script, /needsVariants/);
  assert.match(script, /bytesBefore/);
  assert.match(script, /bytesAfter/);
  assert.doesNotMatch(script, /originalUrl:\s*(display|thumbnail)/);
  assert.doesNotMatch(script, /deleteListingObject/);
});

test('listing surfaces retain thumbnail, display and on-demand original behavior', async () => {
  const files = await Promise.all([
    'app/page.tsx', 'app/account/listings/page.tsx', 'app/favorites/page.tsx',
    'app/conversations/[conversationId]/page.tsx', 'app/admin/listings/page.tsx',
    'app/sellers/[sellerId]/page.tsx',
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (const file of files) assert.match(file, /thumbnailUrl/);

  const gallery = await readFile(new URL('../app/listings/[listingId]/listing-image-gallery.tsx', import.meta.url), 'utf8');
  assert.match(gallery, /selectedDisplayUrl/);
  assert.match(gallery, /new Image\(\)/);
  assert.match(gallery, /image\.src = nextDisplayUrl/);
  assert.match(gallery, /isLightboxOpen && selectedOriginalUrl/);
  assert.match(gallery, /src=\{selectedOriginalUrl\}/);
});
