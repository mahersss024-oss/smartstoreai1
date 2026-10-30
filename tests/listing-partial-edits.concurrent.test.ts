import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';

import { updateListingForSeller } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';
import { InvalidMarketplaceCategoryOptionError } from '@/lib/marketplace/category-options';

function mockListingDatabase(t: TestContext, beforeFirstLock?: (row: Record<string, unknown>) => void) {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  let row: Record<string, unknown> = {
    id: 'partial-edit-listing', sellerId: 'partial-edit-seller', category: 'other',
    title: 'Original desk', description: 'Original description', price: 10, priceMode: null,
    city: null, condition: null, attributes: { color: 'black', material: 'wood' },
    status: 'published', images: [], searchText: 'original desk original description',
    compliance: { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false },
    views: 0, messageCount: 0, favoriteCount: 0,
    firstPublicationTracked: true, firstPublishedAt: new Date(0),
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const originalFind = prisma.listing.findUnique;
  const originalTransaction = prisma.$transaction;
  t.after(() => {
    prisma.listing.findUnique = originalFind;
    prisma.$transaction = originalTransaction;
  });
  // Both calls can observe the same preflight snapshot. Only the transaction's
  // row-lock read may supply the data merged into the eventual write.
  prisma.listing.findUnique = (async () => structuredClone(row)) as never;
  let tail = Promise.resolve();
  let first = true;
  let writes = 0;
  let locks = 0;
  prisma.$transaction = (async (work: (tx: unknown) => Promise<unknown>) => {
    let release: (() => void) | undefined;
    let acquired = false;
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('pg_advisory_xact_lock')) {
          if (values[0] === 'listing:partial-edit-listing') {
            const previous = tail;
            tail = new Promise<void>(resolve => { release = resolve; });
            await previous;
            acquired = true;
            if (first) { first = false; beforeFirstLock?.(row); }
          } else {
            assert.equal(acquired, true, 'listing evidence key precedes the user key');
            assert.deepEqual(values, ['user:partial-edit-seller']);
          }
          return 1;
        }
        assert.match(sql, /SELECT 1 FROM "Listing" WHERE id = .* FOR UPDATE/);
        assert.deepEqual(values, ['partial-edit-listing']);
        assert.equal(acquired, true, 'evidence keys must precede the row lock');
        locks++;
        return 1;
      },
      listing: {
        findUnique: async () => {
          assert.equal(acquired, true, 'fresh snapshot must be read after acquiring the row lock');
          return structuredClone(row);
        },
        update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          if (where.sellerId !== row.sellerId || where.status !== row.status ||
              (where.compliance && JSON.stringify((where.compliance as { equals: unknown }).equals) !== JSON.stringify(row.compliance))) {
            throw new Prisma.PrismaClientKnownRequestError('Concurrent state changed', { code: 'P2025', clientVersion: 'test' });
          }
          row = { ...row, ...structuredClone(Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))) };
          writes++;
          return structuredClone(row);
        },
      },
    };
    try { return await work(tx); } finally { release?.(); }
  }) as never;
  return { row: () => row, writes: () => writes, locks: () => locks };
}

test('concurrent partial listing edits preserve independently changed attributes', async t => {
  const state = mockListingDatabase(t);
  const results = await Promise.all([
    updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { attributes: { color: 'white' } }),
    updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { attributes: { material: 'steel' } }),
  ]);
  assert.ok(results.every(Boolean));
  assert.equal(state.writes(), 2);
  assert.equal(state.locks(), 2);
  assert.deepEqual(state.row().attributes, { color: 'white', material: 'steel' });
});

test('a concurrent price edit rebuilds search text from the accepted current title', async t => {
  const state = mockListingDatabase(t);
  const results = await Promise.all([
    updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { title: 'New desk' }),
    updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { price: 25 }),
  ]);
  assert.ok(results.every(Boolean));
  assert.equal(state.row().title, 'New desk');
  assert.equal(state.row().price, 25);
  assert.match(String(state.row().searchText), /new desk/i);
  assert.doesNotMatch(String(state.row().searchText), /original desk/i);
});

test('a human rejection committed while an edit waits remains authoritative', async t => {
  const state = mockListingDatabase(t, row => {
    row.status = 'rejected';
    row.compliance = { decision: 'block', humanDecision: 'block', reasons: ['Human decision'], jurisdiction: 'SA', shariaSensitive: false };
  });
  const result = await updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { title: 'Customer edited title' });
  assert.equal(result?.title, 'Customer edited title');
  assert.equal(state.row().status, 'rejected');
  assert.equal((state.row().compliance as Record<string, unknown>).humanDecision, 'block');
  assert.equal((state.row().compliance as Record<string, unknown>).decision, 'block');
});

for (const changed of ['published', 'deleted', 'owner'] as const) {
  test(`draft edits recheck ${changed} state after waiting for the lock`, async t => {
    const state = mockListingDatabase(t, row => {
      if (changed === 'owner') row.sellerId = 'another-seller';
      else row.status = changed;
    });
    state.row().status = 'draft';
    const result = await updateListingForSeller('partial-edit-listing', 'partial-edit-seller', { title: 'Late draft edit' }, { draftOnly: true });
    assert.equal(result, null);
    assert.equal(state.writes(), 0);
    assert.equal(state.row().title, 'Original desk');
  });
}

test('category-specific attributes are revalidated against the locked current category', async t => {
  const state = mockListingDatabase(t, row => { row.category = 'other'; row.attributes = {}; });
  state.row().category = 'cars';
  state.row().attributes = { marketplaceCategoryOption: 'toyota' };
  await assert.rejects(updateListingForSeller('partial-edit-listing', 'partial-edit-seller', {
    attributes: { marketplaceCategoryOption: 'toyota' },
  }), InvalidMarketplaceCategoryOptionError);
  assert.equal(state.writes(), 0);
});
