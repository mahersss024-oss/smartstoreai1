import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { GET as getListings } from '@/app/api/admin/listings/route';
import { GET as getAuditLog } from '@/app/api/admin/audit-log/route';
import { GET as getCommissions } from '@/app/api/admin/commissions/route';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';
import { activeStaffAccount } from './helpers/staff-fixture';

function environment(t: TestContext) {
  const values = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:9/unused',
    SMARTSTORE_ADMIN_EMAILS: 'read-owner@example.test',
    AUTH_SECRET: 'isolated-admin-read-consistency',
  };
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    });
  }
  mockDatabaseMethod(t, prisma.user, 'findUnique', async () => ({ ...activeStaffAccount }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const token = createSignedSession({ id: 'read-owner', email: 'read-owner@example.test' });
  return (path: string) => new Request(`https://example.test${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

test('admin listing pages return exactly their limit without repeating the lookahead record', async t => {
  const request = environment(t);
  for (const total of [25, 49]) {
    const fixtures = Array.from({ length: total }, (_, index) => ({
      id: `listing-${index}`, sellerId: 'seller', category: 'cars',
      title: 'Vehicle', description: null, price: null, priceMode: null,
      city: null, condition: null, status: 'published', views: 0,
      messageCount: 0, favoriteCount: 0, createdAt: new Date(0),
      updatedAt: new Date(0), images: [],
    }));
    mockDatabaseMethod(t, prisma.listing, 'findMany', async (args: {
      skip: number; take: number; orderBy: unknown;
    }) => {
      assert.deepEqual(args.orderBy, [{ updatedAt: 'desc' }, { id: 'desc' }]);
      return fixtures.slice(args.skip, args.skip + args.take);
    });
    mockDatabaseMethod(t, prisma.listing, 'count', async () => total);
    const ids: string[] = [];
    let page: number | null = 1;
    while (page) {
      const response = await getListings(request(`/api/admin/listings?page=${page}&limit=24`));
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.ok(payload.listings.length <= 24);
      if (page === 1) assert.equal(payload.pagination.hasMore, true);
      ids.push(...payload.listings.map((row: { id: string }) => row.id));
      page = payload.pagination.nextPage;
    }
    assert.equal(ids.length, total);
    assert.equal(new Set(ids).size, total);
  }
});

test('audit date filters include the whole Saudi day and exclude the adjoining days', async t => {
  const request = environment(t);
  const fixtures = [
    { id: 'before', createdAt: new Date('2026-11-06T20:59:59.999Z') },
    { id: 'first', createdAt: new Date('2026-11-06T21:00:00.000Z') },
    { id: 'last', createdAt: new Date('2026-11-07T20:59:59.999Z') },
    { id: 'after', createdAt: new Date('2026-11-07T21:00:00.000Z') },
  ];
  let captured: { gte: Date; lte: Date } | undefined;
  mockDatabaseMethod(t, prisma.adminAuditLog, 'findMany', async ({ where }: {
    where: { createdAt: { gte: Date; lte: Date } };
  }) => {
    captured = where.createdAt;
    return fixtures.filter(row => row.createdAt >= captured!.gte && row.createdAt <= captured!.lte);
  });
  mockDatabaseMethod(t, prisma.adminAuditLog, 'count', async () => 2);
  const response = await getAuditLog(request('/api/admin/audit-log?from=2026-11-07&to=2026-11-07'));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).records.map((row: { id: string }) => row.id), ['first', 'last']);
  assert.equal(captured?.gte.toISOString(), '2026-11-06T21:00:00.000Z');
  assert.equal(captured?.lte.toISOString(), '2026-11-07T20:59:59.999Z');
});

test('invalid and reversed audit calendar dates are rejected before database reads', async t => {
  const request = environment(t);
  mockDatabaseMethod(t, prisma.adminAuditLog, 'findMany', async () => assert.fail('invalid dates must not query'));
  for (const query of ['from=2026-02-30', 'to=invalid', 'from=2026-11-08&to=2026-11-07']) {
    assert.equal((await getAuditLog(request(`/api/admin/audit-log?${query}`))).status, 400);
  }
});

test('commission API totals cover the full ledger while its records remain paginated', async t => {
  const request = environment(t);
  mockDatabaseMethod(t, prisma.commission, 'findMany', async ({ take }: { take: number }) =>
    Array.from({ length: take }, (_, index) => ({
      id: `commission-${index}`, listingId: `listing-${index}`, sellerId: 'seller',
      status: 'paid', productValue: 1000, commissionAmount: 10, source: 'site_sale',
      paidAt: new Date(0), createdAt: new Date(0), updatedAt: new Date(0), listing: null,
    })),
  );
  mockDatabaseMethod(t, prisma.commission, 'groupBy', async (args: Record<string, unknown>) => {
    assert.equal(args.skip, undefined);
    assert.equal(args.take, undefined);
    return [
      { status: 'due', _count: { _all: 30 }, _sum: { commissionAmount: { toString: () => '1000.50' } } },
      { status: 'paid', _count: { _all: 50 }, _sum: { commissionAmount: { toString: () => '2000.25' } } },
      { status: 'pending_amount', _count: { _all: 3 }, _sum: { commissionAmount: null } },
    ];
  });
  const response = await getCommissions(request('/api/admin/commissions?limit=20'));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.commissions.length, 20);
  assert.deepEqual(payload.summary, { totalDue: 1000.50, totalPaid: 2000.25, totalRecords: 83 });
});
