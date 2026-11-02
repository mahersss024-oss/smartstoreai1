import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import type { Prisma } from '@prisma/client';

import { persistGoogleUserRegistration } from '@/lib/auth/google';
import { clearResettableAdminAuditHistory, getRegistrationIdentityEmail, persistUserRegistration, selfAccountDeletionOperation } from '@/lib/auth/registration';
import { commissionAgreementVersion, createCommissionAgreementCookie, createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { proxy } from '@/proxy';
import { NextRequest } from 'next/server';
import { mockDatabaseMethod } from './helpers/mock-database-method';
import { revokeAppleAuthorizations } from '@/lib/auth/apple-authorization';
import { generateKeyPairSync } from 'node:crypto';

type Account = {
  id: string; email: string; name: string | null; picture: string | null;
  role: string; deletedAt: Date | null;
  commissionAgreementVersion?: string; commissionAgreementAccepted?: Date;
  appleAuthorizationTokens?: Prisma.JsonValue;
};
type Audit = {
  id: string; action: 'delete_user' | 'update_user'; targetId: string;
  metadata: Record<string, unknown>; createdAt: Date; targetType?: string;
};

function matchesAuditWhere(event: Audit, where: Record<string, unknown>): boolean {
  if (where.NOT && matchesAuditWhere(event, where.NOT as Record<string, unknown>)) return false;
  if (where.OR && !(where.OR as Array<Record<string, unknown>>).some(clause => matchesAuditWhere(event, clause))) return false;
  if (where.targetType && (event.targetType ?? 'user') !== where.targetType) return false;
  if (where.action && event.action !== where.action) return false;
  if (where.metadata) {
    const filter = where.metadata as { path: string[]; equals: unknown };
    const value = filter.path.reduce<unknown>((current, key) =>
      current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, event.metadata);
    if (value !== filter.equals) return false;
  }
  return true;
}

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
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const retained = history.filter(event => !matchesAuditWhere(event, where));
        const count = history.length - retained.length;
        history.splice(0, history.length, ...retained);
        return { count };
      },
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
  return { users, writes, history, database: transaction };
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

test('Apple registration stores an encrypted revocation grant on the linked account and excludes it from the session', async t => {
  const state = mockRegistration(t, [account()]);
  const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const values = { AUTH_SECRET: 'isolated-apple-registration-key-over32chars', APPLE_TEAM_ID: 'test-team', APPLE_KEY_ID: 'test-key',
    APPLE_PRIVATE_KEY: signingKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const grant = { clientId: 'com.souqhamad.fixture', subject: 'apple-registration', token: 'private-refresh-token', tokenType: 'refresh_token' as const };
  const registered = await persistUserRegistration(request(), { ...identity, id: `apple:${grant.subject}` }, grant);
  assert.equal(registered.id, identity.id, 'Verified matching email retains the existing linked identity.');
  const stored = state.users.get(identity.id)!.appleAuthorizationTokens;
  assert.ok(Array.isArray(stored));
  assert.ok(!JSON.stringify(stored).includes(grant.token));
  assert.ok(!JSON.stringify(registered).includes('appleAuthorizationTokens'));
  assert.ok(!JSON.stringify(registered).includes(grant.token));
  let revoked = false;
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal((init?.body as URLSearchParams).get('token'), grant.token);
    revoked = true;
    return new Response(null, { status: 200 });
  });
  await revokeAppleAuthorizations(registered.id, stored);
  assert.ok(revoked);
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

test('clearing market audit history preserves permanent administrator bans and removes unrelated audit rows', async t => {
  const state = mockRegistration(t, [], [adminDeletion(), {
    id: 'unrelated-role-change', action: 'update_user', targetId: identity.id,
    createdAt: new Date(), metadata: { updates: { role: 'moderator' } },
  }]);
  assert.equal((await clearResettableAdminAuditHistory(state.database)).count, 1);
  assert.deepEqual(state.history.map(event => event.id), ['admin-delete']);
  await assert.rejects(persistUserRegistration(request(), identity), /ACCOUNT_SOFT_DELETED/);
  assert.deepEqual(state.writes, []);
});

test('clearing market audit history preserves self-deletion identity receipts for retained accounts', async t => {
  const state = mockRegistration(t, [account({ deletedAt })], [selfDeletion()]);
  await clearResettableAdminAuditHistory(state.database);
  const result = await persistUserRegistration(request(), identity);
  assert.notEqual(result.id, identity.id);
  assert.equal(await getRegistrationIdentityEmail(state.database, state.users.get(identity.id)!), identity.email);
});

test('a previously deleted bearer stays rejected after audit cleanup and fresh registration', async t => {
  const oldToken = createSignedSession(identity);
  const state = mockRegistration(t, [], [selfDeletion()]);
  await clearResettableAdminAuditHistory(state.database);
  const result = await persistUserRegistration(request(), identity);
  assert.notEqual(result.id, identity.id);
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://mock-only@127.0.0.1/never-connected';
  t.after(() => { if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl; });
  mockDatabaseMethod(t, prisma.user, 'findUnique', (async ({ where }: { where: { id: string } }) => state.users.get(where.id) ?? null) as never);
  const response = await proxy(new NextRequest('http://localhost/api/account/profile', {
    headers: { Authorization: `Bearer ${oldToken}` },
  }));
  assert.equal(response.status, 401);
});

test('explicit account restoration remains authoritative after market audit cleanup', async t => {
  const restored: Audit = {
    id: 'restore', action: 'update_user', targetId: identity.id,
    createdAt: new Date(deletedAt.getTime() + 1000),
    metadata: { operation: 'admin_user_update', updates: { accountStatus: 'active' } },
  };
  const state = mockRegistration(t, [account()], [adminDeletion(), restored]);
  assert.equal((await clearResettableAdminAuditHistory(state.database)).count, 0);
  assert.equal((await persistUserRegistration(request(), identity)).id, identity.id);
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
  assert.match(readFileSync('app/api/auth/apple/callback/route.ts', 'utf8'), /registeredUser = await persistUserRegistration\(request, user, authorization\)/);
  assert.match(readFileSync('app/api/auth/google/native/route.ts', 'utf8'), /persistGoogleUserRegistration\(request, user\)/);
});
