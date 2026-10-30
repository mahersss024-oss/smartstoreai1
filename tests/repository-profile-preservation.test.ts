import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';

import { PATCH as updateProfile } from '@/app/api/account/profile/route';
import { createListingDraft, rateSeller, toggleSellerFollow } from '@/agent/marketplace/repository';
import { createSignedSession, type AuthSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

const identity: AuthSessionUser = {
  id: 'profile-preservation-buyer', email: 'profile-buyer@example.test',
  name: 'Original provider name', picture: 'https://example.test/provider-avatar.png',
};
type Account = {
  id: string; email: string; name: string | null; picture: string | null;
  phoneNumber: string | null; role: string;
};

function mockCustomerDatabase(t: TestContext, existing?: Account) {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  mockAllowedTextAnalysis(t);
  let account = existing && { ...existing };
  const mergeDefined = (data: Partial<Account>) => Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
  const upsert = async ({ create, update }: { create: Partial<Account>; update: Partial<Account> }) => {
    account = account
      ? { ...account, ...mergeDefined(update) }
      : { id: identity.id, email: identity.email, name: null, picture: null,
        phoneNumber: null, role: 'user', ...mergeDefined(create) };
    return account;
  };
  const original = {
    user: { findUnique: prisma.user.findUnique, findFirst: prisma.user.findFirst, upsert: prisma.user.upsert, update: prisma.user.update },
    follow: { findUnique: prisma.sellerFollow.findUnique, create: prisma.sellerFollow.create, count: prisma.sellerFollow.count },
    rating: { upsert: prisma.sellerRating.upsert, aggregate: prisma.sellerRating.aggregate },
    transaction: prisma.$transaction,
  };
  t.after(() => {
    Object.assign(prisma.user, original.user);
    Object.assign(prisma.sellerFollow, original.follow);
    Object.assign(prisma.sellerRating, original.rating);
    prisma.$transaction = original.transaction;
  });
  prisma.user.findUnique = (async () => account ?? null) as never;
  prisma.user.findFirst = (async () => ({ id: 'profile-preservation-seller' })) as never;
  prisma.user.upsert = upsert as never;
  prisma.user.update = (async ({ data }: { data: Partial<Account> }) => {
    assert.ok(account, 'Profile updates require an existing account.');
    account = { ...account, ...mergeDefined(data) };
    return account;
  }) as never;
  prisma.sellerFollow.findUnique = (async () => null) as never;
  prisma.sellerFollow.create = (async () => ({ id: 'profile-follow' })) as never;
  prisma.sellerFollow.count = (async () => 1) as never;
  prisma.sellerRating.upsert = (async () => ({
    rating: 5, comment: null, createdAt: new Date(0), updatedAt: new Date(0),
  })) as never;
  prisma.sellerRating.aggregate = (async () => ({
    _avg: { rating: 5 }, _count: { rating: 1 },
  })) as never;
  const transaction = {
    $executeRaw: async () => 1,
    user: prisma.user,
    listing: {
      count: async () => 0,
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        ...data, images: [], views: 0, messageCount: 0, favoriteCount: 0,
        createdAt: new Date(0), updatedAt: new Date(0),
      }),
    },
  } as unknown as Prisma.TransactionClient;
  prisma.$transaction = (async (work: (tx: Prisma.TransactionClient) => unknown) => work(transaction)) as never;
  return { account: () => account };
}

async function customerOperations() {
  assert.equal((await toggleSellerFollow('profile-preservation-seller', identity)).status, 'followed');
  assert.equal((await rateSeller('profile-preservation-seller', identity, { rating: 5 })).status, 'created');
  assert.equal((await createListingDraft(identity, {
    category: 'other', autoCategory: false, title: 'Profile preservation test draft',
  })).status, 'draft');
}

for (const clear of [false, true]) {
  test(`customer writes retain ${clear ? 'cleared' : 'edited'} profile fields despite a stale signed session`, async t => {
    const state = mockCustomerDatabase(t, {
      ...identity, name: identity.name!, picture: identity.picture!, phoneNumber: null, role: 'user',
    });
    // Exercise the real profile PATCH with the same old token later used by
    // follow/rating/draft writes. The database stub applies every update rather
    // than ignoring unexpected changes to profile fields.
    const response = await updateProfile(new Request('https://example.test/api/account/profile', {
      method: 'PATCH', headers: {
        Authorization: `Bearer ${createSignedSession(identity)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: clear ? '' : 'Customer edited name',
        picture: clear ? '' : 'https://example.test/customer-avatar.png',
        phoneNumber: '',
      }),
    }));
    assert.equal(response.status, 200);
    const saved = {
      name: clear ? null : 'Customer edited name',
      picture: clear ? null : 'https://example.test/customer-avatar.png',
    };
    assert.deepEqual({ name: state.account()!.name, picture: state.account()!.picture }, saved);
    await customerOperations();
    assert.deepEqual({ name: state.account()!.name, picture: state.account()!.picture }, saved);
  });
}

test('first customer operation still initializes a missing account from its verified identity', async t => {
  const state = mockCustomerDatabase(t);
  await customerOperations();
  assert.deepEqual(state.account(), {
    ...identity, name: identity.name, picture: identity.picture,
    phoneNumber: null, role: 'user',
  });
});
