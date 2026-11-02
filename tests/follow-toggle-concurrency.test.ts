import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { toggleSellerFollow, toggleSimilarListingFollow } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

function fixture(t: TestContext) {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE; process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => { if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE; else process.env.SMARTSTORE_MARKETPLACE_STORE = previous; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  mockDatabaseMethod(t, prisma.user, 'upsert', async () => ({ id: 'follow-user' }));
  mockDatabaseMethod(t, prisma.user, 'findFirst', async () => ({ id: 'follow-seller' }));
  mockDatabaseMethod(t, prisma.listing, 'findUnique', async () => ({
    id: 'follow-listing', sellerId: 'follow-seller', category: 'furniture', title: 'Desk', description: 'Local desk',
    status: 'published', createdAt: new Date(), updatedAt: new Date(), images: [], compliance: {},
  }));
  const entered = deferred(), releaseCreate = deferred();
  const lockTails = new Map<string, Promise<void>>();
  let reads = 0, creates = 0, row: { id: string } | null = null;
  const delegate = {
    findUnique: async () => { reads++; return row && { ...row }; },
    create: async () => { creates++; entered.resolve(); await releaseCreate.promise;
      assert.equal(row, null, 'the unique pair must not be created twice'); row = { id: 'follow' }; return row; },
    delete: async () => { assert.ok(row); row = null; },
    count: async () => row ? 1 : 0,
  };
  for (const target of [prisma.sellerFollow, prisma.similarListingFollow]) {
    for (const [name, method] of Object.entries(delegate)) mockDatabaseMethod(t, target, name, method);
  }
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: unknown) => Promise<unknown>) => {
    const releases: Array<() => void> = [];
    const tx = { sellerFollow: delegate, similarListingFollow: delegate,
      $executeRaw: async (_sql: TemplateStringsArray, key: string) => {
        const prior = lockTails.get(key) ?? Promise.resolve(); const next = deferred();
        lockTails.set(key, next.promise); await prior; releases.push(next.resolve); return 1;
      } };
    try { return await work(tx); } finally { releases.forEach(release => release()); }
  });
  return { entered, releaseCreate, reads: () => reads, creates: () => creates, row: () => row };
}

for (const kind of ['seller', 'similar'] as const) test(`${kind} follow toggles serialize the same pair without unique-constraint failures`, async t => {
  const f = fixture(t);
  const toggle = () => kind === 'seller' ? toggleSellerFollow('follow-seller', 'follow-user')
    : toggleSimilarListingFollow('follow-listing', 'follow-user');
  const first = toggle(); await f.entered.promise;
  const second = toggle();
  try {
    await setImmediate(); await setImmediate();
    assert.equal(f.reads(), 1, 'the second toggle must wait before reading the current pair');
  } finally { f.releaseCreate.resolve(); }
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(x => x.status), ['followed', 'unfollowed']);
  assert.equal(f.creates(), 1); assert.equal(f.row(), null);
});
