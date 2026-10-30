import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, type CommissionStatus } from '@prisma/client';

import { DELETE as deleteProfile, PATCH as updateProfile } from '@/app/api/account/profile/route';
import { createListingDraft, setListingStatusForSeller } from '@/agent/marketplace/repository';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

function requireLocalDatabase() {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return false;
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  return true;
}

async function fixture() {
  const suffix = randomUUID();
  const identity = { id: `integrity-${suffix}`, email: `integrity-${suffix}@example.test`, name: 'Before deletion' };
  await prisma.user.create({ data: identity });
  const listing = await prisma.listing.create({ data: {
    id: `integrity-listing-${suffix}`, sellerId: identity.id, category: 'other',
    title: 'Local integrity fixture', description: 'Disposable account integrity test',
    price: 1000, status: 'published', attributes: {},
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
  } });
  const request = (method: string, body?: unknown) => new Request('https://example.test/api/account/profile', {
    method,
    headers: { Authorization: `Bearer ${createSignedSession(identity)}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const cleanup = async () => {
    // Only the uniquely named local fixture is removed. No EvidenceCase exists.
    await prisma.user.deleteMany({ where: { id: identity.id } });
    await prisma.adminAuditLog.deleteMany({ where: { targetType: 'user', targetId: identity.id } });
  };
  return { identity, listing, request, cleanup };
}

for (const status of ['pending_amount', 'due', 'disputed', 'paid', 'waived'] satisfies CommissionStatus[]) {
  test(`PostgreSQL self-deletion retains the ${status} financial ledger without an evidence case`, { timeout: 20000 }, async t => {
    if (!requireLocalDatabase()) return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
    const f = await fixture();
    try {
      const commission = await prisma.commission.create({ data: {
        listingId: f.listing.id, sellerId: f.identity.id, status,
        productValue: 1000, commissionAmount: 10, commissionRatePercent: 1,
      } });
      assert.equal(await prisma.evidenceCase.count({ where: { participantIds: { has: f.identity.id } } }), 0);
      const response = await deleteProfile(f.request('DELETE'));
      assert.equal(response.status, 200);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: f.identity.id } });
      assert.ok(user.deletedAt);
      assert.equal((await prisma.listing.findUniqueOrThrow({ where: { id: f.listing.id } })).status, 'deleted');
      const retained = await prisma.commission.findUniqueOrThrow({ where: { id: commission.id } });
      assert.equal(retained.status, status);
      assert.equal(retained.commissionAmount?.toNumber(), 10);
      assert.equal(retained.productValue?.toNumber(), 1000);
      assert.equal((await updateProfile(f.request('PATCH', { displayName: 'Late update', phoneNumber: '' }))).status, 401);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: f.identity.id } })).name, f.identity.name);
    } finally { await f.cleanup(); }
  });
}

test('PostgreSQL a profile request paused before persistence cannot recreate a permanently deleted account', { timeout: 20000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
  const f = await fixture();
  let release!: () => void;
  let started!: () => void;
  const pause = new Promise<void>(resolve => { release = resolve; });
  const reading = new Promise<void>(resolve => { started = resolve; });
  const delayed = f.request('PATCH', { displayName: 'Late update', phoneNumber: '' });
  Object.defineProperty(delayed, 'json', { value: async () => {
    started();
    await pause;
    return { displayName: 'Late update', phoneNumber: '' };
  } });
  // Authentication runs before the request body is consumed. This request has
  // already passed authentication when deletion completes on another request.
  const pending = updateProfile(delayed);
  try {
    await reading;
    const response = await deleteProfile(f.request('DELETE'));
    assert.equal(response.status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: f.identity.id } }), null);
    release();
    assert.equal((await pending).status, 401);
    assert.equal(await prisma.user.findUnique({ where: { id: f.identity.id } }), null);
  } finally {
    release();
    await pending.catch(() => {});
    await f.cleanup();
  }
});

test('PostgreSQL concurrent sale and self-deletion never erase an accepted sale commission', { timeout: 45000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
  // Repeated overlapping real transactions exercise the FK/advisory/row-lock
  // interaction. Deterministic blocked-request schedules live in the unit tests.
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = await fixture();
    try {
      const [saleResult, deletionResult] = await Promise.allSettled([
        setListingStatusForSeller(f.listing.id, f.identity.id, 'sold'),
        deleteProfile(f.request('DELETE')),
      ]);
      // Both transactions must settle before fixture cleanup, including failures.
      if (saleResult.status === 'rejected') throw saleResult.reason;
      if (deletionResult.status === 'rejected') throw deletionResult.reason;
      const sale = saleResult.value;
      const response = deletionResult.value;
      assert.equal(response.status, 200);
      const ledger = await prisma.commission.findUnique({ where: { listingId: f.listing.id } });
      if (sale?.status === 'sold') assert.ok(ledger, 'A committed sale must retain its financial record');
      if (ledger) {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: f.identity.id } });
        assert.ok(user.deletedAt);
        assert.equal(ledger.status, 'pending_amount');
        assert.equal(ledger.commissionAmount, null);
      }
    } finally { await f.cleanup(); }
  }
});


test('PostgreSQL production marketplace writes cannot recreate missing or disabled accounts', { timeout: 20000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
  const previousEnvironment = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try {
    for (const retain of [false, true]) {
      const f = await fixture();
      try {
        if (retain) await prisma.commission.create({ data: {
          listingId: f.listing.id, sellerId: f.identity.id, status: 'due', productValue: 1000, commissionAmount: 10,
        } });
        assert.equal((await deleteProfile(f.request('DELETE'))).status, 200);
        const before = await prisma.user.findUnique({ where: { id: f.identity.id } });
        await assert.rejects(createListingDraft(f.identity, {
          category: 'other', autoCategory: false, title: 'Late authenticated draft',
        }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2025'));
        const after = await prisma.user.findUnique({ where: { id: f.identity.id } });
        assert.deepEqual(after, before);
        assert.equal(await prisma.listing.count({ where: { sellerId: f.identity.id, status: 'draft' } }), 0);
      } finally { await f.cleanup(); }
    }
  } finally {
    if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: previousEnvironment });
  }
});


test('PostgreSQL deletion retries an older snapshot and retains a concurrently accepted sale', { timeout: 30000 }, async t => {
  if (!requireLocalDatabase()) return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
  const f = await fixture();
  let resume!: () => void;
  let snapshotTaken!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const reached = new Promise<void>(resolve => { snapshotTaken = resolve; });
  let intercepted = false;
  let deletionAttempts = 0;
  const transact = prisma.$transaction.bind(prisma);
  // Keep real PostgreSQL operations. Only pause the first deletion snapshot,
  // before it takes advisory or row locks, so the sale can commit concurrently.
  t.mock.method(prisma, '$transaction', (async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ) => {
    if (options?.isolationLevel !== Prisma.TransactionIsolationLevel.Serializable) return transact(work, options);
    deletionAttempts++;
    return transact(async tx => {
      const database = new Proxy(tx, {
        get(target, key) {
          if (key !== 'listing') return Reflect.get(target, key);
          return new Proxy(target.listing, {
            get(delegate, operation) {
              if (operation !== 'findMany') return Reflect.get(delegate, operation);
              return async (input: Parameters<typeof delegate.findMany>[0]) => {
                const records = await delegate.findMany(input);
                if (!intercepted) {
                  intercepted = true;
                  snapshotTaken();
                  await paused;
                }
                return records;
              };
            },
          });
        },
      });
      return work(database);
    }, options);
  }) as never);
  const deletion = deleteProfile(f.request('DELETE'));
  try {
    await reached;
    const sale = await setListingStatusForSeller(f.listing.id, f.identity.id, 'sold');
    assert.equal(sale?.status, 'sold', 'This schedule must actually accept the sale');
    const committed = await prisma.commission.findUniqueOrThrow({ where: { listingId: f.listing.id } });
    assert.equal(committed.status, 'pending_amount');
    assert.equal(committed.commissionAmount, null);
    resume();
    assert.equal((await deletion).status, 200);
    assert.ok(deletionAttempts >= 2, 'The stale serializable deletion must retry');
    const retained = await prisma.commission.findUniqueOrThrow({ where: { id: committed.id } });
    assert.equal(retained.status, 'pending_amount');
    assert.equal(retained.commissionAmount, null);
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: f.identity.id } })).deletedAt);
  } finally {
    resume();
    await deletion.catch(() => {});
    await f.cleanup();
  }
});
