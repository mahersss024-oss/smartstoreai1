import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { DELETE as deleteListing, PATCH as editListing } from '@/app/api/admin/listings/[listingId]/route';
import { PATCH as resolveReport } from '@/app/api/admin/moderation/reports/[reportId]/route';
import { setReportModerationStatus } from '@/agent/marketplace/repository';
import * as memoryStore from '@/agent/marketplace/store';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';
import { activeStaffAccount, staffAccountQuery } from './helpers/staff-fixture';

function environment(t: TestContext) {
  for (const [key, value] of Object.entries({
    SMARTSTORE_MARKETPLACE_STORE: 'database', DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:9/unused', SMARTSTORE_ADMIN_EMAILS: 'moderation-owner@example.test',
    AUTH_SECRET: 'isolated-admin-moderation-mutations-only', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => ({ ...activeStaffAccount }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => ({ id: 'moderation-owner' }));
  mockDatabaseMethod(t, prisma.user, 'update', async () => ({ id: 'moderation-owner' }));
  mockDatabaseMethod(t, prisma.evidenceAsset, 'count', async () => 0);
  const token = createSignedSession({ id: 'moderation-owner', email: 'moderation-owner@example.test' });
  return (path: string, method: string, body?: object) => new Request('https://example.test' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

for (const [currentStatus, cleanupUnavailable] of [['published', false], ['deleted', false], ['deleted', true]] as const) {
  test(`permanent listing deletion uses the locked current ${currentStatus} state${cleanupUnavailable ? ' while cleanup storage is unavailable' : ''}`, async t => {
    const request = environment(t);
    const identity = { id: 'delete-listing', sellerId: 'seller', status: 'deleted', images: [] };
    const current = { ...identity, status: currentStatus, images: [{ id: 'new-image', originalUrl: 'https://example.test/new.webp', displayUrl: 'https://example.test/new.webp', thumbnailUrl: 'https://example.test/new-thumb.webp' }] };
    const locks: string[] = [];
    let deleted = 0;
    let audits = 0;
    const queued: Array<{ imageId: string; urls: string[]; preserveForRecovery: boolean }> = [];
    mockDatabaseMethod(t, prisma.imageObjectCleanup, 'findUnique', async () => {
      if (cleanupUnavailable) throw new Error('synthetic_cleanup_database_unavailable');
      return null;
    });
    mockDatabaseMethod(t, prisma.evidenceAsset, 'count', async ({ where }: { where: { sourceHash: { in: string[] } } }) => {
      assert.ok(where.sourceHash.in.length); return 0;
    });
    mockDatabaseMethod(t, prisma.listing, 'findUnique', async () => identity);
    mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
      $queryRaw: staffAccountQuery('moderation-owner'),
      $executeRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join('?')); return 1; },
      listing: {
        findUnique: async () => { assert.match(locks.at(-1)!, /FOR UPDATE/); return current; },
        delete: async () => { deleted++; return current; },
      },
      imageObjectCleanup: { upsert: async ({ create }: { create: typeof queued[number] }) => { queued.push(create); return create; } },
      adminAuditLog: { create: async () => { audits++; return {}; } },
    }));
    const response = await deleteListing(request('/api/admin/listings/delete-listing', 'DELETE'), {
      params: Promise.resolve({ listingId: identity.id }),
    });
    assert.equal(response.status, currentStatus === 'deleted' ? 200 : 409);
    assert.equal(deleted, currentStatus === 'deleted' ? 1 : 0);
    assert.equal(audits, deleted);
    assert.equal(locks.length, 3);
    assert.ok(locks.slice(0, 2).every(sql => sql.includes('pg_advisory_xact_lock')));
    if (currentStatus === 'published') assert.equal((await response.json()).error, 'listing_must_be_deleted_first');
    else assert.deepEqual(queued, [{ imageId: current.images[0].id, ownerId: undefined,
      urls: [...new Set([current.images[0].originalUrl, current.images[0].displayUrl, current.images[0].thumbnailUrl])],
      preserveForRecovery: true }], 'durable cleanup captures the images read inside the locked transaction');
  });
}

test('a stale administrative listing save returns a conflict without mutation or audit', async t => {
  const request = environment(t);
  const listing = { id: 'changed-listing', sellerId: 'seller', updatedAt: new Date('2026-01-02T00:00:00Z') };
  mockDatabaseMethod(t, prisma.listing, 'findUnique', async () => listing);
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    $queryRaw: staffAccountQuery('moderation-owner'),
      $executeRaw: async () => 1,
    listing: { findUnique: async () => listing, update: async () => assert.fail('stale save must not write') },
    adminAuditLog: { create: async () => assert.fail('stale save must not audit a mutation') },
  }));
  const response = await editListing(request('/api/admin/listings/changed-listing', 'PATCH', {
    title: 'A stale title', expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
  }), { params: Promise.resolve({ listingId: listing.id }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'listing_changed');
});

test('concurrent listing-report decisions claim the open report once and audit only the winner', async t => {
  environment(t);
  const report = { id: 'report', status: 'open', listingId: 'listing', reporterId: 'reporter',
    reason: 'fraud', details: null, createdAt: new Date(0), updatedAt: new Date(0), listing: null };
  let reads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>(resolve => { release = resolve; });
  const audits: Array<{ metadata: { previousStatus: string; nextStatus: string } }> = [];
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    $queryRaw: staffAccountQuery('moderation-owner'),
      $executeRaw: async () => 1,
    report: {
      findUnique: async () => { reads++; if (reads === 2) release(); await bothRead; return { status: 'open', listingId: report.listingId, reporterId: report.reporterId, listing: { sellerId: 'seller' } }; },
      updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (report.status !== where.status) return { count: 0 };
        report.status = data.status; return { count: 1 };
      },
      findUniqueOrThrow: async () => ({ ...report }),
    },
    adminAuditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); } },
  }));
  const results = await Promise.all([
    setReportModerationStatus(report.id, 'reviewed', 'moderation-owner'),
    setReportModerationStatus(report.id, 'dismissed', 'moderation-owner'),
  ]);
  assert.equal(results.filter(result => result.status === 'already_resolved').length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.previousStatus, 'open');
  assert.equal(audits[0].metadata.nextStatus, report.status);
});

test('the listing-report route returns 409 when another moderator already resolved it', async t => {
  const request = environment(t);
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    report: { findUnique: async () => ({ status: 'reviewed' }), updateMany: async () => assert.fail('closed report must not change') },
    $queryRaw: staffAccountQuery('moderation-owner'),
  }));
  const response = await resolveReport(request('/api/admin/moderation/reports/report', 'PATCH', { action: 'dismiss' }), {
    params: Promise.resolve({ reportId: 'report' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'report_already_resolved');
});

test('one report request changes its listing and decision while stale closed reports cannot change the listing', async t => {
  const request = environment(t);
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  for (const [action, expected] of [['delete_listing', 'deleted'], ['reject_listing', 'rejected']] as const) {
    const listing = memoryStore.createListingDraft({ sellerId: `atomic-seller-${randomUUID()}`, category: 'furniture', title: 'Atomic report fixture' });
    memoryStore.setListingModerationStatus(listing.id, 'published');
    const publishedAt = memoryStore.getListing(listing.id)!.firstPublishedAt;
    const report = memoryStore.reportListing(listing.id, `atomic-buyer-${randomUUID()}`, 'fraud').report!;
    const response = await resolveReport(request(`/api/admin/moderation/reports/${report.id}`, 'PATCH', { action }), {
      params: Promise.resolve({ reportId: report.id }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).report.status, 'reviewed');
    assert.equal(memoryStore.getListing(listing.id)!.status, expected);
    assert.equal(memoryStore.getListing(listing.id)!.compliance.humanDecision, 'block');
    assert.equal(memoryStore.getListing(listing.id)!.firstPublishedAt, publishedAt);
    const stale = await resolveReport(request(`/api/admin/moderation/reports/${report.id}`, 'PATCH', { action: 'delete_listing' }), {
      params: Promise.resolve({ reportId: report.id }),
    });
    assert.equal(stale.status, 409);
    assert.equal(memoryStore.getListing(listing.id)!.status, expected);
  }
  const listing = memoryStore.createListingDraft({ sellerId: `dismissed-seller-${randomUUID()}`, category: 'furniture' });
  memoryStore.setListingModerationStatus(listing.id, 'published');
  const report = memoryStore.reportListing(listing.id, `dismissed-buyer-${randomUUID()}`, 'fraud').report!;
  memoryStore.setReportModerationStatus(report.id, 'dismissed');
  const stale = await resolveReport(request(`/api/admin/moderation/reports/${report.id}`, 'PATCH', { action: 'delete_listing' }), {
    params: Promise.resolve({ reportId: report.id }),
  });
  assert.equal(stale.status, 409);
  assert.equal(memoryStore.getListing(listing.id)!.status, 'published');
});

test('a missing report target leaves its open decision untouched and locks evidence keys before the listing row', async t => {
  const request = environment(t);
  const locks: Array<{ sql: string; values: unknown[] }> = [];
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => work({
    $queryRaw: staffAccountQuery('moderation-owner'),
      $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => { locks.push({ sql: sql.join('?'), values }); return 1; },
    report: {
      findUnique: async () => ({ status: 'open', listingId: 'missing-listing', reporterId: 'reporter', listing: { sellerId: 'seller' } }),
      updateMany: async () => assert.fail('an absent target must not close the report'),
    },
    listing: { findUnique: async () => null, update: async () => assert.fail('an absent target must not be written') },
    adminAuditLog: { create: async () => assert.fail('no decision was made') },
  }));
  const response = await resolveReport(request('/api/admin/moderation/reports/report', 'PATCH', { action: 'delete_listing' }), {
    params: Promise.resolve({ reportId: 'report' }),
  });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'listing_not_found');
  assert.deepEqual(locks.slice(0, 3).map(lock => lock.values[0]), ['listing:missing-listing', 'user:reporter', 'user:seller']);
  assert.ok(locks.slice(0, 3).every(lock => lock.sql.includes('pg_advisory_xact_lock')));
  assert.match(locks[3].sql, /FOR UPDATE/);
});

test('report listing actions reject guests and ordinary customers before persistence', async t => {
  environment(t);
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  mockDatabaseMethod(t, prisma, '$transaction', async () => assert.fail('unauthorized request must not start a transaction'));
  const customerToken = createSignedSession({ id: 'ordinary-customer', email: 'ordinary@example.test', role: 'user' });
  for (const token of [undefined, customerToken]) {
    const response = await resolveReport(new Request('https://example.test/api/admin/moderation/reports/report', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ action: 'delete_listing' }),
    }), { params: Promise.resolve({ reportId: 'report' }) });
    assert.equal(response.status, token ? 403 : 401);
  }
});
