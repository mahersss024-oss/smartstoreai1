import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// This destructive test never uses an existing database, even a test database.
// Opt in with a loopback-only local cluster and create a fresh database ourselves.
test('owner market reset is atomic, preserves users and retains durable storage cleanup', {
  skip: process.env.SMARTSTORE_OWNER_RESET_INTEGRATION !== '1', timeout: 120_000,
}, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  const schema = `owner_reset_test_${randomBytes(8).toString('hex')}`;
  url.pathname = `/${schema}`;
  url.searchParams.set('schema', 'public');
  const originalUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const admin = new PrismaClient({ datasources: { db: { url: originalUrl } } });
  let database: PrismaClient | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('External network prohibited in reset test'); };
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${schema}"`);
    const migrated = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8', timeout: 60_000,
    });
    // Avoid printing credentials from migration CLI output on failure.
    const diagnostics = `${migrated.stderr}\n${migrated.stdout}`.split(/\r?\n/)
      .filter(line => /^(Error|Database error|ERROR|HINT|DETAIL|P\d{4})/.test(line))
      .map(line => line.replace(/postgres(?:ql)?:\/\/\S+/g, '[connection redacted]')).join('\n');
    assert.equal(migrated.status, 0, `Fresh local database migrations must succeed: ${diagnostics}`);
    const { prisma } = await import('@/lib/db/prisma');
    database = prisma;
    const { executeMarketReset, getMarketResetPreview, marketResetConfirmation, marketResetModels } = await import('@/lib/admin/market-reset');
    const { processImageObjectCleanup } = await import('@/agent/marketplace/image-object-cleanup');
    const owner = await prisma.user.create({ data: { id: 'reset-owner', email: 'reset-owner@example.test', role: 'admin', name: 'Original owner', phoneNumber: '+966500000001',
      picture: 'https://test-images.example.invalid/listings/2026/10/profile.webp', termsVersion: 'retained-consent', platformAgreementVersion: 'retained-agreement' } });
    const buyer = await prisma.user.create({ data: { id: 'reset-buyer', email: 'reset-buyer@example.test', role: 'user', deletedAt: new Date() } });
    const listing = await prisma.listing.create({ data: { sellerId: owner.id, category: 'furniture', title: 'Disposable reset fixture', status: 'published' } });
    const image = await prisma.listingImage.create({ data: { id: 'reset-picture', listingId: listing.id, originalUrl: owner.picture!, displayUrl: owner.picture!, thumbnailUrl: owner.picture!, qualityScore: 100, status: 'approved' } });
    const conversation = await prisma.conversation.create({ data: { listingId: listing.id, sellerId: owner.id, buyerId: buyer.id } });
    await prisma.conversationMessage.create({ data: { conversationId: conversation.id, senderId: buyer.id, body: 'Disposable private message' } });
    await prisma.commission.create({ data: { listingId: listing.id, sellerId: owner.id, productValue: 100, commissionAmount: 1, status: 'due' } });
    await prisma.report.create({ data: { listingId: listing.id, reporterId: buyer.id, reason: 'reset fixture' } });
    await prisma.userReport.create({ data: { targetUserId: owner.id, reporterId: buyer.id, conversationId: conversation.id, reason: 'reset fixture' } });
    await prisma.evidenceCase.updateMany({ data: { legalHold: true } });
    await prisma.favorite.create({ data: { listingId: listing.id, userId: buyer.id } });
    await prisma.sellerFollow.create({ data: { followerId: buyer.id, sellerId: owner.id } });
    await prisma.sellerRating.create({ data: { raterId: buyer.id, sellerId: owner.id, rating: 4 } });
    await prisma.similarListingFollow.create({ data: { userId: buyer.id, listingId: listing.id, category: 'furniture' } });
    await prisma.userBlock.create({ data: { blockerId: owner.id, blockedId: buyer.id, conversationId: conversation.id } });
    await prisma.followNotification.create({ data: { userId: buyer.id, sellerId: owner.id, listingId: listing.id, url: '/listing/fixture' } });
    await prisma.pushSubscription.create({ data: { userId: buyer.id, endpoint: 'https://push.example.invalid/reset', p256dh: 'fixture', auth: 'fixture' } });
    await prisma.mobilePushToken.create({ data: { userId: buyer.id, token: 'reset-fixture', platform: 'android' } });
    await prisma.notificationDeliveryJob.create({ data: { id: 'reset-notification', kind: 'fixture', payload: {} } });
    await prisma.marketplaceSearchState.create({ data: { ownerKey: buyer.id, state: { query: 'fixture' } } });
    await prisma.apiIdempotencyKey.create({ data: { namespace: 'fixture', actorKey: buyer.id, key: 'fixture' } });
    await prisma.siteVisitDaily.create({ data: { day: '2026-01-01', visits: 1 } });
    await prisma.siteVisitUnique.create({ data: { day: '2026-01-01', visitorId: 'fixture' } });
    await prisma.siteMessage.create({ data: { message: 'fixture', updatedById: owner.id } });
    await prisma.adminAuditLog.create({ data: { adminId: owner.id, action: 'update_listing', targetType: 'fixture', targetId: listing.id } });
    await prisma.listingImageUpload.create({ data: { id: 'reset-upload', listingId: listing.id, sellerId: owner.id, idempotencyKey: 'fixture', requestFingerprint: 'a'.repeat(64), fileName: 'fixture.jpg', sizeBytes: 100, sha256: 'b'.repeat(64), sourceKey: 'intake/fixture.jpg', originalKey: 'listings/fixture.webp', displayKey: 'listings/fixture-display.webp', thumbnailKey: 'listings/fixture-thumbnail.webp', expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.listingImageUpload.create({ data: { id: 'orphan-ready-upload', listingId: 'previously-removed-listing', sellerId: owner.id, idempotencyKey: 'orphan', requestFingerprint: 'c'.repeat(64), fileName: 'orphan.jpg', sizeBytes: 100, sha256: 'd'.repeat(64), sourceKey: 'intake/orphan.jpg', originalKey: 'listings/orphan.webp', displayKey: 'listings/orphan-display.webp', thumbnailKey: 'listings/orphan-thumbnail.webp', status: 'ready', cleanupAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.imageObjectCleanup.create({ data: { imageId: 'completed-fixture', urls: [], cleanupAt: new Date() } });
    const previouslyCleaned = await prisma.evidenceAsset.findFirstOrThrow();
    await prisma.imageObjectCleanup.create({ data: { imageId: `evidence:${previouslyCleaned.id}`, urls: [], cleanupAt: new Date() } });
    const request = (previewToken: string) => ({ actorId: owner.id, reason: 'Reset disposable fixtures', confirmation: marketResetConfirmation, previewToken, backupConfirmed: true, includeProtectedData: true });

    await t.test('preview covers every non-user model without changing data', async () => {
      const { preview } = await getMarketResetPreview(owner.id);
      assert.equal(preview.counts.length, 27);
      assert.ok(preview.counts.every(row => row.count > 0), 'Every model has a populated fixture');
      assert.equal(preview.preserved.users, 2);
      assert.equal(preview.preserved.profileImages, 1);
      assert.equal(preview.protectedData.heldEvidenceCases, 2);
      assert.equal(preview.protectedData.commissions, 1);
      assert.equal(preview.canExecute, true);
      assert.equal(await prisma.listing.count(), 1);
    });
    await t.test('substantive changes invalidate the preview before any deletion', async () => {
      const { preview } = await getMarketResetPreview(owner.id);
      await prisma.listing.update({ where: { id: listing.id }, data: { title: 'Changed after preview' } });
      await assert.rejects(executeMarketReset(request(preview.previewToken)), { code: 'preview_stale' });
      assert.equal(await prisma.report.count(), 1);
      assert.equal(await prisma.evidenceCase.count(), 2);
    });
    await t.test('an unreviewed table blocks preview instead of silently leaving data behind', async () => {
      await prisma.$executeRawUnsafe('CREATE TABLE "UnknownResetFixture" (id text)');
      try { await assert.rejects(getMarketResetPreview(owner.id), { code: 'reset_schema_changed' }); }
      finally { await prisma.$executeRawUnsafe('DROP TABLE "UnknownResetFixture"'); }
      assert.equal(await prisma.listing.count(), 1);
    });
    await t.test('a concurrent market write blocks the reset before any deletion', async () => {
      const connection = new PrismaClient({ datasources: { db: { url: url.toString() } } });
      let release!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>(resolve => { locked = resolve; });
      const hold = new Promise<void>(resolve => { release = resolve; });
      const writer = connection.$transaction(async tx => {
        await tx.$executeRawUnsafe('LOCK TABLE "Listing" IN ROW EXCLUSIVE MODE');
        locked();
        await hold;
      });
      try {
        await ready;
        const { preview } = await getMarketResetPreview(owner.id);
        await assert.rejects(executeMarketReset(request(preview.previewToken)), (error: unknown) => {
          return !!error && typeof error === 'object' && 'meta' in error && (error.meta as { code?: string })?.code === '55P03';
        });
        assert.equal(await prisma.listing.count(), 1);
      } finally { release(); await writer; await connection.$disconnect(); }
    });
    await t.test('busy storage leases prevent the reset', async () => {
      await prisma.listingImageUpload.update({ where: { id: 'reset-upload' }, data: { status: 'processing', leaseUntil: new Date(Date.now() + 60_000) } });
      const { preview } = await getMarketResetPreview(owner.id);
      assert.equal(preview.canExecute, false);
      assert.ok(preview.blockers.some(row => row.code === 'reset_busy'));
      await assert.rejects(executeMarketReset(request(preview.previewToken)), { code: 'reset_busy' });
      await prisma.listingImageUpload.update({ where: { id: 'reset-upload' }, data: { status: 'pending', leaseUntil: null } });
    });
    await t.test('a database refusal rolls back evidence disposal, deletions and queued files together', async () => {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_reset_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reset_fixture_rollback'; END $$`);
      await prisma.$executeRawUnsafe('CREATE TRIGGER reject_reset BEFORE DELETE ON "SiteMessage" FOR EACH ROW EXECUTE FUNCTION reject_reset_fixture()');
      const before = await prisma.evidenceCase.findMany({ orderBy: { id: 'asc' } });
      const { preview } = await getMarketResetPreview(owner.id);
      await assert.rejects(executeMarketReset(request(preview.previewToken)));
      assert.deepEqual(await prisma.evidenceCase.findMany({ orderBy: { id: 'asc' } }), before);
      assert.equal(await prisma.listing.count(), 1);
      assert.equal(await prisma.commission.count(), 1);
      assert.equal(await prisma.imageObjectCleanup.count(), 2);
      await prisma.$executeRawUnsafe('DROP TRIGGER reject_reset ON "SiteMessage"');
      await prisma.$executeRawUnsafe('DROP FUNCTION reject_reset_fixture()');
    });
    await t.test('reset retains full user records and durable file manifests and cannot replay', async () => {
      const before = await prisma.user.findMany({ orderBy: { id: 'asc' } });
      const { preview } = await getMarketResetPreview(owner.id);
      const result = await executeMarketReset(request(preview.previewToken));
      assert.equal(result.status, 'completed');
      assert.deepEqual(await prisma.user.findMany({ orderBy: { id: 'asc' } }), before);
      for (const model of marketResetModels) {
        if (model.mode === 'cleanup' || model.kind === 'AdminAuditLog') continue;
        const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) FROM "${model.kind}"`);
        assert.equal(Number(rows[0].count), 0, model.kind);
      }
      assert.equal(await prisma.adminAuditLog.count(), 1);
      assert.equal((await prisma.adminAuditLog.findFirstOrThrow()).id, result.operationId);
      const upload = await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: 'reset-upload' } });
      assert.equal(upload.status, 'cancelled');
      assert.equal(upload.cleanupAt, null);
      assert.ok(upload.expiresAt > new Date());
      const orphan = await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: 'orphan-ready-upload' } });
      assert.equal(orphan.status, 'cancelled');
      assert.equal(orphan.errorCode, 'owner_market_reset');
      assert.equal(orphan.cleanupAt, null, 'Rearm even an orphaned previously cleaned manifest while its grant remains live');
      const jobs = await prisma.imageObjectCleanup.findMany();
      assert.ok(jobs.some(row => row.imageId.startsWith('evidence:')));
      const rearmed = jobs.find(row => row.imageId === `evidence:${previouslyCleaned.id}`);
      assert.equal(rearmed?.cleanupAt, null);
      assert.deepEqual(rearmed?.urls, [previouslyCleaned.objectKey]);
      assert.ok(jobs.some(row => row.imageId === image.id));
      assert.equal(await processImageObjectCleanup(image.id), false, 'A user profile keeps its shared listing object');
      await assert.rejects(executeMarketReset(request(preview.previewToken)), { code: 'preview_stale' });
      assert.equal(await prisma.user.count(), 2);
    });
    await t.test('reset upload grants stay pending for final cleanup until they expire', async () => {
      const { cleanupExpiredDirectImageUploads, directImageUploadEffects } = await import('@/agent/marketplace/direct-image-uploads');
      const saved = directImageUploadEffects.discard;
      let calls = 0;
      directImageUploadEffects.discard = async () => { calls++; return true; };
      try {
        await cleanupExpiredDirectImageUploads();
        assert.equal(calls, 0, 'A live signed grant cannot be considered permanently cleaned');
        assert.equal((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: 'reset-upload' } })).cleanupAt, null);
        await prisma.listingImageUpload.update({ where: { id: 'reset-upload' }, data: { expiresAt: new Date(Date.now() - 1000) } });
        await cleanupExpiredDirectImageUploads();
        assert.equal(calls, 1);
        assert.ok((await prisma.listingImageUpload.findUniqueOrThrow({ where: { id: 'reset-upload' } })).cleanupAt);
      } finally { directImageUploadEffects.discard = saved; }
    });
    await t.test('private evidence deletion is durable on failure and profile jobs respect every retained user', async () => {
      Object.assign(process.env, {
        SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://reset-test.r2.cloudflarestorage.com',
        SMARTSTORE_OBJECT_STORAGE_BUCKET: 'reset-public', SMARTSTORE_EVIDENCE_STORAGE_BUCKET: 'reset-evidence',
        SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'fake-reset-key', SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fake-reset-secret',
        SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://test-images.example.invalid',
      });
      const job = await prisma.imageObjectCleanup.findFirstOrThrow({ where: { imageId: { startsWith: 'evidence:' } } });
      let available = false;
      const deleted: string[] = [];
      globalThis.fetch = async (input, init) => {
        const destination = new URL(String(input));
        assert.equal(destination.hostname, 'reset-test.r2.cloudflarestorage.com');
        assert.equal(init?.method, 'DELETE');
        assert.ok(destination.pathname.startsWith('/reset-evidence/cases/'));
        if (!available) throw new Error('isolated-storage-unavailable');
        deleted.push(destination.pathname);
        return new Response(null, { status: 204 });
      };
      assert.equal(await processImageObjectCleanup(job.imageId, Date.now() + 25), false);
      assert.equal((await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { id: job.id } })).cleanupAt, null);
      await prisma.imageObjectCleanup.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
      available = true;
      assert.equal(await processImageObjectCleanup(job.imageId), true);
      assert.equal(deleted.length, 1);
      assert.ok((await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { id: job.id } })).cleanupAt);
      const prefix = createHash('sha256').update(`profile:${owner.id}`).digest('hex');
      const picture = `https://test-images.example.invalid/profiles/owners/${prefix}/2026/10/00000000-0000-4000-8000-000000000001.webp`;
      const { isOwnedProfileImageUrl } = await import('@/agent/marketplace/object-storage');
      assert.equal(isOwnedProfileImageUrl(owner.id, picture), true);
      await prisma.user.update({ where: { id: buyer.id }, data: { picture } });
      await prisma.imageObjectCleanup.create({ data: { imageId: 'profile:owner:shared', ownerId: owner.id, urls: [picture], nextAttemptAt: new Date(0) } });
      const calls = deleted.length;
      assert.equal(await processImageObjectCleanup('profile:owner:shared'), false);
      assert.equal(deleted.length, calls, 'Another retained account still uses these bytes');
    });
  } finally {
    globalThis.fetch = originalFetch;
    await database?.$disconnect();
    // Generated name and loopback checks above make this a disposable target.
    assert.match(schema, /^owner_reset_test_[a-f0-9]{16}$/);
    await admin.$executeRawUnsafe(`DROP DATABASE "${schema}"`);
    await admin.$disconnect();
    process.env.DATABASE_URL = originalUrl;
  }
});
