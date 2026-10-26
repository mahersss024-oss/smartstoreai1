import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PATCH as updateProfile } from '@/app/api/account/profile/route';
import { createListingDraft, rateSeller, toggleSellerFollow } from '@/agent/marketplace/repository';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

test('database customer writes preserve edited and cleared profile fields from the account API', async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') {
    t.skip('Opt in with the dedicated local PostgreSQL test database.');
    return;
  }
  // This regression writes fixtures. Fail closed instead of accepting a hosted
  // connection or the local development database from the surrounding shell.
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
  });
  mockAllowedTextAnalysis(t);
  const suffix = randomUUID();
  const identity = {
    id: `profile-db-customer-${suffix}`, email: `profile-customer-${suffix}@example.test`,
    name: 'Original provider name', picture: 'https://example.test/provider-avatar.png',
  };
  const sellerId = `profile-db-seller-${suffix}`;
  try {
    await prisma.user.create({ data: { ...identity, role: 'moderator' } });
    await prisma.user.create({ data: { id: sellerId, email: `profile-seller-${suffix}@example.test` } });
    const assertProfile = async (expected: { name: string | null; picture: string | null }) => {
      const saved = await prisma.user.findUniqueOrThrow({ where: { id: identity.id } });
      assert.deepEqual({ name: saved.name, picture: saved.picture }, expected);
      assert.equal(saved.role, 'moderator');
      assert.equal(saved.email, identity.email);
    };
    for (const clear of [false, true]) {
      const expected = {
        name: clear ? null : 'Customer edited name',
        picture: clear ? null : 'https://example.test/customer-avatar.png',
      };
      const response = await updateProfile(new Request('https://example.test/api/account/profile', {
        method: 'PATCH', headers: {
          Authorization: `Bearer ${createSignedSession(identity)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: expected.name ?? '', picture: expected.picture ?? '', phoneNumber: '' }),
      }));
      assert.equal(response.status, 200);
      await assertProfile(expected);
      await toggleSellerFollow(sellerId, identity);
      await assertProfile(expected);
      await rateSeller(sellerId, identity, { rating: 5 });
      await assertProfile(expected);
      const draft = await createListingDraft(identity, {
        category: 'other', autoCategory: false, title: `Profile regression draft ${suffix}`,
      });
      assert.equal(draft.sellerId, identity.id);
      await assertProfile(expected);
    }
  } finally {
    // Both IDs are unique fixture-owned accounts; cascades remove only their
    // draft/follow/rating rows, and no user-generated production data is read.
    await prisma.user.deleteMany({ where: { id: { in: [identity.id, sellerId] } } });
  }
});
