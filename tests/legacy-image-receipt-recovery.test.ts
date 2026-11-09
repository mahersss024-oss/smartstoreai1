import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { POST } from '@/app/api/marketplace/listings/[listingId]/images/route';
import { prisma } from '@/lib/db/prisma';
import { createSignedSession } from '@/lib/auth/session';
import { mockDatabaseMethod } from './helpers/mock-database-method';

test('a committed legacy upload recovers after receipt failure even when it filled the last image slot', async t => {
  const env = { SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'false', NODE_ENV: 'test',
    SMARTSTORE_IMAGE_STORAGE: 'inline', SMARTSTORE_OBJECT_STORAGE_ENDPOINT: '', SMARTSTORE_OBJECT_STORAGE_BUCKET: '',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', AUTH_SECRET: 'legacy-receipt-regression-isolated-secret' };
  for (const [key, value] of Object.entries(env)) { const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; }); }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Live network forbidden.'); });
  type Image = { id: string; listingId: string; originalUrl: string; displayUrl: string; thumbnailUrl: string; isPrimary: boolean; status: string; qualityScore: number; enhancements: string[]; createdAt: Date };
  const listing = { id: 'receipt-image-listing', sellerId: 'receipt-image-seller', category: 'other', title: 'Fixture',
    attributes: {}, compliance: {}, status: 'draft', createdAt: new Date(), updatedAt: new Date(), images: [] as Image[] };
  for (let i = 0; i < 7; i++) listing.images.push({ id: 'existing-' + i, listingId: listing.id, originalUrl: 'data:image/webp;base64,AA==', displayUrl: '', thumbnailUrl: '', isPrimary: i === 0, status: 'approved', qualityScore: 0, enhancements: [], createdAt: new Date() });
  let receipt: { status: string; response?: unknown; statusCode?: number } | null = null, failReceipt = true, inserts = 0;
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'create', async () => { if (receipt) throw new Error('unique'); receipt = { status: 'pending' }; return receipt; });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'findUnique', async () => receipt);
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'update', async ({ data }: { data: { status: string } }) => { if (failReceipt) { failReceipt = false; throw new Error('lost-receipt'); } Object.assign(receipt!, data); return receipt; });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'deleteMany', async () => { receipt = null; return { count: 1 }; });
  mockDatabaseMethod(t, prisma.listing, 'findUnique', async () => structuredClone(listing));
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    $executeRaw: async () => 1,
    listing: { findUnique: async () => structuredClone(listing) },
    listingImage: { create: async ({ data }: { data: Image }) => { inserts++; listing.images.push({ ...data, createdAt: new Date() }); return data; } },
  }));
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const upload = () => {
    const body = new FormData(); body.set('image', new File([new Uint8Array(bytes)], 'fixture.png', { type: 'image/png' }));
    return POST(new Request('https://fixture.invalid/upload', { method: 'POST', headers: {
      Authorization: `Bearer ${createSignedSession({ id: listing.sellerId, email: 'image@example.test' })}`, 'Idempotency-Key': 'same-upload' }, body }), { params: Promise.resolve({ listingId: listing.id }) });
  };
  await assert.rejects(upload(), /lost-receipt/);
  assert.equal(listing.images.length, 8);
  const imageId = listing.images[7].id;
  const replay = await upload();
  assert.equal(replay.status, 201); assert.equal((await replay.json()).image.id, imageId);
  assert.equal(listing.images.length, 8); assert.equal(inserts, 1);
});
