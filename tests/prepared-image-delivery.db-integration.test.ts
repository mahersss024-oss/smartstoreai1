import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';

import { prisma } from '@/lib/db/prisma';
import { processImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';
import { discardUnattachedListingImage, storeListingImageDelivery } from '@/agent/marketplace/listing-image-storage';
import { planListingObjectStorage, storeListingObject } from '@/agent/marketplace/object-storage';
import { addListingImageForSeller } from '@/agent/marketplace/repository';
import type { ListingImage } from '@/agent/marketplace/types';
import type { GeneratedListingImageVariant } from '@/agent/marketplace/listing-image-variants';

function isolatedDatabaseEnabled() {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '');
    return process.env.SMARTSTORE_DB_INTEGRATION === '1' && url.hostname === '127.0.0.1' &&
      url.port === '55432' && url.pathname === '/smartstore_codex_test';
  } catch { return false; }
}

test('legacy image delivery journals planned bytes, seals attachment, and recovers failed or late writes', {
  skip: !isolatedDatabaseEnabled(), timeout: 45_000,
}, async t => {
  const prefix = `legacy-delivery-${randomUUID()}`;
  const seller = { id: prefix, email: `${prefix}@example.test` };
  const settings = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_IMAGE_STORAGE: 's3',
    SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'false', SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS: '1000',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://legacy-test.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'isolated-fixtures', SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'fake-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fake-secret', SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://legacy-images.example.invalid',
    CLOUDFLARE_API_TOKEN: 'fake-token', CLOUDFLARE_ZONE_ID: 'fake-zone',
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const originalFetch = globalThis.fetch;
  const remoteObjects = new Set<string>();
  const receipts = new Set<string>();
  let loseDisplayResponse = false;
  let refuseDeletion = false;
  let puts = 0;
  let deletes = 0;
  let deletionBarrier: Promise<void> | undefined;
  let deletionStarted: (() => void) | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.cloudflare.com') return Response.json({ success: true });
    assert.equal(url.hostname, 'legacy-test.r2.cloudflarestorage.com', 'external requests are forbidden');
    if (init?.method === 'PUT') {
      puts++;
      const publicUrl = `https://legacy-images.example.invalid${url.pathname.slice('/isolated-fixtures'.length)}`;
      const receipt = await prisma.imageObjectCleanup.findFirst({ where: { urls: { has: publicUrl }, cleanupAt: null } });
      assert.ok(receipt, 'the durable receipt must exist before even the first PUT');
      receipts.add(receipt.imageId);
      remoteObjects.add(url.pathname);
      if (loseDisplayResponse && url.pathname.endsWith('-display.webp')) throw new TypeError('response lost after remote commit');
      return new Response(null, { status: 200 });
    }
    if (init?.method === 'DELETE') {
      deletes++;
      deletionStarted?.();
      if (deletionBarrier) await deletionBarrier;
      if (refuseDeletion) return new Response(null, { status: 503 });
      remoteObjects.delete(url.pathname);
      return new Response(null, { status: 204 });
    }
    throw new Error('Unexpected network operation in isolated image delivery test');
  };
  const data = new Uint8Array(await sharp({ create: { width: 24, height: 24, channels: 3, background: '#bada55' } }).webp().toBuffer());
  const variants: { display: GeneratedListingImageVariant; thumbnail: GeneratedListingImageVariant } = {
    display: { data, mediaType: 'image/webp', fileName: 'display.webp', width: 24, height: 24 },
    thumbnail: { data, mediaType: 'image/webp', fileName: 'thumbnail.webp', width: 24, height: 24 },
  };
  const makeImage = (listingId: string, id: string, urls: { originalUrl: string; displayUrl: string; thumbnailUrl: string }): ListingImage => ({
    id, listingId, ...urls, isPrimary: false, qualityScore: 90, status: 'approved', enhancements: [],
  });
  const receiptFor = async (url: string) => prisma.imageObjectCleanup.findFirstOrThrow({ where: { urls: { has: url } } });
  try {
    await prisma.user.create({ data: seller });
    const listing = await prisma.listing.create({ data: { sellerId: seller.id, title: 'Isolated delivery', category: 'furniture', compliance: {} } });

    await t.test('remote commit with a lost response and failed cleanup remains durably retryable', async () => {
      loseDisplayResponse = true;
      await assert.rejects(storeListingImageDelivery({ imageId: `${prefix}-lost`, variants }), /could not be stored completely/);
      loseDisplayResponse = false;
      const job = await prisma.imageObjectCleanup.findFirstOrThrow({ where: { imageId: { in: [...receipts] }, cleanupAt: null } });
      assert.equal(job.urls.length, 2, 'the failed-response object remains in the intended URL manifest');
      assert.equal(remoteObjects.size, 2);
      refuseDeletion = true;
      assert.equal(await processImageObjectCleanup(job.imageId), false);
      assert.equal((await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: job.imageId } })).cleanupAt, null);
      assert.equal(remoteObjects.size, 2);
      refuseDeletion = false;
      await prisma.imageObjectCleanup.update({ where: { imageId: job.imageId }, data: { nextAttemptAt: new Date(0) } });
      // Reconnect to persistence rather than rely on any process-local upload result.
      await prisma.$disconnect();
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(remoteObjects.size, 0);
    });

    await t.test('attachment retires its receipt atomically and an unknown successful commit remains safe', async () => {
      const id = `${prefix}-attached`;
      const urls = await storeListingImageDelivery({ imageId: id, variants });
      const job = await receiptFor(urls.displayUrl);
      const image = makeImage(listing.id, id, urls);
      const saved = await addListingImageForSeller(listing.id, seller.id, image);
      assert.ok(saved?.images.some(value => value.id === id));
      assert.equal(await prisma.imageObjectCleanup.count({ where: { imageId: job.imageId } }), 0);
      // The caller cannot know whether a timed-out database response committed.
      await discardUnattachedListingImage(image);
      const before = deletes;
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(deletes, before, 'the cleanup worker checks actual attached URLs');
      assert.ok((await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: job.imageId } })).cleanupAt);
      assert.ok(remoteObjects.has(`/isolated-fixtures${new URL(urls.displayUrl).pathname}`));
    });

    await t.test('concurrent deterministic chat attempts preserve winner bytes and clean only the loser', async () => {
      const id = `${prefix}-shared-chat`;
      const [one, two] = await Promise.all([
        storeListingImageDelivery({ imageId: id, variants, cleanupOnFailure: false }),
        storeListingImageDelivery({ imageId: id, variants, cleanupOnFailure: false }),
      ]);
      assert.notEqual(one.displayUrl, two.displayUrl);
      const images = [makeImage(listing.id, id, one), makeImage(listing.id, id, two)];
      await Promise.all(images.map(image => addListingImageForSeller(listing.id, seller.id, image, { draftOnly: true })));
      const saved = await prisma.listingImage.findUniqueOrThrow({ where: { id } });
      const loser = images.find(image => image.displayUrl !== saved.displayUrl)!;
      const job = await receiptFor(loser.displayUrl);
      await discardUnattachedListingImage(loser);
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(remoteObjects.has(`/isolated-fixtures${new URL(loser.displayUrl).pathname}`), false);
      assert.equal(remoteObjects.has(`/isolated-fixtures${new URL(saved.displayUrl).pathname}`), true);
      assert.equal(await prisma.listingImage.count({ where: { id } }), 1);
    });

    await t.test('a claimed cleanup prevents attachment and a stale cleaner cannot acknowledge a reopened receipt', async () => {
      const id = `${prefix}-claimed`;
      const urls = await storeListingImageDelivery({ imageId: id, variants });
      const image = makeImage(listing.id, id, urls);
      const job = await receiptFor(urls.displayUrl);
      await prisma.imageObjectCleanup.update({ where: { imageId: job.imageId }, data: { nextAttemptAt: new Date(0) } });
      let release!: () => void;
      deletionBarrier = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { deletionStarted = resolve; });
      const cleaning = processImageObjectCleanup(job.imageId);
      try {
        await started;
        await assert.rejects(addListingImageForSeller(listing.id, seller.id, image), /prepared_image_delivery_expired/);
        assert.equal(await prisma.listingImage.count({ where: { id } }), 0);
        await discardUnattachedListingImage(image);
      } finally {
        release();
        deletionBarrier = undefined;
        deletionStarted = undefined;
        await cleaning;
      }
      const reopened = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: job.imageId } });
      assert.equal(reopened.cleanupAt, null, 'the obsolete cleanup token must not close the renewed receipt');
      assert.equal(reopened.urls.length, 2);
      remoteObjects.add(`/isolated-fixtures${new URL(urls.displayUrl).pathname}`);
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(remoteObjects.has(`/isolated-fixtures${new URL(urls.displayUrl).pathname}`), false);
      // An even later completion after a completed cleanup reopens it as well.
      remoteObjects.add(`/isolated-fixtures${new URL(urls.thumbnailUrl).pathname}`);
      await discardUnattachedListingImage(image);
      assert.equal((await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: job.imageId } })).cleanupAt, null);
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(remoteObjects.has(`/isolated-fixtures${new URL(urls.thumbnailUrl).pathname}`), false);
    });

    await t.test('an expired upload plan cannot mint a new PUT after cleanup eligibility', async () => {
      const input = { imageId: `${prefix}-expired`, variant: 'display' as const, data, mediaType: 'image/webp' };
      const plan = planListingObjectStorage(input)!;
      plan.expiresAt = Date.now() - 1;
      const before = puts;
      await assert.rejects(storeListingObject(input, plan), /prepared_image_delivery_expired/);
      assert.equal(puts, before);
    });
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.imageObjectCleanup.deleteMany({ where: { OR: [
      { imageId: { in: [...receipts] } }, { imageId: { startsWith: prefix } },
    ] } });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await prisma.$disconnect();
  }
});
