import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '@/lib/db/prisma';
import { deleteListingImageForSeller } from '@/agent/marketplace/repository';
import { processImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function requireLocalDatabase() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database'); return true;
}
async function fixture() {
  const id = randomUUID();
  const user = await prisma.user.create({ data: { id: `recovery-${id}`, email: `recovery-${id}@example.test`, name: 'Recovery fixture', picture: `https://images.example.test/profiles/owners/${id}/2026/11/old.webp` } });
  const listing = await prisma.listing.create({ data: { sellerId: user.id, category: 'other', title: 'Recovery image', status: 'draft' } });
  const image = await prisma.listingImage.create({ data: { id, listingId: listing.id,
    originalUrl: `https://images.example.test/listings/2026/11/${id}-display.webp`,
    displayUrl: `https://images.example.test/listings/2026/11/${id}-display.webp`,
    thumbnailUrl: `https://images.example.test/listings/2026/11/${id}-thumbnail.webp`, status: 'approved', qualityScore: 90 } });
  return { user, listing, image, cleanup: async () => {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await prisma.imageObjectCleanup.deleteMany({ where: { OR: [{ imageId: id }, { ownerId: user.id }] } });
  } };
}

test('PostgreSQL seller image removal retains a durable recovery receipt after deleting its DB reference', async t => {
  if (!requireLocalDatabase()) return t.skip('Requires disposable local PostgreSQL.');
  const f = await fixture();
  try {
    const result = await deleteListingImageForSeller(f.listing.id, f.user.id, f.image.id);
    assert.equal(result?.images.length, 0);
    assert.equal(await prisma.listingImage.count({ where: { id: f.image.id } }), 0);
    const receipt = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: f.image.id } });
    assert.equal(receipt.preserveForRecovery, true);
    assert.equal(receipt.cleanupAt, null); assert.ok(receipt.urls.includes(f.image.displayUrl));
  } finally { await f.cleanup(); }
});

test('PostgreSQL cascade deletion and profile replacement both retain private recovery flags', async t => {
  if (!requireLocalDatabase()) return t.skip('Requires disposable local PostgreSQL.');
  const f = await fixture();
  try {
    await prisma.user.update({ where: { id: f.user.id }, data: { picture: null } });
    const profile = await prisma.imageObjectCleanup.findFirstOrThrow({ where: { ownerId: f.user.id } });
    assert.equal(profile.preserveForRecovery, true); assert.ok(profile.urls.includes(f.user.picture!));
    await prisma.listing.delete({ where: { id: f.listing.id } });
    const photo = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: f.image.id } });
    assert.equal(photo.preserveForRecovery, true); assert.equal(photo.cleanupAt, null);
  } finally { await f.cleanup(); }
});

for (const upgradedDuringCleanup of [false, true]) test(`PostgreSQL recovery copy failure preserves pending cleanup${upgradedDuringCleanup ? ' after concurrent policy upgrade' : ''}`, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires disposable local PostgreSQL.');
  const id = randomUUID();
  const values = { SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_IMAGE_RECOVERY_BUCKET: 'private-recovery',
    SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'listing-images', SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'test',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test', SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.example.test',
    SMARTSTORE_IMAGE_INTAKE_BUCKET: '', SMARTSTORE_EVIDENCE_STORAGE_BUCKET: '' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values); let deletes = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    if (init?.method === 'DELETE') deletes++;
    return new Response(null, { status: init?.method === 'HEAD' ? 200 : 403,
      headers: { 'Content-Length': '100', 'Content-Type': 'image/webp', ETag: '"source"' } });
  });
  try {
    await prisma.imageObjectCleanup.create({ data: { imageId: id, preserveForRecovery: !upgradedDuringCleanup,
      nextAttemptAt: new Date(Date.now() - 1000),
      urls: [`https://images.example.test/listings/2026/11/${id}-display.webp`] } });
    if (upgradedDuringCleanup) {
      const originalCount = prisma.listingImage.count.bind(prisma.listingImage);
      mockDatabaseMethod(t, prisma.listingImage, 'count', ((...args: Parameters<typeof originalCount>) => {
        return (async () => {
          await prisma.imageObjectCleanup.update({ where: { imageId: id }, data: { preserveForRecovery: true } });
          return await originalCount(...args);
        })();
      }) as typeof prisma.listingImage.count);
    }
    assert.equal(await processImageObjectCleanup(id), false);
    const receipt = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: id } });
    assert.equal(receipt.cleanupAt, null); assert.equal(receipt.attempts, 1);
    assert.ok(receipt.nextAttemptAt.getTime() > Date.now()); assert.equal(deletes, 0);
  } finally {
    await prisma.imageObjectCleanup.deleteMany({ where: { imageId: id } });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
