import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Prisma } from '@prisma/client';

import { createListingDraft, toggleSellerFollow } from '@/agent/marketplace/repository';
import { prisma } from '@/lib/db/prisma';

const identity = { id: 'old-production-customer', email: 'stale@example.test', name: 'Stale name' };

function productionDatabase(t: TestContext, state: 'active' | 'deleted' | 'missing') {
  const previous = { store: process.env.SMARTSTORE_MARKETPLACE_STORE, environment: process.env.NODE_ENV };
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  Object.assign(process.env, { NODE_ENV: 'production' });
  t.after(() => {
    if (previous.store === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous.store;
    if (previous.environment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: previous.environment });
  });
  const account = state === 'missing' ? null : {
    id: identity.id, email: 'canonical@example.test', name: 'Saved name',
    deletedAt: state === 'deleted' ? new Date(0) : null,
  };
  const currentIdentity = { id: 'new-production-customer', email: identity.email, name: 'New account', deletedAt: null };
  let mutations = 0;
  let creates = 0;
  const originals = {
    findFirst: prisma.user.findFirst, update: prisma.user.update, upsert: prisma.user.upsert,
    findFollow: prisma.sellerFollow.findUnique, createFollow: prisma.sellerFollow.create, countFollow: prisma.sellerFollow.count,
  };
  t.after(() => {
    Object.assign(prisma.user, { findFirst: originals.findFirst, update: originals.update, upsert: originals.upsert });
    Object.assign(prisma.sellerFollow, { findUnique: originals.findFollow, create: originals.createFollow, count: originals.countFollow });
  });
  prisma.user.findFirst = (async () => ({ id: 'production-seller' })) as never;
  prisma.user.upsert = (async () => { creates++; throw new Error('production customer writes must never create accounts'); }) as never;
  prisma.user.update = (async ({ where, data }: { where: { id: string; deletedAt: null }; data: Record<string, unknown> }) => {
    assert.deepEqual(where, { id: identity.id, deletedAt: null });
    assert.deepEqual(data, {}, 'stale identity must not replace canonical account fields');
    if (!account || account.deletedAt) throw new Prisma.PrismaClientKnownRequestError('Account is unavailable', { code: 'P2025', clientVersion: 'test' });
    return account;
  }) as never;
  prisma.sellerFollow.findUnique = (async () => null) as never;
  prisma.sellerFollow.create = (async () => { mutations++; return { id: 'follow' }; }) as never;
  prisma.sellerFollow.count = (async () => 1) as never;
  return { account, currentIdentity, mutations: () => mutations, creates: () => creates };
}

for (const actor of ['identity', 'id'] as const) {
  for (const state of ['missing', 'deleted'] as const) {
    test(`production ${actor} writes cannot recreate a ${state} account`, async t => {
      const database = productionDatabase(t, state);
      const before = structuredClone(database.currentIdentity);
      await assert.rejects(toggleSellerFollow('production-seller', actor === 'identity' ? identity : identity.id),
        (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025');
      assert.equal(database.creates(), 0);
      assert.equal(database.mutations(), 0);
      assert.deepEqual(database.currentIdentity, before, 'a new account with the old email must remain untouched');
    });
  }
  test(`production ${actor} writes retain existing canonical account fields`, async t => {
    const database = productionDatabase(t, 'active');
    const result = await toggleSellerFollow('production-seller', actor === 'identity' ? identity : identity.id);
    assert.equal(result.status, 'followed');
    assert.equal(database.creates(), 0);
    assert.equal(database.mutations(), 1);
    assert.equal(database.account?.email, 'canonical@example.test');
    assert.equal(database.account?.name, 'Saved name');
  });
}

test('a production draft request that outlives its account never initializes it again', async t => {
  const database = productionDatabase(t, 'missing');
  await assert.rejects(createListingDraft(identity, { category: 'other', autoCategory: false, title: 'Late draft' }),
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025');
  assert.equal(database.creates(), 0);
});
