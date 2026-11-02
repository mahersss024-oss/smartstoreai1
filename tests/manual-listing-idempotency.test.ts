import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { POST as createListing } from '@/app/api/marketplace/listings/route';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

type Receipt = {
  namespace: string; actorKey: string; key: string;
  status: string; updatedAt: Date; response: unknown; statusCode: number | null;
};
type Listing = Record<string, unknown> & { id: string; sellerId: string; title: string; status: string };

function fixture(t: TestContext) {
  const values = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', NODE_ENV: 'test',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory', AUTH_SECRET: 'isolated-manual-listing-idempotency-secret',
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const receipts = new Map<string, Receipt>();
  const listings = new Map<string, Listing>();
  let failAcknowledgement = false;
  let creates = 0;
  const receiptKey = (value: { namespace: string; actorKey: string; key: string }) =>
    JSON.stringify([value.namespace, value.actorKey, value.key]);

  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'create', async ({ data }: { data: Receipt }) => {
    const key = receiptKey(data);
    if (receipts.has(key)) throw new Error('unique_reservation_conflict');
    const row = { ...data, status: 'pending', updatedAt: new Date(), response: null, statusCode: null };
    receipts.set(key, row);
    return row;
  });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'findUnique', async ({ where }: {
    where: { namespace_actorKey_key: Receipt };
  }) => structuredClone(receipts.get(receiptKey(where.namespace_actorKey_key)) ?? null));
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'update', async ({ where, data }: {
    where: { namespace_actorKey_key: Receipt }; data: Partial<Receipt>;
  }) => {
    if (failAcknowledgement) {
      failAcknowledgement = false;
      throw new Error('receipt_write_unavailable_after_listing_commit');
    }
    const row = receipts.get(receiptKey(where.namespace_actorKey_key));
    assert.ok(row);
    Object.assign(row, data, { updatedAt: new Date() });
    return row;
  });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'updateMany', async ({ where, data }: {
    where: Receipt; data: Partial<Receipt>;
  }) => {
    const row = receipts.get(receiptKey(where));
    if (!row || row.status !== where.status || row.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 };
    Object.assign(row, data, { updatedAt: new Date() });
    return { count: 1 };
  });
  mockDatabaseMethod(t, prisma.apiIdempotencyKey, 'deleteMany', async ({ where }: { where: Receipt }) => {
    const row = receipts.get(receiptKey(where));
    return { count: row?.status === where.status && receipts.delete(receiptKey(where)) ? 1 : 0 };
  });
  mockDatabaseMethod(t, prisma.user, 'upsert', async ({ where }: { where: { id: string } }) => ({ id: where.id }));
  const findListing = async ({ where }: { where: { id: string } }) => listings.get(where.id) ?? null;
  mockDatabaseMethod(t, prisma.listing, 'findUnique', findListing);
  t.mock.method(prisma, '$transaction', async (work: unknown) => {
    assert.equal(typeof work, 'function');
    return (work as (tx: unknown) => Promise<unknown>)({ listing: {
      findUnique: findListing,
      count: async () => listings.size,
      create: async ({ data }: { data: Listing }) => {
        assert.ok(!listings.has(data.id), 'a replay must find the committed source before inserting');
        const row = { ...data, createdAt: new Date(), updatedAt: new Date(), images: [], views: 0, messageCount: 0, favoriteCount: 0 };
        creates++;
        listings.set(row.id, row);
        return row;
      },
    } });
  });
  const request = (key?: string, title = 'Original manual draft', actor = t.name) =>
    new Request('https://souqhamad.test/api/marketplace/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${createSignedSession({ id: actor, email: `${actor.length}@example.test` })}`,
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify({ category: 'other', title }),
    });
  return { receipts, listings, request, creates: () => creates,
    failNextAcknowledgement: () => { failAcknowledgement = true; },
    agePending: () => { for (const row of receipts.values()) row.updatedAt = new Date(Date.now() - 121_000); },
  };
}

test('manual create replays its committed listing after the response receipt failed and its reservation became stale', async t => {
  const f = fixture(t);
  f.failNextAcknowledgement();
  await assert.rejects(createListing(f.request('lost-acknowledgement')), /receipt_write_unavailable_after_listing_commit/);
  assert.equal(f.listings.size, 1);
  const committed = [...f.listings.values()][0];
  assert.equal([...f.receipts.values()][0].status, 'pending');
  assert.equal((await createListing(f.request('lost-acknowledgement'))).status, 409);
  f.agePending();

  const replay = await createListing(f.request('lost-acknowledgement', 'Retry wording must not replace the original'));
  assert.equal(replay.status, 201);
  const body = await replay.json();
  assert.equal(body.listing.id, committed.id);
  assert.equal(body.listing.title, 'Original manual draft');
  assert.equal(f.creates(), 1);
  assert.equal(f.listings.size, 1);
  assert.equal([...f.receipts.values()][0].status, 'completed');
});

for (const status of ['published', 'deleted']) {
  test(`a pruned manual-create receipt cannot replace or resurrect its ${status} source`, async t => {
    const f = fixture(t);
    const first = await createListing(f.request('pruned-receipt'));
    assert.equal(first.status, 201);
    const original = (await first.json()).listing;
    const saved = f.listings.get(original.id)!;
    saved.status = status;
    saved.title = 'Canonical edited title';
    f.receipts.clear();

    const replay = await createListing(f.request('pruned-receipt', 'Stale client title'));
    assert.equal(replay.status, 201);
    const body = await replay.json();
    assert.equal(body.listing.id, original.id);
    assert.equal(body.listing.status, status);
    assert.equal(body.listing.title, 'Canonical edited title');
    assert.equal(f.creates(), 1);
  });
}

test('manual create keeps different keys and actors independent', async t => {
  const f = fixture(t);
  const ids = new Set<string>();
  for (const [actor, key] of [['first-owner', 'shared-key'], ['first-owner', 'different-key'], ['second-owner', 'shared-key']]) {
    const response = await createListing(f.request(key, 'Independent draft', `${t.name}:${actor}`));
    assert.equal(response.status, 201);
    ids.add((await response.json()).listing.id);
  }
  assert.equal(ids.size, 3);
  assert.equal(f.creates(), 3);
});

test('manual create without an idempotency header still creates a fresh draft for each request', async t => {
  const f = fixture(t);
  const first = await createListing(f.request());
  const second = await createListing(f.request());
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual((await first.json()).listing.id, (await second.json()).listing.id);
  assert.equal(f.creates(), 2);
  assert.equal(f.receipts.size, 0);
});

test('source operation identities are stable, opaque, and scoped to namespace and actor', async t => {
  const f = fixture(t);
  const request = f.request('client-private-operation-key');
  const first = await reserveIdempotencyKey(request, { namespace: 'one', actorKey: 'owner' });
  const pending = await reserveIdempotencyKey(request, { namespace: 'one', actorKey: 'owner' });
  const namespace = await reserveIdempotencyKey(request, { namespace: 'two', actorKey: 'owner' });
  const actor = await reserveIdempotencyKey(request, { namespace: 'one', actorKey: 'other-owner' });
  assert.match(first!.operationKey, /^[a-f0-9]{64}$/);
  assert.equal(first!.operationKey, pending!.operationKey);
  assert.notEqual(first!.operationKey, namespace!.operationKey);
  assert.notEqual(first!.operationKey, actor!.operationKey);
  assert.ok(!first!.operationKey.includes('client-private-operation-key'));
});
