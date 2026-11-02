import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Prisma } from '@prisma/client';

import { shareSellerContact } from '@/agent/marketplace/repository';
import { persistUserRegistration } from '@/lib/auth/registration';
import { mergeAppleAuthorization } from '@/lib/auth/apple-authorization';
import { createCommissionAgreementCookie } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

test('PostgreSQL registration and contact sharing use advisory-before-row order and preserve profile, grants and bans', { timeout: 30_000 }, async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return t.skip('Requires the explicitly named disposable loopback PostgreSQL database.');
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  const previousSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'local-registration-contact-only-secret-over32chars';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  });
  const suffix = randomUUID();
  const identity = { id: `apple:registration-contact-${suffix}`, email: `registration-contact-${suffix}@example.test`, name: 'Provider display name' };
  const grant = { clientId: 'com.souqhamad.fixture', subject: `registration-contact-${suffix}`, token: `local-refresh-${suffix}`, tokenType: 'refresh_token' as const };
  const initialGrant = mergeAppleAuthorization(identity.id, null, { ...grant, clientId: 'previous-client', token: 'previous-local-refresh' });
  await prisma.user.create({ data: { ...identity, name: 'Customer chosen name', picture: 'https://example.test/chosen-picture.jpg',
    phoneNumber: '0500000000', appleAuthorizationTokens: initialGrant } });
  const seller = await prisma.user.create({ data: { id: `seller-registration-contact-${suffix}`, email: `seller-registration-contact-${suffix}@example.test` } });
  const listing = await prisma.listing.create({ data: { sellerId: seller.id, category: 'other', title: 'Local lock fixture', status: 'published' } });
  const conversation = await prisma.conversation.create({ data: { listingId: listing.id, sellerId: seller.id, buyerId: identity.id } });
  const transact = prisma.$transaction.bind(prisma);
  const operation = new AsyncLocalStorage<'contact' | 'registration'>();
  let contactLocked!: () => void;
  let releaseContact!: () => void;
  const locked = new Promise<void>(resolve => { contactLocked = resolve; });
  const resume = new Promise<void>(resolve => { releaseContact = resolve; });
  let paused = false;
  let registrationPid = 0;
  let registrationAttempts = 0;
  mockDatabaseMethod(t, prisma, '$transaction', async (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) => {
    const kind = operation.getStore();
    if (kind === 'registration') registrationAttempts++;
    return transact(async tx => {
      if (kind === 'registration') {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
        registrationPid = pid;
      }
      const proxy = new Proxy(tx, { get(target, key, receiver) {
        if (key !== '$executeRaw') return Reflect.get(target, key, receiver);
        return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await tx.$executeRaw(strings, ...values);
          if (kind === 'contact' && !paused && strings.join('?').includes('771204') && values.includes(`user:${identity.id}`)) {
            paused = true;
            contactLocked();
            await resume;
          }
          return result;
        };
      } });
      return work(proxy);
    }, { ...options, timeout: 15_000 });
  });
  const request = () => new Request('https://example.test/api/auth/apple/native', {
    headers: { Cookie: createCommissionAgreementCookie().split(';')[0] },
  });
  let contact: ReturnType<typeof shareSellerContact> | undefined;
  let registration: ReturnType<typeof persistUserRegistration> | undefined;
  try {
    contact = operation.run('contact', () => shareSellerContact(conversation.id, identity.id));
    await locked;
    registration = operation.run('registration', () => persistUserRegistration(request(), identity, grant));
    let waitingForAdvisory = false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (registrationPid) {
        const rows = await prisma.$queryRaw<Array<{ wait: string | null }>>`SELECT wait_event AS wait FROM pg_stat_activity WHERE pid = ${registrationPid}`;
        if (rows[0]?.wait === 'advisory') { waitingForAdvisory = true; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(waitingForAdvisory, 'Registration must reach the contact writer\'s account lock');
    releaseContact();
    const [shared, registered] = await Promise.all([contact, registration]);
    assert.equal(shared.status, 'shared');
    assert.equal(registered.id, identity.id);
    assert.equal(registered.name, 'Customer chosen name');
    assert.equal(registrationAttempts, 1, 'Deadlock retries must not hide a reversed lock order');
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: identity.id } });
    assert.equal(saved.name, 'Customer chosen name');
    assert.equal(saved.picture, 'https://example.test/chosen-picture.jpg');
    const grants = saved.appleAuthorizationTokens as Array<{ clientId: string; ciphertext: string }>;
    assert.equal(grants.length, 2);
    assert.deepEqual(grants.find(value => value.clientId === 'previous-client'), (initialGrant as unknown[])[0]);
    assert.ok(grants.some(value => value.clientId === grant.clientId));
    assert.ok(!JSON.stringify(grants).includes(grant.token));
    assert.equal(await prisma.conversationMessage.count({ where: { conversationId: conversation.id, type: 'contact_share' } }), 1);
    await prisma.adminAuditLog.create({ data: { action: 'delete_user', targetType: 'user', targetId: identity.id,
      metadata: { operation: 'admin_user_delete', mode: 'soft', email: identity.email } } });
    await prisma.user.update({ where: { id: identity.id }, data: { deletedAt: new Date() } });
    await assert.rejects(persistUserRegistration(request(), identity, { ...grant, token: 'must-not-replace-grant' }), /ACCOUNT_SOFT_DELETED/);
    const blocked = await prisma.user.findUniqueOrThrow({ where: { id: identity.id } });
    assert.ok(blocked.deletedAt);
    assert.equal(blocked.name, saved.name);
    assert.deepEqual(blocked.appleAuthorizationTokens, saved.appleAuthorizationTokens);
  } finally {
    releaseContact();
    await Promise.allSettled([contact, registration].filter(Boolean));
    await prisma.user.deleteMany({ where: { id: { in: [identity.id, seller.id] } } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: identity.id } });
  }
});

test.after(async () => { await prisma.$disconnect(); });
