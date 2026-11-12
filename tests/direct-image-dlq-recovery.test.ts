import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { exhaustDirectImageUploadDelivery } from '@/agent/marketplace/direct-image-uploads';
import { POST } from '@/app/api/internal/image-uploads/[uploadId]/claim/route';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function fixture(t: TestContext, changes: Record<string, unknown> = {}) {
  const previous = { flag: process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS, store: process.env.SMARTSTORE_MARKETPLACE_STORE,
    secret: process.env.SMARTSTORE_IMAGE_WORKER_SECRET };
  process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'true';
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_IMAGE_WORKER_SECRET = 'isolated-dlq-worker-secret-at-least32characters';
  t.after(() => {
    for (const [name, value] of [['SMARTSTORE_DIRECT_IMAGE_UPLOADS', previous.flag],
      ['SMARTSTORE_MARKETPLACE_STORE', previous.store], ['SMARTSTORE_IMAGE_WORKER_SECRET', previous.secret]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
  });
  const state = { job: { id: 'upload', listingId: 'listing', sellerId: 'owner', status: 'pending',
    sourceKey: 'intake/v1/upload.jpg', originalKey: 'staged/v1/upload/lease/display.webp',
    displayKey: 'staged/v1/upload/lease/display.webp', thumbnailKey: 'staged/v1/upload/lease/thumbnail.webp',
    expiresAt: new Date(Date.now() + 3600000), leaseToken: null as string | null,
    leaseUntil: null as Date | null, cleanupAt: null, errorCode: null as string | null, ...changes }, allowed: true, promotion: null as Record<string, unknown> | null };
  let updates = 0;
  const database = {
    listingImageUpload: {
      findUnique: async () => ({ ...state.job }),
      update: async ({ data }: { data: Record<string, unknown> }) => { updates++; Object.assign(state.job, data); return { ...state.job }; },
    },
    listing: { findUnique: async () => ({ id: 'listing', sellerId: state.allowed ? 'owner' : 'another-owner', status: 'draft' }) },
    user: { findUnique: async () => ({ deletedAt: null }) },
    imageObjectCleanup: { findUnique: async () => state.promotion },
  };
  mockDatabaseMethod(t, prisma, '$transaction', async (run: (tx: unknown) => Promise<unknown>) => run(database));
  return { state, updates: () => updates };
}

test('DLQ terminal reconciliation persists a failed status idempotently through the protected existing claim route', async t => {
  const f = fixture(t);
  const request = () => new Request('https://example.test/api/internal/image-uploads/upload/claim', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SMARTSTORE_IMAGE_WORKER_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ terminal: 'delivery_exhausted' }),
  });
  const context = { params: Promise.resolve({ uploadId: 'upload' }) };
  const response = await POST(request(), context);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).action, 'discard');
  assert.equal(f.state.job.status, 'failed');
  assert.equal(f.state.job.errorCode, 'image_delivery_exhausted');
  assert.equal((await POST(request(), context)).status, 200);
  assert.equal(f.updates(), 1);
});

test('DLQ cannot terminate a live worker lease or a protected public promotion', async t => {
  const f = fixture(t, { status: 'processing', leaseToken: 'live', leaseUntil: new Date(Date.now() + 60000) });
  await assert.rejects(exhaustDirectImageUploadDelivery('upload'), { code: 'image_upload_processing', status: 409 });
  assert.equal(f.updates(), 0);
  f.state.job.leaseUntil = new Date(0);
  f.state.promotion = { cleanupAt: null, attempts: 0, leaseToken: 'promotion:live', leaseUntil: new Date(Date.now() + 60000) };
  await assert.rejects(exhaustDirectImageUploadDelivery('upload'), { code: 'image_upload_processing', status: 409 });
  assert.equal(f.updates(), 0);
  f.state.promotion = null;
  assert.equal((await exhaustDirectImageUploadDelivery('upload')).action, 'discard');
  assert.equal(f.state.job.status, 'failed');
});

test('DLQ preserves existing terminal decisions and distinguishes expiry and target cancellation', async t => {
  const f = fixture(t, { status: 'ready' });
  await exhaustDirectImageUploadDelivery('upload');
  assert.equal(f.state.job.status, 'ready');
  assert.equal(f.updates(), 0);
  f.state.job.status = 'pending';
  f.state.job.expiresAt = new Date(0);
  await exhaustDirectImageUploadDelivery('upload');
  assert.equal(f.state.job.status, 'expired');
  f.state.job.status = 'pending';
  f.state.job.expiresAt = new Date(Date.now() + 60000);
  f.state.allowed = false;
  await exhaustDirectImageUploadDelivery('upload');
  assert.equal(f.state.job.status, 'cancelled');
});

test('DLQ terminal control rejects ordinary sessions and unknown terminal actions before touching jobs', async t => {
  const f = fixture(t);
  const context = { params: Promise.resolve({ uploadId: 'upload' }) };
  const unauthorized = await POST(new Request('https://example.test/claim', {
    method: 'POST', headers: { Cookie: 'smartstore_session=customer' }, body: '{"terminal":"delivery_exhausted"}',
  }), context);
  assert.equal(unauthorized.status, 401);
  const invalid = await POST(new Request('https://example.test/claim', { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SMARTSTORE_IMAGE_WORKER_SECRET}` },
    body: '{"terminal":"cancel-anything"}',
  }), context);
  assert.equal(invalid.status, 400);
  assert.equal(f.updates(), 0);
});
