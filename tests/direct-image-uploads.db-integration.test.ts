import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/db/prisma';
import {
  cancelOwnedDirectImageUpload, claimDirectImageUpload, cleanupExpiredDirectImageUploads,
  completeDirectImageUpload, createDirectImageUpload, directImageUploadEffects,
  getOwnedDirectImageUpload, getOwnedActiveDirectImageUploads,
} from '@/agent/marketplace/direct-image-uploads';
import {
  addListingImageForSeller, resetIncompleteSellerDrafts, setListingStatusForSeller,
  setPrimaryListingImageForSeller,
} from '@/agent/marketplace/repository';
import { getRealtimeEventsSince } from '@/lib/realtime/event-bus';
import type { DirectImageObjectJob, DirectImageVariant } from '@/agent/marketplace/direct-image-objects';

const enabled = process.env.SMARTSTORE_DB_INTEGRATION === '1' && Boolean(process.env.DATABASE_URL);
const env = {
  SMARTSTORE_MARKETPLACE_STORE: 'database', SMARTSTORE_DIRECT_IMAGE_UPLOADS: 'true',
  SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://isolated.r2.cloudflarestorage.com',
  SMARTSTORE_OBJECT_STORAGE_BUCKET: 'isolated-public', SMARTSTORE_IMAGE_INTAKE_BUCKET: 'isolated-intake',
  SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://images.isolated.test',
  SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'isolated-test-key', SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'isolated-test-secret',
  SMARTSTORE_EVIDENCE_STORAGE_BUCKET: 'isolated-evidence', SMARTSTORE_IMAGE_WORKER_SECRET: 'isolated-worker-test-secret-at-least-32-characters',
  SMARTSTORE_MAX_IMAGES_PER_LISTING: '8',
};
const metadata = { fileName: 'photo.jpg', mediaType: 'image/jpeg' as const, sizeBytes: 100, sha256: 'a'.repeat(64) };
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(t: TestContext) {
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  const id = randomUUID();
  const seller = await prisma.user.create({ data: { id: `direct-owner-${id}`, email: `direct-owner-${id}@example.test` } });
  const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'furniture', title: 'كنب', status: 'draft', compliance: { decision: 'allow', reasons: [], humanDecision: 'allow' } } });
  const original = new Uint8Array(await sharp({ create: { width: 100, height: 60, channels: 3, background: '#333333' } }).jpeg().toBuffer());
  const display = new Uint8Array(await sharp(original).resize(90).webp().toBuffer());
  const thumbnail = new Uint8Array(await sharp(original).resize(36).webp().toBuffer());
  const cleanups: Array<{ id: string; includePublic?: boolean }> = [];
  const oldEffects = { ...directImageUploadEffects };
  t.mock.method(directImageUploadEffects, 'createTransfer', (job: DirectImageObjectJob) => ({ url: `https://isolated.r2.cloudflarestorage.com/isolated-intake/${job.sourceKey}`, method: 'PUT' as const, headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' } }));
  t.mock.method(directImageUploadEffects, 'readImage', async (_job: DirectImageObjectJob, variant: DirectImageVariant) => ({ data: variant === 'original' ? original : variant === 'display' ? display : thumbnail, mediaType: variant === 'original' ? 'image/jpeg' : 'image/webp', etag: '"isolated-etag"' }));
  t.mock.method(directImageUploadEffects, 'promote', async (job: DirectImageObjectJob) => ({ originalUrl: `https://images.isolated.test/listings/2026/10/${job.id}-display.webp`, displayUrl: `https://images.isolated.test/listings/2026/10/${job.id}-display.webp`, thumbnailUrl: `https://images.isolated.test/listings/2026/10/${job.id}-thumbnail.webp` }));
  t.mock.method(directImageUploadEffects, 'discard', async (job: DirectImageObjectJob, options?: { includePublic?: boolean }) => { cleanups.push({ id: job.id, ...options }); return true; });
  t.mock.method(directImageUploadEffects, 'review', async () => { throw new Error('manual_upload_must_not_invoke_a_model'); });
  // Any unexpected service effect must fail locally rather than contact a cloud.
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_cloud_io_forbidden_in_direct_image_test'); });
  t.after(async () => {
    Object.assign(directImageUploadEffects, oldEffects);
    await prisma.listingImageUpload.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    // Delete triggers intentionally preserve manifests; remove only these fixtures.
    await prisma.listingImageUpload.deleteMany({ where: { sellerId: seller.id } });
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  return { seller, listing, cleanups, original, display, thumbnail };
}
const start = (f: Fixture, key: string = randomUUID()) => createDirectImageUpload(f.listing.id, f.seller.id, key, metadata);
async function claimed(f: Fixture) {
  const response = await start(f);
  const claim = await claimDirectImageUpload(response.upload.id);
  assert.equal(claim.action, 'process');
  if (claim.action !== 'process') throw new Error('claim_expected');
  return { id: response.upload.id, claim };
}

test('database initiation deduplicates concurrent retries, binds metadata and rejects another owner', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const responses = await Promise.all(Array.from({ length: 4 }, () => start(f, 'same-key')));
  assert.equal(new Set(responses.map(value => value.upload.id)).size, 1);
  assert.equal(await prisma.listingImageUpload.count({ where: { listingId: f.listing.id } }), 1);
  await assert.rejects(createDirectImageUpload(f.listing.id, f.seller.id, 'same-key', { ...metadata, sha256: 'b'.repeat(64) }), { code: 'idempotency_payload_mismatch' });
  await assert.rejects(createDirectImageUpload(f.listing.id, 'another-account', 'another-key', metadata), { code: 'listing_not_found' });
});

test('database reservations and legacy uploads share the eight-image limit under concurrent requests', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const responses = await Promise.allSettled(Array.from({ length: 12 }, () => start(f)));
  assert.equal(responses.filter(value => value.status === 'fulfilled').length, 8);
  for (const outcome of responses) if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'listing_image_limit_reached');
  const image = { id: randomUUID(), listingId: f.listing.id, originalUrl: 'https://images.isolated.test/legacy.jpg', displayUrl: 'https://images.isolated.test/legacy-display.webp', thumbnailUrl: 'https://images.isolated.test/legacy-thumbnail.webp', isPrimary: true, qualityScore: 80, status: 'approved' as const, enhancements: [] };
  assert.equal((await addListingImageForSeller(f.listing.id, f.seller.id, image))?.images.length, 0);
  const one = responses.find(value => value.status === 'fulfilled');
  assert.ok(one?.status === 'fulfilled');
  await cancelOwnedDirectImageUpload(f.listing.id, f.seller.id, one.value.upload.id);
  assert.equal((await addListingImageForSeller(f.listing.id, f.seller.id, image))?.images.length, 1);
  await assert.rejects(start(f), { code: 'listing_image_limit_reached' });
});

test('database pending images block publication and blank-draft reset without making photos mandatory', { skip: !enabled }, async t => {
  const f = await fixture(t);
  await prisma.listing.update({ where: { id: f.listing.id }, data: { title: null } });
  const upload = await start(f);
  await assert.rejects(setListingStatusForSeller(f.listing.id, f.seller.id, 'published'), { code: 'image_uploads_pending' });
  assert.equal(await resetIncompleteSellerDrafts(f.seller.id), 0);
  await cancelOwnedDirectImageUpload(f.listing.id, f.seller.id, upload.upload.id);
  // Optional photos stay optional once no upload is waiting.
  assert.equal((await setListingStatusForSeller(f.listing.id, f.seller.id, 'published'))?.status, 'published');
  assert.equal(await prisma.listingImage.count({ where: { listingId: f.listing.id } }), 0);
});

test('database claims reject duplicate and stale leases without deleting a newer task source', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const first = await claimed(f);
  await assert.rejects(claimDirectImageUpload(first.id), { code: 'image_upload_processing' });
  await prisma.listingImageUpload.update({ where: { id: first.id }, data: { leaseUntil: new Date(0) } });
    const next = await claimDirectImageUpload(first.id);
  assert.equal(next.action, 'process');
  if (next.action !== 'process') throw new Error('claim_expected');
  assert.notEqual(next.leaseToken, first.claim.leaseToken);
  assert.notDeepEqual(next.targets, first.claim.targets);
  await assert.rejects(completeDirectImageUpload(first.id, { leaseToken: first.claim.leaseToken }), { code: 'image_upload_lease_mismatch' });
  assert.equal(f.cleanups.length, 0);
  assert.equal((await completeDirectImageUpload(first.id, { leaseToken: next.leaseToken })).action, 'ready');
});

test('database repeated completions attach one image and never expose draft events publicly', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  const outcomes = await Promise.all(Array.from({ length: 3 }, () => completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken })));
  assert.ok(outcomes.every(value => value.action === 'ready'));
  assert.equal(await prisma.listingImage.count({ where: { id: item.id } }), 1);
  const owned = await getOwnedDirectImageUpload(f.listing.id, f.seller.id, item.id);
  assert.equal(owned.upload.status, 'ready');
  assert.equal(owned.listing?.images[0].id, item.id);
  const publicEvents = getRealtimeEventsSince(null, { userId: null, isAdmin: false });
  assert.equal(publicEvents.filter(event => event.payload && 'listingId' in event.payload && event.payload.listingId === f.listing.id).length, 0);
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).status, 'draft');
  assert.equal(await prisma.followNotification.count({ where: { listingId: f.listing.id } }), 0);
});

test('database cancellation, deletion and account deactivation reject late completion', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const cancelled = await claimed(f);
  await cancelOwnedDirectImageUpload(f.listing.id, f.seller.id, cancelled.id);
  assert.equal((await completeDirectImageUpload(cancelled.id, { leaseToken: cancelled.claim.leaseToken })).action, 'discard');
  const deleted = await claimed(f);
  await prisma.listing.update({ where: { id: f.listing.id }, data: { status: 'deleted' } });
  assert.equal((await completeDirectImageUpload(deleted.id, { leaseToken: deleted.claim.leaseToken })).action, 'discard');
  await prisma.listing.update({ where: { id: f.listing.id }, data: { status: 'draft' } });
  const deactivated = await claimed(f);
  await prisma.user.update({ where: { id: f.seller.id }, data: { deletedAt: new Date() } });
  assert.equal((await completeDirectImageUpload(deactivated.id, { leaseToken: deactivated.claim.leaseToken })).action, 'discard');
  assert.equal(await prisma.listingImage.count({ where: { listingId: f.listing.id } }), 0);
});

test('database finalization rechecks cancellation that occurs during processed-image validation', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  let release!: () => void;
  let entered!: () => void;
  const reviewing = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  const read = directImageUploadEffects.readImage;
  t.mock.method(directImageUploadEffects, 'readImage', async (job: DirectImageObjectJob, variant: DirectImageVariant) => {
    if (variant === 'display') { entered(); await pause; }
    return read(job, variant);
  });
  const pending = completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken });
  await reviewing;
  await cancelOwnedDirectImageUpload(f.listing.id, f.seller.id, item.id);
  release();
  assert.equal((await pending).action, 'discard');
  assert.equal(await prisma.listingImage.count({ where: { id: item.id } }), 0);
});

test('database attaching another image preserves the customer-selected primary and publication time', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const image = { originalUrl: 'https://images.isolated.test/one.jpg', displayUrl: 'https://images.isolated.test/one.webp', thumbnailUrl: 'https://images.isolated.test/one-thumb.webp', qualityScore: 70, status: 'approved' as const, enhancements: [] };
  const one = await prisma.listingImage.create({ data: { ...image, listingId: f.listing.id, isPrimary: true } });
  const two = await prisma.listingImage.create({ data: { ...image, listingId: f.listing.id, isPrimary: false } });
  const originalPublishedAt = new Date('2026-10-01T00:00:00Z');
  await prisma.listing.update({ where: { id: f.listing.id }, data: { status: 'published', firstPublicationTracked: true, firstPublishedAt: originalPublishedAt } });
  const item = await claimed(f);
  await setPrimaryListingImageForSeller(f.listing.id, f.seller.id, two.id);
  const previousUpdatedAt = (await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).updatedAt;
  assert.equal((await completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken })).action, 'ready');
  const images = await prisma.listingImage.findMany({ where: { listingId: f.listing.id, isPrimary: true } });
  assert.deepEqual(images.map(value => value.id), [two.id]);
  assert.notEqual(images[0].id, one.id);
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).firstPublishedAt?.toISOString(), originalPublishedAt.toISOString());
  assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).updatedAt.toISOString(), previousUpdatedAt.toISOString());
  assert.equal(await prisma.followNotification.count({ where: { listingId: f.listing.id } }), 0);
});

test('database invalid processed images fail without saving URLs; transient copies remain retryable', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const invalid = await claimed(f);
  const read = directImageUploadEffects.readImage;
  t.mock.method(directImageUploadEffects, 'readImage', async () => ({ data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg', etag: '"invalid"' }));
  assert.equal((await completeDirectImageUpload(invalid.id, { leaseToken: invalid.claim.leaseToken })).action, 'discard');
  assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: invalid.id } })).status, 'failed');
  directImageUploadEffects.readImage = read;
  const transient = await claimed(f);
  const promote = directImageUploadEffects.promote;
  t.mock.method(directImageUploadEffects, 'promote', async () => { throw new TypeError('temporary network'); });
  assert.equal((await completeDirectImageUpload(transient.id, { leaseToken: transient.claim.leaseToken })).action, 'retry');
  assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: transient.id } })).status, 'pending');
  directImageUploadEffects.promote = promote;
  const retry = await claimDirectImageUpload(transient.id);
  assert.equal(retry.action, 'process');
  if (retry.action === 'process') assert.equal((await completeDirectImageUpload(transient.id, { leaseToken: retry.leaseToken })).action, 'ready');
});

test('database expiration cleanup retries failures and durable manifests survive account cascades', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  await prisma.listingImageUpload.update({ where: { id: item.id }, data: { expiresAt: new Date(0) } });
  const discard = directImageUploadEffects.discard;
  t.mock.method(directImageUploadEffects, 'discard', async () => false);
  const first = await cleanupExpiredDirectImageUploads();
  assert.ok(first.incomplete >= 1);
  assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } })).cleanupAt, null);
  directImageUploadEffects.discard = discard;
  await cleanupExpiredDirectImageUploads();
  assert.ok((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } })).cleanupAt);
  const ready = await claimed(f);
  await completeDirectImageUpload(ready.id, { leaseToken: ready.claim.leaseToken });
  await prisma.user.delete({ where: { id: f.seller.id } });
  const orphan = await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: ready.id } });
  assert.equal(orphan.status, 'cancelled');
  assert.equal(orphan.cleanupAt, null);
  await cleanupExpiredDirectImageUploads();
  assert.ok(f.cleanups.some(value => value.id === ready.id && value.includePublic));
  assert.ok((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: ready.id } })).cleanupAt);
  assert.equal((await completeDirectImageUpload(ready.id, { leaseToken: ready.claim.leaseToken })).action, 'discard');
});

test('database a lease replaced during processed-image validation cannot clean another worker source or final files', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  let release!: () => void;
  let entered!: () => void;
  const reviewing = new Promise<void>(resolve => { entered = resolve; });
  const pause = new Promise<void>(resolve => { release = resolve; });
  const read = directImageUploadEffects.readImage;
  t.mock.method(directImageUploadEffects, 'readImage', async (job: DirectImageObjectJob, variant: DirectImageVariant) => {
    if (variant === 'display') { entered(); await pause; }
    return read(job, variant);
  });
  const pending = completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken });
  await reviewing;
  await prisma.listingImageUpload.update({ where: { id: item.id }, data: { leaseUntil: new Date(0) } });
  const next = await claimDirectImageUpload(item.id);
  assert.equal(next.action, 'process');
  release();
  await assert.rejects(pending, { code: 'image_upload_lease_mismatch' });
  assert.equal(f.cleanups.length, 0);
  if (next.action === 'process') assert.equal((await completeDirectImageUpload(item.id, { leaseToken: next.leaseToken })).action, 'ready');
});

test('database image deletion during rollback resets durable cleanup even with direct uploads disabled', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  await completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken });
  await cleanupExpiredDirectImageUploads();
  assert.ok((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } })).cleanupAt);
  process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'false';
  await prisma.listingImage.delete({ where: { id: item.id } });
  const removed = await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(removed.status, 'cancelled');
  assert.equal(removed.cleanupAt, null);
  await cleanupExpiredDirectImageUploads();
  assert.ok(f.cleanups.some(value => value.id === item.id && value.includePublic));
  assert.ok((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } })).cleanupAt);
});

test('database cleanup prunes old finished metadata while keeping attached image manifests', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const cancelled = await start(f);
  await cancelOwnedDirectImageUpload(f.listing.id, f.seller.id, cancelled.upload.id);
  const attached = await claimed(f);
  await completeDirectImageUpload(attached.id, { leaseToken: attached.claim.leaseToken });
  const old = new Date(Date.now() - 10 * 24 * 60 * 60_000);
  await prisma.listingImageUpload.updateMany({ where: { id: { in: [cancelled.upload.id, attached.id] } }, data: { cleanupAt: old, expiresAt: old } });
  await cleanupExpiredDirectImageUploads();
  assert.equal(await prisma.listingImageUpload.findUnique({ where: { id: cancelled.upload.id } }), null);
  assert.ok(await prisma.listingImageUpload.findUnique({ where: { id: attached.id } }));
});

test('database technical image edits preserve human rejection without invoking model assessment', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  await prisma.listing.update({ where: { id: f.listing.id }, data: { status: 'rejected', compliance: { decision: 'allow', reasons: [], humanDecision: 'block' } } });
  t.mock.method(directImageUploadEffects, 'review', async () => { throw new Error('manual_upload_must_not_invoke_a_model'); });
  assert.equal((await completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken })).action, 'ready');
  const image = await prisma.listingImage.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(image.status, 'approved');
  assert.equal(image.contentReviewStatus, 'not_checked');
  const moderated = await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } });
  assert.deepEqual(moderated.compliance, { decision: 'allow', reasons: [], humanDecision: 'block' });
  assert.equal(moderated.status, 'rejected');
  assert.equal((await setListingStatusForSeller(f.listing.id, f.seller.id, 'published'))?.status, 'rejected');
});

test('database reopening an editor recovers only owned active tasks and releases them during rollback', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const pending = await start(f);
  const processing = await claimed(f);
  const expired = await start(f);
  await prisma.listingImageUpload.update({ where: { id: expired.upload.id }, data: { expiresAt: new Date(0) } });
  const recovered = await getOwnedActiveDirectImageUploads(f.listing.id, f.seller.id);
  assert.deepEqual(new Set(recovered.uploads.map(value => value.id)), new Set([pending.upload.id, processing.id]));
  assert.ok(recovered.uploads.every(value => !('sourceKey' in value) && !('sha256' in value) && !('transfer' in value)));
  await assert.rejects(getOwnedActiveDirectImageUploads(f.listing.id, 'another-account'), { code: 'listing_not_found' });
  await assert.rejects(getOwnedActiveDirectImageUploads('missing-listing', f.seller.id), { code: 'listing_not_found' });
  process.env.SMARTSTORE_DIRECT_IMAGE_UPLOADS = 'false';
  assert.deepEqual(await getOwnedActiveDirectImageUploads(f.listing.id, f.seller.id), { uploads: [] });
  assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: pending.upload.id } })).status, 'cancelled');
  assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: processing.id } })).status, 'cancelled');
  assert.equal((await completeDirectImageUpload(processing.id, { leaseToken: processing.claim.leaseToken })).action, 'discard');
});

test('database cleanup stops starting new work after its wall budget without counting backlog as failure', { skip: !enabled }, async t => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) await start(f);
  await prisma.listingImageUpload.updateMany({ where: { listingId: f.listing.id }, data: { expiresAt: new Date(0) } });
  let reads = 0;
  t.mock.method(directImageUploadEffects, 'now', () => ++reads <= 2 ? 1000 : 22000);
  const result = await cleanupExpiredDirectImageUploads();
  assert.deepEqual(result, { inspected: 1, cleaned: 1, incomplete: 0, remaining: true });
  assert.equal(await prisma.listingImageUpload.count({ where: { listingId: f.listing.id, cleanupAt: null } }), 2);
});

test('database concurrent deletion cannot mark public cleanup complete after a private-only pass', { skip: !enabled }, async t => {
  const f = await fixture(t);
  const item = await claimed(f);
  await completeDirectImageUpload(item.id, { leaseToken: item.claim.leaseToken });
  t.mock.method(directImageUploadEffects, 'discard', async (job: DirectImageObjectJob, options?: { includePublic?: boolean }) => {
    assert.equal(options?.includePublic, false);
    await prisma.listingImage.delete({ where: { id: job.id } });
    return true;
  });
  const result = await cleanupExpiredDirectImageUploads();
  assert.equal(result.cleaned, 0);
  assert.equal(result.incomplete, 1);
  const manifest = await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(manifest.status, 'cancelled');
  assert.equal(manifest.cleanupAt, null);
});
