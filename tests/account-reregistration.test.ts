import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';

import { persistGoogleUserRegistration } from '@/lib/auth/google';
import { getRegistrationIdentityEmail, persistUserRegistration, selfAccountDeletionOperation } from '@/lib/auth/registration';
import { commissionAgreementVersion, createCommissionAgreementCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type Account = {
  id: string; email: string; name: string | null; picture: string | null;
  role: string; deletedAt: Date | null;
  commissionAgreementVersion?: string; commissionAgreementAccepted?: Date;
};
type Audit = {
  id: string; action: 'delete_user' | 'update_user'; targetId: string;
  metadata: Record<string, unknown>; createdAt: Date;
};

const identity = { id: 'google:customer', email: 'customer@example.test', name: 'Customer' };
const deletedAt = new Date('2026-10-18T12:00:00Z');
const request = () => new Request('http://localhost/api/auth/google/callback', {
  headers: { Cookie: createCommissionAgreementCookie().split(';')[0] },
});
const account = (overrides: Partial<Account> = {}): Account => ({
  ...identity, picture: null, role: 'user', deletedAt: null, ...overrides,
});
const selfDeletion = (overrides: Partial<Audit> = {}): Audit => ({
  id: 'self-delete', action: 'delete_user', targetId: identity.id, createdAt: deletedAt,
  metadata: { operation: selfAccountDeletionOperation, email: identity.email, deletedAt: deletedAt.toISOString() },
  ...overrides,
});
const adminDeletion = (overrides: Partial<Audit> = {}): Audit => ({
  ...selfDeletion(), id: 'admin-delete',
  metadata: { operation: 'admin_user_delete', email: identity.email, mode: 'soft' },
  ...overrides,
});

function mockRegistration(t: TestContext, initial: Account[] = [], history: Audit[] = []) {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const previousOwners = process.env.SMARTSTORE_ADMIN_EMAILS;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_ADMIN_EMAILS = '';
  t.after(() => {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    if (previousOwners === undefined) delete process.env.SMARTSTORE_ADMIN_EMAILS;
    else process.env.SMARTSTORE_ADMIN_EMAILS = previousOwners;
  });
  const users = new Map(initial.map(user => [user.id, { ...user }]));
  const writes: Array<{ kind: string; id: string }> = [];
  const database = {
    user: {
      findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
        [...users.values()].find(user => where.id ? user.id === where.id : user.email === where.email) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Account> }) => {
        const existing = users.get(where.id)!;
        const defined = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
        const updated = { ...existing, ...defined };
        users.set(updated.id, updated);
        writes.push({ kind: 'update', id: updated.id });
        return updated;
      },
      create: async ({ data }: { data: Partial<Account> & { id: string; email: string } }) => {
        const created = account(data);
        users.set(created.id, created);
        writes.push({ kind: 'create', id: created.id });
        return created;
      },
    },
    adminAuditLog: {
      findMany: async ({ where }: {
        where: { OR: [{ targetId: { in: string[] } }, { metadata: { equals: string } }] };
      }) => history.filter(event => where.OR[0].targetId.in.includes(event.targetId) ||
        event.metadata.email === where.OR[1].metadata.equals)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      findFirst: async ({ where }: {
        where: { action: string; targetId: string; createdAt?: { gt: Date }; metadata: { path: string[]; equals: string } };
      }) => history.find(event => {
        const value = where.metadata.path.reduce<unknown>((current, key) =>
          current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, event.metadata);
        return event.action === where.action && event.targetId === where.targetId &&
          (!where.createdAt || event.createdAt > where.createdAt.gt) && value === where.metadata.equals;
      }) ?? null,
    },
  };
  const transaction = database as unknown as Prisma.TransactionClient;
  t.mock.method(prisma, '$transaction', (async (work: (db: Prisma.TransactionClient) => unknown) => work(transaction)) as never);
  return { users, writes, database: transaction };
}

test('first registration preserves the verified identity and agreement', async t => {
  const state = mockRegistration(t);
  const result = await persistGoogleUserRegistration(request(), identity);
  assert.equal(result.id, identity.id);
  assert.equal(result.role, 'user');
  assert.equal(state.users.get(result.id)!.commissionAgreementVersion, commissionAgreementVersion);
  assert.ok(state.users.get(result.id)!.commissionAgreementAccepted instanceof Date);
  assert.equal(state.writes.length, 1);
});

test('existing cross-provider registration keeps its account, name and role', async t => {
  const existing = account({ id: 'apple:linked', name: 'Saved name', role: 'moderator' });
  const state = mockRegistration(t, [existing]);
  const result = await persistGoogleUserRegistration(request(), identity);
  assert.equal(result.id, existing.id);
  assert.equal(result.name, 'Saved name');
  assert.equal(result.role, 'moderator');
  assert.equal(state.users.size, 1);
});

test('retained self-deletion creates a new account without restoring the old identity or role', async t => {
  const state = mockRegistration(t, [account({ deletedAt, role: 'admin' })], [selfDeletion()]);
  const result = await persistGoogleUserRegistration(request(), identity);
  assert.notEqual(result.id, identity.id);
  assert.ok(result.id.startsWith(`${identity.id}:r:`));
  assert.equal(result.role, 'user');
  assert.equal(state.users.get(identity.id)!.deletedAt, deletedAt);
  assert.match(state.users.get(identity.id)!.email, /@accounts\.invalid$/);
  assert.equal(state.users.get(result.id)!.email, identity.email);
  assert.equal(state.users.size, 2);
  const repeated = await persistUserRegistration(request(), { ...identity, id: 'apple:customer' });
  assert.equal(repeated.id, result.id);
  assert.equal(state.users.size, 2);
});

test('permanent self-deletion does not reuse the identity referenced by old cookies', async t => {
  const state = mockRegistration(t, [], [selfDeletion()]);
  const result = await persistUserRegistration(request(), identity);
  assert.notEqual(result.id, identity.id);
  assert.equal(state.users.has(identity.id), false);
});

for (const scenario of ['soft', 'permanent', 'provider-change', 'email-change', 'later-self-deletion']) {
  test(`administrator deletion stays enforced: ${scenario}`, async t => {
    const existing = scenario === 'soft' || scenario === 'email-change' ? [account({ deletedAt })] : [];
    const history = [adminDeletion()];
    if (scenario === 'later-self-deletion') history.push(selfDeletion({ createdAt: new Date(deletedAt.getTime() + 1000) }));
    const state = mockRegistration(t, existing, history);
    const attempt = {
      ...identity,
      ...(scenario === 'provider-change' ? { id: 'apple:other' } : {}),
      ...(scenario === 'email-change' ? { email: 'changed@example.test' } : {}),
    };
    await assert.rejects(persistUserRegistration(request(), attempt), /ACCOUNT_SOFT_DELETED/);
    assert.deepEqual(state.writes, []);
  });
}

test('only an explicit later administrator reactivation cancels an administrator deletion', async t => {
  const restored: Audit = {
    id: 'restore', action: 'update_user', targetId: identity.id,
    createdAt: new Date(deletedAt.getTime() + 1000),
    metadata: { operation: 'admin_user_update', updates: { accountStatus: 'active' } },
  };
  mockRegistration(t, [account()], [adminDeletion(), restored]);
  assert.equal((await persistUserRegistration(request(), identity)).id, identity.id);
});

test('role changes do not cancel an administrator deletion', async t => {
  const state = mockRegistration(t, [], [adminDeletion(), {
    id: 'role', action: 'update_user', targetId: identity.id,
    createdAt: new Date(deletedAt.getTime() + 1000), metadata: { updates: { role: 'admin' } },
  }]);
  await assert.rejects(persistUserRegistration(request(), identity), /ACCOUNT_SOFT_DELETED/);
  assert.deepEqual(state.writes, []);
});

test('deleted legacy accounts with an unknown deletion source are not automatically reopened', async t => {
  const state = mockRegistration(t, [account({ deletedAt })]);
  await assert.rejects(persistUserRegistration(request(), identity), /ACCOUNT_SOFT_DELETED/);
  assert.deepEqual(state.writes, []);
});

test('an older self-deletion marker cannot authorize a different deletion', async t => {
  const state = mockRegistration(t, [account({ deletedAt: new Date(deletedAt.getTime() + 1000) })], [selfDeletion()]);
  await assert.rejects(persistUserRegistration(request(), identity), /ACCOUNT_SOFT_DELETED/);
  assert.deepEqual(state.writes, []);
});

test('registration fails closed when deletion history cannot be read', async t => {
  const state = mockRegistration(t);
  t.mock.method(state.database.adminAuditLog, 'findMany', (async () => { throw new Error('history unavailable'); }) as never);
  await assert.rejects(persistUserRegistration(request(), identity), /history unavailable/);
  assert.deepEqual(state.writes, []);
});

test('registration retries serialization and uniqueness races with a fixed limit', async t => {
  const state = mockRegistration(t);
  let attempts = 0;
  t.mock.method(prisma, '$transaction', (async (work: (db: Prisma.TransactionClient) => unknown) => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error('retry'), { code: attempts === 1 ? 'P2034' : 'P2002' });
    return work(state.database);
  }) as never);
  assert.equal((await persistUserRegistration(request(), identity)).id, identity.id);
  assert.equal(attempts, 3);
  assert.equal(state.writes.length, 1);
});

test('administrator decisions on a retained record use the original identity email', async t => {
  const state = mockRegistration(t, [account({ deletedAt })], [selfDeletion()]);
  await persistUserRegistration(request(), identity);
  const retired = state.users.get(identity.id)!;
  assert.equal(await getRegistrationIdentityEmail(state.database, retired), identity.email);
});

test('registration stops after three unsuccessful transaction attempts', async t => {
  const state = mockRegistration(t);
  let attempts = 0;
  t.mock.method(prisma, '$transaction', (async () => {
    attempts++;
    throw Object.assign(new Error('retry exhausted'), { code: 'P2034' });
  }) as never);
  await assert.rejects(persistUserRegistration(request(), identity), /retry exhausted/);
  assert.equal(attempts, 3);
  assert.deepEqual(state.writes, []);
});

test('Google browser/native and Apple callbacks share the same registration policy', () => {
  assert.match(readFileSync('lib/auth/google.ts', 'utf8'), /return persistUserRegistration\(request, user\)/);
  assert.match(readFileSync('app/api/auth/apple/callback/route.ts', 'utf8'), /registeredUser = await persistUserRegistration\(request, user\)/);
  assert.match(readFileSync('app/api/auth/google/native/route.ts', 'utf8'), /persistGoogleUserRegistration\(request, user\)/);
});
