import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { prisma } from '@/lib/db/prisma';
import { claimDirectImageUpload, completeDirectImageUpload, directImageUploadEffects } from '@/agent/marketplace/direct-image-uploads';
import { imageUploadObjectKeys } from '@/agent/marketplace/direct-image-upload-policy';
import { POST as claim } from '@/app/api/internal/image-uploads/[uploadId]/claim/route';

for (const scenario of [
  { name: 'new uploads retain WebP display derivatives only', attempts: 0, existing: 'jpeg' },
  { name: 'retries replace stale targets with the no-original WebP contract', attempts: 1, existing: 'webp' },
] as const) {
  test(scenario.name, async t => {
    const previousFlag = process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS;
    const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
    process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'true';
    process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
    t.after(() => {
      if (previousFlag === undefined) delete process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS;
      else process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = previousFlag;
      if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
      else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    });
    let job = { id: 'format-job', sellerId: 'owner', listingId: 'listing', status: 'pending',
      attempts: scenario.attempts as number, expiresAt: new Date(Date.now() + 60_000),
      leaseUntil: null, sha256: 'a'.repeat(64), sizeBytes: 123,
      ...imageUploadObjectKeys('format-job', 'previous-lease') };
    const tx = {
      listingImageUpload: {
        async findUnique() { return job; },
        async update({ data }: { data: Record<string, unknown> }) {
          job = { ...job, ...data, attempts: job.attempts + 1 } as typeof job;
          return job;
        },
      },
      listing: { async findUnique() { return { id: 'listing', sellerId: 'owner', status: 'draft', compliance: {}, images: [] }; } },
      user: { async findUnique() { return { deletedAt: null }; } },
    };
    t.mock.method(prisma, '$transaction', async (operation: unknown) => {
      if (typeof operation !== 'function') throw new Error('unexpected_transaction');
      return operation(tx);
    });
    const result = await claimDirectImageUpload(job.id);
    assert.equal(result.action, 'process');
    if (result.action !== 'process') throw new Error('processing_claim_expected');
    assert.ok(result.targets.display.endsWith('/display.webp'));
    assert.equal(result.targets.original, result.targets.display, 'legacy original target aliases the display derivative');
    assert.equal(result.source.key, 'intake/v1/format-job.jpg', 'source upload protocol stays compatible');
    assert.equal(job.attempts, scenario.attempts + 1);
    assert.equal(job.originalKey, result.targets.original, 'format is durably recorded before returning targets');
  });
}

test('unsupported worker format metadata is rejected before claiming a job', async t => {
  const previous = process.env.SMARTSTORE_IMAGE_WORKER_SECRET;
  const secret = 'isolated-format-negotiation-worker-secret';
  process.env.SMARTSTORE_IMAGE_WORKER_SECRET = secret;
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_IMAGE_WORKER_SECRET; else process.env.SMARTSTORE_IMAGE_WORKER_SECRET = previous; });
  t.mock.method(prisma, '$transaction', async () => { throw new Error('invalid_capability_must_not_query_database'); });
  const response = await claim(new Request('https://example.test/api/internal/image-uploads/format-job/claim', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ outputFormats: ['unsupported-output'] }),
  }), { params: Promise.resolve({ uploadId: 'format-job' }) });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_request');
});

for (const useWrongDisplay of [false, true]) {
  test(useWrongDisplay ? 'WebP finalization refuses non-WebP display bytes' : 'WebP finalization validates the two retained derivatives and aliases the legacy original URL', async t => {
    const flags = { SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'true', SMARTSTORE_MARKETPLACE_STORE: 'database' };
    const previous = new Map(Object.keys(flags).map(key => [key, process.env[key]]));
    Object.assign(process.env, flags);
    t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    let job = { id: 'ready-webp', sellerId: 'owner', listingId: 'listing', status: 'processing', attempts: 1,
      leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), fileName: 'phone.jpg', sha256: 'a'.repeat(64), sizeBytes: 123,
      ...imageUploadObjectKeys('ready-webp', 'lease') };
    const source = sharp({ create: { width: 64, height: 48, channels: 3, background: '#39846a' } });
    const webp = new Uint8Array(await source.clone().webp().toBuffer());
    const jpeg = new Uint8Array(await source.clone().jpeg().toBuffer());
    let attached: Record<string, unknown> | null = null;
    let promotions = 0;
    const tx = {
      listingImageUpload: {
        async findUnique() { return job; },
        async update({ data }: { data: Record<string, unknown> }) { job = { ...job, ...data } as typeof job; return job; },
      },
      listing: {
        async findUnique() { return { id: 'listing', sellerId: 'owner', status: 'draft', images: [], compliance: {}, updatedAt: new Date() }; },
        async update() {},
      },
      user: { async findUnique() { return { deletedAt: null }; } },
      listingImage: { async create({ data }: { data: Record<string, unknown> }) { attached = data; return data; } },
    };
    t.mock.method(prisma, '$transaction', async (operation: unknown) => { if (typeof operation !== 'function') throw new Error('unexpected_transaction'); return operation(tx); });
    const replaceDelegate = (target: object, key: string, value: unknown) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      Object.defineProperty(target, key, { configurable: true, writable: true, value });
      t.after(() => { if (descriptor) Object.defineProperty(target, key, descriptor); else Reflect.deleteProperty(target, key); });
    };
    replaceDelegate(prisma.listingImageUpload, 'findUnique', async () => job);
    replaceDelegate(prisma.listingImageUpload, 'updateMany', async ({ data }: { data: Record<string, unknown> }) => { job = { ...job, ...data } as typeof job; return { count: 1 }; });
    replaceDelegate(prisma.listingImage, 'findUnique', async () => attached);
    replaceDelegate(prisma.listing, 'findUnique', async () => ({ sellerId: 'owner', status: 'draft' }));
    t.mock.method(directImageUploadEffects, 'readImage', async (_job: unknown, variant: string) => ({
      data: variant === 'display' && useWrongDisplay ? jpeg : webp,
      mediaType: variant === 'display' && useWrongDisplay ? 'image/jpeg' : 'image/webp', etag: '"test"',
    }));
    t.mock.method(directImageUploadEffects, 'review', async () => { throw new Error('finalization_must_not_request_model_review'); });
    t.mock.method(directImageUploadEffects, 'promote', async () => { promotions++; return {
      originalUrl: 'https://images.test/listings/ready-webp-display.webp',
      displayUrl: 'https://images.test/listings/ready-webp-display.webp', thumbnailUrl: 'https://images.test/listings/ready-webp-thumbnail.webp',
    }; });
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
    const result = await completeDirectImageUpload(job.id, { leaseToken: 'lease' });
    if (useWrongDisplay) {
      assert.equal(result.action, 'discard');
      assert.equal(job.status, 'failed');
      assert.equal(attached, null);
      assert.equal(promotions, 0);
    } else {
      assert.equal(result.action, 'ready');
      assert.equal(job.status, 'ready');
      assert.equal(promotions, 1);
      assert.ok(attached);
      const saved = attached as Record<string, unknown>;
      for (const field of ['originalUrl', 'displayUrl', 'thumbnailUrl']) assert.ok(String(saved[field]).endsWith('.webp'));
      assert.equal(saved.originalUrl, saved.displayUrl);
      assert.equal(saved.contentReviewStatus, 'not_checked');
      assert.equal(saved.createdAt, job.createdAt);
    }
  });
}
