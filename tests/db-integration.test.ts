import assert from 'node:assert/strict';
import test from 'node:test';

import { hardMaxListingImages } from '@/agent/marketplace/listing-image-limits';
import type { ListingImage } from '@/agent/marketplace/types';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { textAnalysis } from './helpers/text-understanding';
import { randomUUID } from 'node:crypto';

function shouldRunDatabaseIntegration() {
  return (
    Boolean(process.env.DATABASE_URL?.trim()) &&
    (process.env.SMARTSTORE_DB_INTEGRATION === '1' ||
      process.env.npm_lifecycle_event === 'test:db:integration')
  );
}

function isolatedImageStorage() {
  const changes = {
    SMARTSTORE_IMAGE_STORAGE: 's3', SMARTSTORE_OBJECT_STORAGE_ENDPOINT: 'https://test-only.r2.cloudflarestorage.com',
    SMARTSTORE_OBJECT_STORAGE_BUCKET: 'isolated-fixtures', SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID: 'fake-key',
    SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fake-secret', SMARTSTORE_OBJECT_STORAGE_REGION: 'auto',
    SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL: 'https://test-images.example.invalid',
    CLOUDFLARE_API_TOKEN: 'fake-token', CLOUDFLARE_ZONE_ID: 'fake-zone',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  Object.assign(process.env, changes);
  return () => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } };
}

test('database profile routes reject another account image and never delete unproven legacy objects', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const restoreStorage = isolatedImageStorage();
  const { prisma } = await import('@/lib/db/prisma');
  const { createSignedSession } = await import('@/lib/auth/session');
  const profile = await import('@/app/api/account/profile/route');
  const pictures = await import('@/app/api/account/profile/picture/route');
  const { createPersistentProfileImageUrl } = await import('@/agent/marketplace/profile-image-storage');
  const { isOwnedProfileImageUrl } = await import('@/agent/marketplace/object-storage');
  const { processImageObjectCleanup } = await import('@/agent/marketplace/image-object-cleanup');
  const suffix = randomUUID();
  const owner = { id: `picture-owner-${suffix}`, email: `picture-owner-${suffix}@example.test` };
  const other = { id: `picture-other-${suffix}`, email: `picture-other-${suffix}@example.test` };
  const originalFetch = globalThis.fetch;
  const deletions: string[] = [];
  const purges: string[][] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'test-only.r2.cloudflarestorage.com' && init?.method === 'PUT') return new Response(null, { status: 200 });
    if (url.hostname === 'test-only.r2.cloudflarestorage.com' && init?.method === 'DELETE') { deletions.push(url.pathname); return new Response(null, { status: 204 }); }
    if (url.hostname === 'api.cloudflare.com') { purges.push(JSON.parse(String(init?.body)).files); return Response.json({ success: true }); }
    throw new Error('Unexpected network refused in image ownership integration test');
  };
  try {
    await prisma.user.createMany({ data: [owner, other] });
    const image = await createPersistentProfileImageUrl({ ownerId: owner.id, imageId: randomUUID(), mediaType: 'image/jpeg', data: new Uint8Array([255,216,255,217]) });
    assert.ok(image);
    assert.equal(isOwnedProfileImageUrl(owner.id, image), true);
    assert.equal(isOwnedProfileImageUrl(other.id, image), false);
    await prisma.user.update({ where: { id: owner.id }, data: { picture: image } });
    const token = createSignedSession(other);
    const patched = await profile.PATCH(new Request('http://localhost/api/account/profile', { method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ picture: image, phoneNumber: '' }) }));
    assert.equal(patched.status, 400);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).picture, null);
    // References left by an older version must be safe to clear too.
    await prisma.user.update({ where: { id: other.id }, data: { picture: image } });
    const clear = await pictures.DELETE(new Request('http://localhost/api/account/profile/picture', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }));
    assert.equal(clear.status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).picture, null);
    assert.equal(deletions.length, 0);
    const legacyJob = await prisma.imageObjectCleanup.findFirstOrThrow({ where: { ownerId: other.id, cleanupAt: null } });
    assert.equal(await processImageObjectCleanup(legacyJob.imageId), true);
    assert.equal(deletions.length, 0);
    const ownerClear = await pictures.DELETE(new Request('http://localhost/api/account/profile/picture', { method: 'DELETE', headers: { Authorization: `Bearer ${createSignedSession(owner)}` } }));
    assert.equal(ownerClear.status, 200);
    assert.ok(deletions.some(value => value.endsWith(new URL(image).pathname)));
    assert.ok(purges.some(urls => urls.includes(image)));
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
    await prisma.imageObjectCleanup.deleteMany({ where: { ownerId: { in: [owner.id, other.id] } } });
    await prisma.$disconnect();
    restoreStorage();
  }
});

test('database image cleanup survives Cloudflare refusal, restarts and cascading listing deletion', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const restoreStorage = isolatedImageStorage();
  const { prisma } = await import('@/lib/db/prisma');
  const { deleteListingImageForSeller } = await import('@/agent/marketplace/repository');
  const { processImageObjectCleanup } = await import('@/agent/marketplace/image-object-cleanup');
  const sellerId = `cleanup-seller-${randomUUID()}`;
  const imageId = `cleanup-image-${randomUUID()}`;
  const cascadeId = `cleanup-image-${randomUUID()}`;
  const originalFetch = globalThis.fetch;
  let purgeAvailable = false;
  let deleteCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'test-only.r2.cloudflarestorage.com' && init?.method === 'DELETE') { deleteCalls++; return new Response(null, { status: 204 }); }
    if (url.hostname === 'api.cloudflare.com') return Response.json({ success: purgeAvailable });
    throw new Error('Unexpected network refused in durable cleanup integration test');
  };
  try {
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.test` } });
    const listing = await prisma.listing.create({ data: { sellerId, category: 'furniture', title: 'Cleanup fixture', compliance: {} } });
    const url = `https://test-images.example.invalid/listings/2026/10/${imageId}.jpg`;
    await prisma.listingImage.create({ data: { id: imageId, listingId: listing.id, originalUrl: url, displayUrl: url, thumbnailUrl: url, qualityScore: 100, status: 'approved', isPrimary: true } });
    const removed = await deleteListingImageForSeller(listing.id, sellerId, imageId);
    assert.ok(removed);
    assert.equal(await prisma.listingImage.count({ where: { id: imageId } }), 0);
    const waiting = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId } });
    assert.equal(waiting.cleanupAt, null);
    assert.deepEqual(waiting.urls, [url]);
    assert.equal(waiting.leaseToken, null);
    assert.ok(waiting.attempts > 0);
    purgeAvailable = true;
    await prisma.imageObjectCleanup.update({ where: { imageId }, data: { nextAttemptAt: new Date(0) } });
    assert.equal(await processImageObjectCleanup(imageId), true);
    const done = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId } });
    assert.ok(done.cleanupAt);
    assert.deepEqual(done.urls, []);
    const before = deleteCalls;
    assert.equal(await processImageObjectCleanup(imageId), true);
    assert.equal(deleteCalls, before);
    const cascadeUrl = `https://test-images.example.invalid/listings/2026/10/${cascadeId}.jpg`;
    await prisma.listingImage.create({ data: { id: cascadeId, listingId: listing.id, originalUrl: cascadeUrl, displayUrl: cascadeUrl, thumbnailUrl: cascadeUrl, qualityScore: 100, status: 'approved' } });
    await prisma.listing.delete({ where: { id: listing.id } });
    const cascade = await prisma.imageObjectCleanup.findUniqueOrThrow({ where: { imageId: cascadeId } });
    assert.ok(cascade.urls.includes(cascadeUrl));
    assert.equal(await processImageObjectCleanup(cascadeId), true);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.imageObjectCleanup.deleteMany({ where: { imageId: { in: [imageId, cascadeId] } } });
    await prisma.$disconnect();
    restoreStorage();
  }
});

test('database permanent administration deletion cannot remove another user image through a legacy profile reference', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const restoreStorage = isolatedImageStorage();
  const { prisma } = await import('@/lib/db/prisma');
  const { createSignedSession } = await import('@/lib/auth/session');
  const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
  const { processImageObjectCleanup } = await import('@/agent/marketplace/image-object-cleanup');
  const suffix = randomUUID();
  const adminId = `legacy-delete-admin-${suffix}`;
  const userId = `legacy-delete-target-${suffix}`;
  const victimUrl = `https://test-images.example.invalid/listings/2026/10/${randomUUID()}.jpg`;
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error('No storage request is allowed for a foreign profile reference'); };
  try {
    await prisma.user.createMany({ data: [
      { id: adminId, email: `${adminId}@example.test`, role: 'admin' },
      { id: userId, email: `${userId}@example.test`, picture: victimUrl, deletedAt: new Date() },
    ] });
    const token = createSignedSession({ id: adminId, email: `${adminId}@example.test`, role: 'admin' });
    const response = await DELETE(new Request(`http://localhost/api/admin/users/${userId}?mode=permanent`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }), { params: Promise.resolve({ userId }) });
    assert.equal(response.status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: userId } }), null);
    assert.equal(networkCalls, 0);
    const jobs = await prisma.imageObjectCleanup.findMany({ where: { ownerId: userId } });
    assert.ok(jobs.length);
    for (const job of jobs) assert.equal(await processImageObjectCleanup(job.imageId), true);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, userId] } } });
    await prisma.imageObjectCleanup.deleteMany({ where: { ownerId: userId } });
    await prisma.$disconnect();
    restoreStorage();
  }
});

test('database seller amount writes cannot reverse concurrent paid or waived admin decisions', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const sellerId = `commission-lock-${crypto.randomUUID()}`;
  const savedUpdate = prisma.commission.update;
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.test` } });
    const listing = await prisma.listing.create({ data: { sellerId, category: 'furniture', title: 'Synthetic sale', status: 'sold', compliance: {} } });
    const commission = await prisma.commission.create({ data: { sellerId, listingId: listing.id, productValue: 100, commissionAmount: 1, status: 'due' } });
    for (const decision of ['paid', 'waived'] as const) {
      await prisma.commission.update({ where: { id: commission.id }, data: { status: 'due', productValue: 100, commissionAmount: 1, paidAt: null } });
      const originalUpdate = prisma.commission.update.bind(prisma.commission);
      let notifyWaiting!: () => void;
      let releaseWrite!: () => void;
      const waiting = new Promise<void>(resolve => { notifyWaiting = resolve; });
      const released = new Promise<void>(resolve => { releaseWrite = resolve; });
      prisma.commission.update = (async (args: Parameters<typeof prisma.commission.update>[0]) => {
        if (args.data.productValue !== undefined) { notifyWaiting(); await released; }
        return originalUpdate(args);
      }) as unknown as typeof prisma.commission.update;
      const pending = repository.updateCommissionSaleAmountForSeller(commission.id, sellerId, 200);
      try {
        await waiting;
        assert.equal((await repository.setCommissionStatusForAdmin(commission.id, decision)).status, decision);
      } finally { releaseWrite(); }
      const result = await pending;
      prisma.commission.update = savedUpdate;
      assert.equal(result.status, 'locked');
      const saved = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
      assert.equal(saved.status, decision);
      assert.equal(Number(saved.productValue), 100);
      assert.equal(Number(saved.commissionAmount), 1);
      assert.equal(saved.paidAt !== null, decision === 'paid');
    }
    assert.equal((await repository.updateCommissionSaleAmountForSeller(commission.id, 'another-seller', 300)).status, 'not_found');
  } finally {
    prisma.commission.update = savedUpdate;
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database admin marking sold creates one pending commission and preserves an existing settlement', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const { prisma } = await import('@/lib/db/prisma');
  const { createSessionCookie } = await import('@/lib/auth/session');
  const { PATCH } = await import('@/app/api/admin/listings/[listingId]/route');
  const suffix = crypto.randomUUID();
  const sellerId = `admin-sale-seller-${suffix}`;
  const adminId = `admin-sale-moderator-${suffix}`;
  try {
    await prisma.user.createMany({ data: [
      { id: sellerId, email: `${sellerId}@example.test` },
      { id: adminId, email: `${adminId}@example.test`, role: 'moderator' },
    ] });
    const listing = await prisma.listing.create({ data: { sellerId, category: 'furniture', title: 'Synthetic admin sale', status: 'published', compliance: {} } });
    const cookie = createSessionCookie({ id: adminId, email: `${adminId}@example.test`, role: 'moderator' }).split(';')[0];
    const sell = () => PATCH(new Request('http://localhost/api/admin/listings/' + listing.id, { method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'sold' }) }), { params: Promise.resolve({ listingId: listing.id }) });
    assert.equal((await sell()).status, 200);
    const commission = await prisma.commission.findUniqueOrThrow({ where: { listingId: listing.id } });
    assert.equal(commission.sellerId, sellerId);
    assert.equal(commission.status, 'pending_amount');
    assert.equal(commission.productValue, null);
    assert.equal(commission.commissionAmount, null);
    await prisma.commission.update({ where: { id: commission.id }, data: { status: 'paid', productValue: 500, commissionAmount: 5, paidAt: new Date() } });
    assert.equal((await sell()).status, 200);
    assert.equal(await prisma.commission.count({ where: { listingId: listing.id } }), 1);
    const settled = await prisma.commission.findUniqueOrThrow({ where: { listingId: listing.id } });
    assert.equal(settled.status, 'paid');
    assert.equal(Number(settled.commissionAmount), 5);
  } finally {
    await prisma.adminAuditLog.deleteMany({ where: { adminId } });
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: { in: [sellerId, adminId] } } });
    await prisma.$disconnect();
  }
});

test('database seller cannot restore a deleted listing through pause, sale or content changes', async t => {
  if (!shouldRunDatabaseIntegration()) return t.skip('Requires the isolated PostgreSQL integration database.');
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const sellerId = `deleted-state-${randomUUID()}`;
  try {
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.test` } });
    const listing = await prisma.listing.create({ data: { sellerId, category: 'furniture', title: 'Terminal deletion fixture', status: 'published', compliance: { decision: 'allow' } } });
    assert.equal((await repository.setListingStatusForSeller(listing.id, sellerId, 'deleted'))?.status, 'deleted');
    assert.equal(await repository.setListingStatusForSeller(listing.id, sellerId, 'paused'), null);
    assert.equal(await repository.setListingStatusForSeller(listing.id, sellerId, 'sold'), null);
    assert.notEqual((await repository.setListingStatusForSeller(listing.id, sellerId, 'published'))?.status, 'published');
    assert.equal(await repository.updateListingForSeller(listing.id, sellerId, { description: 'Changed after deletion' }), null);
    assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } })).status, 'deleted');
    assert.equal(await prisma.commission.count({ where: { listingId: listing.id } }), 0);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.$disconnect();
  }
});

test('database public title search normalizes Arabic, filters before pagination and never invokes models', async t => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const suffix = crypto.randomUUID();
  const sellerId = `title-seller-${suffix}`;
  const product = '\u0622\u064a\u0640\u0641\u064f\u0648\u0646 \u0661\u0665';
  const query = `\u0627\u064a\u0641\u0648\u0646 15 ${suffix}`;
  const analyze = t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => { throw new Error('Search must not call a model'); });
  const peek = t.mock.method(marketplaceTextAnalyzer, 'peek', () => { throw new Error('Search must not read model analysis'); });
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    await prisma.user.create({ data: { id: sellerId, email: `${sellerId}@example.test` } });
    const base = { sellerId, category: 'mobile_phones', city: 'Riyadh', status: 'published' as const,
      condition: 'used' as const, compliance: { decision: 'allow', reasons: [] },
      attributes: { year: '\u0662\u0660\u0662\u0665', mileage: '\u0661\u0662\u0660\u0660\u0660' } };
    const first = await prisma.listing.create({ data: { ...base, title: `${product} ${suffix}`, price: 50 } });
    const second = await prisma.listing.create({ data: { ...base, title: `${product} ${suffix}`, price: 70, condition: 'new' } });
    await prisma.listing.createMany({ data: [
      { ...base, title: `${product} ${suffix}`, price: 30, city: 'Jeddah' },
      { ...base, title: `${product} ${suffix}`, price: 40, category: 'computers' },
      { ...base, title: `${product} ${suffix}`, price: 20, status: 'draft' },
      { ...base, title: `Other ${suffix}`, description: `description-only-${suffix} ${product}` },
    ] });
    const filtered = await repository.listPublicMarketplaceListings({ query, category: 'mobile_phones', city: 'Riyadh',
      condition: 'used', minPrice: 40, maxPrice: 60, yearMin: 2024, yearMax: 2026, mileageMin: 10000, mileageMax: 15000 });
    assert.deepEqual(filtered.map(item => item.id), [first.id]);
    const filters = { query, city: 'Riyadh', category: 'mobile_phones', sort: 'cheapest' as const, limit: 1, take: 1 };
    assert.deepEqual((await repository.listPublicMarketplaceListings(filters)).map(item => item.id), [first.id]);
    assert.deepEqual((await repository.listPublicMarketplaceListings({ ...filters, page: 2 })).map(item => item.id), [second.id]);
    assert.deepEqual(await repository.listPublicMarketplaceListings({ query: `description-only-${suffix}` }), []);
    assert.deepEqual(await repository.listPublicMarketplaceListings({ query: "%' OR 1=1 --" }), []);
    assert.equal(analyze.mock.callCount(), 0);
    assert.equal(peek.mock.callCount(), 0);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId } });
    await prisma.user.deleteMany({ where: { id: sellerId } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database manual title category and option survive save, description edits and reopening without reclassification', async t => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const { listingCategoryClassifier } = await import('@/agent/marketplace/listing-category-model');
  const suffix = crypto.randomUUID();
  const seller = { id: `manual-title-${suffix}`, email: `manual-title-${suffix}@example.test` };
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const conflicting = textAnalysis({ category: 'computers' });
  const analyzed: string[] = [];
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async (text: string) => { analyzed.push(text); return conflicting; });
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => conflicting);
  const classify = t.mock.method(listingCategoryClassifier, 'suggest', async () => { throw new Error('Do not reclassify an accepted manual category'); });
  try {
    const listing = await repository.createListingDraft(seller, { category: 'watches_accessories', autoCategory: false,
      title: 'نظارة شمسية', description: 'النظارة للبيع والحاسب المذكور ليس للبيع.',
      attributes: { marketplaceCategoryOption: 'eyewear' } });
    const saved = await prisma.listing.findUniqueOrThrow({ where: { id: listing.id } });
    assert.equal(saved.category, 'watches_accessories');
    assert.equal((saved.attributes as Record<string, unknown>).marketplaceCategoryOption, 'eyewear');
    assert.equal(saved.status, 'draft');
    assert.ok(analyzed.some(text => JSON.parse(text).description === listing.description));
    await repository.updateListingForSeller(listing.id, seller.id, { description: 'وصف معدل للنظارة، وليس للحاسب.' });
    const reopened = await repository.getListing(listing.id);
    assert.equal(reopened?.category, 'watches_accessories');
    assert.equal(reopened?.attributes.marketplaceCategoryOption, 'eyewear');
    assert.equal(reopened?.description, 'وصف معدل للنظارة، وليس للحاسب.');
    assert.equal(classify.mock.callCount(), 0);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database advisory review survives shared reads and closes only after a human listing decision', async t => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const { recordModelReview } = await import('@/lib/admin/model-review');
  const { acknowledgeReportNotification, listReportNotifications } = await import('@/lib/admin/report-notifications');
  const suffix = crypto.randomUUID();
  const seller = { id: `review-seller-${suffix}`, email: `review-seller-${suffix}@example.test` };
  const admin = { id: `review-admin-${suffix}`, email: `review-admin-${suffix}@example.test` };
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => textAnalysis());
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => textAnalysis());
  try {
    await prisma.user.createMany({ data: [seller, { ...admin, role: 'admin' }] });
    const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'other', title: 'Review fixture',
      status: 'published', compliance: { decision: 'allow', reasons: [] } } });
    const review = { subject: 'listing' as const, subjectId: listing.id, listingId: listing.id, userId: seller.id,
      text: JSON.stringify({ title: listing.title }), assessment: { decision: 'needs_review' as const, reasons: ['fixture_review'] } };
    await recordModelReview(review);
    const queued = async () => (await repository.listModerationQueuePage({ limit: 80 })).listings.some(item => item.id === listing.id);
    assert.equal(await queued(), true);
    assert.equal((await repository.getListing(listing.id))?.status, 'published');
    const inbox = await listReportNotifications(1, 100);
    const notification = inbox.notifications.find(item => item.sourceType === 'ModelReview' && item.listingId === listing.id)!;
    assert.ok(notification);
    assert.equal(notification.details, 'Review fixture');
    const acknowledgements = await Promise.all(Array.from({ length: 4 }, () => acknowledgeReportNotification(notification.id, admin.id)));
    assert.ok(acknowledgements.every(Boolean));
    assert.equal(await prisma.adminAuditLog.count({ where: { targetType: 'ModelReviewRead', targetId: notification.id } }), 1);
    assert.ok(!(await listReportNotifications(1, 100)).notifications.some(item => item.id === notification.id));
    assert.equal(await queued(), true, 'Reading an alert must not decide the content outcome');
    await repository.setListingModerationStatus(listing.id, 'published', admin);
    assert.equal(await queued(), false);
    await recordModelReview({ ...review, subject: 'image', text: 'Later image assessment' });
    assert.equal(await queued(), true, 'A later assessment must reopen review');
    await repository.setListingModerationStatus(listing.id, 'rejected', admin);
    assert.equal(await queued(), false);
    await repository.updateListingForSeller(listing.id, seller.id, { title: 'Seller cannot bypass rejection' });
    assert.equal((await repository.setListingStatusForSeller(listing.id, seller.id, 'published'))?.status, 'rejected');
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: { in: [seller.id, admin.id] } } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database concurrent chat draft replays create one draft and one advisory alert without customer reports', async t => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const { prisma } = await import('@/lib/db/prisma');
  const repository = await import('@/agent/marketplace/repository');
  const suffix = crypto.randomUUID();
  const seller = { id: `draft-replay-${suffix}`, email: `draft-replay-${suffix}@example.test` };
  const assessed = textAnalysis({ compliance: { decision: 'block', reasons: ['review_fixture'], shariaSensitive: false } });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => assessed);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => assessed);
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  try {
    const input = { category: 'other', title: 'Concurrent draft' };
    const results = await Promise.all(Array.from({ length: 4 }, () => repository.createListingDraft(seller, input, { idempotencyKey: suffix })));
    assert.equal(new Set(results.map(item => item.id)).size, 1);
    assert.ok(results.every(item => item.status === 'draft' && item.compliance.decision === 'allow'));
    assert.equal(await prisma.listing.count({ where: { sellerId: seller.id } }), 1);
    const listingId = results[0].id;
    assert.equal(await prisma.adminAuditLog.count({ where: { targetType: 'ModelReview', targetId: listingId } }), 1);
    assert.equal(await prisma.report.count({ where: { listingId } }), 0);
    const replay = await repository.createListingDraft(seller, { ...input, title: 'Different model wording' }, { idempotencyKey: suffix });
    assert.equal(replay.id, listingId);
    assert.equal(replay.title, input.title);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('future first-publication timestamps survive concurrent publish, edits and republication without enrolling legacy rows', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = crypto.randomUUID();
  const seller = { id: `publication-seller-${suffix}`, email: `publication-${suffix}@smartstore.local` };
  const { prisma } = await import('@/lib/db/prisma');
  try {
    const repository = await import('@/agent/marketplace/repository');
    const listing = await repository.createListingDraft(seller, { category: 'other', title: 'Desk' });
    assert.equal(listing.firstPublicationTracked, true);
    assert.equal(listing.firstPublishedAt, undefined);
    await prisma.listingImage.create({ data: {
      listingId: listing.id, originalUrl: 'https://example.com/desk.webp',
      displayUrl: 'https://example.com/desk.webp', thumbnailUrl: 'https://example.com/desk.webp',
      status: 'approved', qualityScore: 95,
    } });
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      repository.setListingStatusForSeller(listing.id, seller.id, 'published')));
    const firstPublishedAt = results[0]!.firstPublishedAt;
    assert.ok(firstPublishedAt);
    assert.ok(results.every(result => result?.firstPublishedAt === firstPublishedAt));
    await repository.updateListingForSeller(listing.id, seller.id, { title: 'Updated desk' });
    await repository.setListingStatusForSeller(listing.id, seller.id, 'paused');
    const republished = await repository.setListingStatusForSeller(listing.id, seller.id, 'published');
    assert.equal(republished?.firstPublishedAt, firstPublishedAt);
    assert.equal(republished?.createdAt, listing.createdAt);

    const legacy = await prisma.listing.create({ data: {
      sellerId: seller.id, category: 'other', title: 'Legacy desk', status: 'paused',
      compliance: { decision: 'allow', reasons: [] },
      images: { create: {
        originalUrl: 'https://example.com/old.webp', displayUrl: 'https://example.com/old.webp',
        thumbnailUrl: 'https://example.com/old.webp', status: 'approved', qualityScore: 95,
      } },
    } });
    assert.equal(legacy.firstPublicationTracked, false);
    const legacyPublished = await repository.setListingStatusForSeller(legacy.id, seller.id, 'published');
    assert.equal(legacyPublished?.firstPublishedAt, undefined);
    assert.equal(legacyPublished?.firstPublicationTracked, false);
    const feed = await repository.listMarketplaceListings({ take: 80 });
    const newIndex = feed.findIndex(item => item.id === listing.id);
    const legacyIndex = feed.findIndex(item => item.id === legacy.id);
    if (legacyIndex !== -1) assert.ok(newIndex !== -1 && newIndex < legacyIndex);
  } finally {
    await prisma.listing.deleteMany({ where: { sellerId: seller.id } });
    await prisma.user.deleteMany({ where: { id: seller.id } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

function createImage(index: number, listingId: string): ListingImage {
  return {
    id: `db-integration-image-${Date.now()}-${index}`,
    listingId,
    originalUrl: `https://example.com/db-integration-${index}.jpg`,
    displayUrl: `https://example.com/db-integration-${index}.jpg`,
    thumbnailUrl: `https://example.com/db-integration-${index}.jpg`,
    isPrimary: false,
    qualityScore: 95,
    status: 'approved',
    enhancements: [],
  };
}

test('database listing reports remain unique under concurrent requests', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const suffix = crypto.randomUUID();
  const seller = { id: `report-seller-${suffix}`, email: `seller-${suffix}@smartstore.local` };
  const buyer = `report-buyer-${suffix}`;
  const { prisma } = await import('@/lib/db/prisma');
  let listingId: string | undefined;
  try {
    const repository = await import('@/agent/marketplace/repository');
    const listing = await repository.createListingDraft(seller, { category: 'other', title: 'Desk' });
    listingId = listing.id;
    await prisma.listing.update({ where: { id: listing.id }, data: { status: 'published' } });
    await prisma.user.upsert({ where: { id: buyer }, update: {}, create: { id: buyer, email: `${buyer}@smartstore.local` } });
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      repository.reportListing(listing.id, buyer, 'fraud')));
    assert.equal(new Set(results.map(result => result.report?.id)).size, 1);
    assert.equal(await prisma.report.count({ where: { listingId, reporterId: buyer } }), 1);
    assert.equal(await repository.hasReportedListing(listing.id, buyer), true);
  } finally {
    if (listingId) {
      const cases = await prisma.evidenceCase.findMany({ where: { listingId }, select: { id: true } });
      const ids = cases.map(item => item.id);
      await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposing' } });
      await prisma.evidenceEvent.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.evidenceAsset.deleteMany({ where: { caseId: { in: ids } } });
      await prisma.evidenceCase.updateMany({ where: { id: { in: ids } }, data: { status: 'disposed', snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null } });
      await prisma.evidenceCase.deleteMany({ where: { id: { in: ids } } });
      await prisma.listing.deleteMany({ where: { id: listingId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: [seller.id, buyer] } } });
    await prisma.$disconnect();
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});

test('database image writes keep listing images within the hard limit under concurrency', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }

  const env = process.env as Record<string, string | undefined>;
  const previousStore = env.SMARTSTORE_MARKETPLACE_STORE;
  const previousImageLimit = env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
  const seller = {
    id: `db-integration-seller-${Date.now()}`,
    email: `db-integration-${Date.now()}@smartstore.local`,
  };
  let listingId: string | null = null;

  env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  env.SMARTSTORE_MAX_IMAGES_PER_LISTING = String(hardMaxListingImages);

  try {
    const [{ prisma }, repository] = await Promise.all([
      import('@/lib/db/prisma'),
      import('@/agent/marketplace/repository'),
    ]);
    const listing = await repository.createListingDraft(seller, {
      category: 'cars',
      title: 'DB integration image limit listing',
      description: 'Synthetic listing used by the optional database integration test.',
      city: 'Riyadh',
      price: 1000,
    });
    listingId = listing.id;

    await Promise.all(
      Array.from({ length: hardMaxListingImages + 6 }, (_, index) =>
        repository.addListingImageForSeller(
          listing.id,
          seller.id,
          createImage(index, listing.id),
        ),
      ),
    );

    const updated = await repository.getListing(listing.id);

    assert.equal(updated?.images.length, hardMaxListingImages);
    assert.equal(
      updated?.images.filter((image) => image.isPrimary).length,
      1,
    );

    await prisma.$disconnect();
  } finally {
    try {
      const { prisma } = await import('@/lib/db/prisma');

      if (listingId) {
        await prisma.listing.deleteMany({ where: { id: listingId } });
      }

      await prisma.user.deleteMany({ where: { id: seller.id } });
      await prisma.$disconnect();
    } finally {
      if (previousStore === undefined) {
        delete env.SMARTSTORE_MARKETPLACE_STORE;
      } else {
        env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
      }

      if (previousImageLimit === undefined) {
        delete env.SMARTSTORE_MAX_IMAGES_PER_LISTING;
      } else {
        env.SMARTSTORE_MAX_IMAGES_PER_LISTING = previousImageLimit;
      }
    }
  }
});

test('database favorite toggles keep the counter consistent under concurrency', async (t) => {
  if (!shouldRunDatabaseIntegration()) {
    t.skip('Set DATABASE_URL and run pnpm test:db:integration to exercise a real database.');
    return;
  }

  const env = process.env as Record<string, string | undefined>;
  const previousStore = env.SMARTSTORE_MARKETPLACE_STORE;
  const seller = {
    id: `db-integration-favorite-seller-${Date.now()}`,
    email: `db-integration-favorite-seller-${Date.now()}@smartstore.local`,
  };
  const buyer = {
    id: `db-integration-favorite-buyer-${Date.now()}`,
    email: `db-integration-favorite-buyer-${Date.now()}@smartstore.local`,
  };
  let listingId: string | null = null;

  env.SMARTSTORE_MARKETPLACE_STORE = 'database';

  try {
    const [{ prisma }, repository] = await Promise.all([
      import('@/lib/db/prisma'),
      import('@/agent/marketplace/repository'),
    ]);
    const listing = await repository.createListingDraft(seller, {
      category: 'cars',
      title: 'DB integration favorite race listing',
      description: 'Synthetic listing used by the optional favorite race test.',
      city: 'Riyadh',
      price: 1000,
    });
    listingId = listing.id;

    await repository.addListingImageForSeller(
      listing.id,
      seller.id,
      createImage(1, listing.id),
    );
    await repository.setListingStatusForSeller(
      listing.id,
      seller.id,
      'published',
    );

    await Promise.all([
      repository.toggleFavoriteListing(listing.id, buyer),
      repository.toggleFavoriteListing(listing.id, buyer),
    ]);

    const [favoriteCount, updatedListing] = await Promise.all([
      prisma.favorite.count({ where: { listingId: listing.id } }),
      repository.getListing(listing.id),
    ]);

    assert.equal(favoriteCount, 0);
    assert.equal(updatedListing?.favoriteCount, favoriteCount);

    await prisma.$disconnect();
  } finally {
    try {
      const { prisma } = await import('@/lib/db/prisma');

      if (listingId) {
        await prisma.listing.deleteMany({ where: { id: listingId } });
      }

      await prisma.user.deleteMany({
        where: { id: { in: [seller.id, buyer.id] } },
      });
      await prisma.$disconnect();
    } finally {
      if (previousStore === undefined) {
        delete env.SMARTSTORE_MARKETPLACE_STORE;
      } else {
        env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
      }
    }
  }
});
