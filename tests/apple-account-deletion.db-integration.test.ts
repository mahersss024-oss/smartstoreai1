import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import test from 'node:test';
import { DELETE } from '@/app/api/account/profile/route';
import { GET as getSession } from '@/app/api/auth/session/route';
import { mergeAppleAuthorization } from '@/lib/auth/apple-authorization';
import { createSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

test('PostgreSQL Apple grants remain encrypted, are withheld from session responses, and must be revoked before deletion', { timeout: 20000 }, async t => {
  if (process.env.SMARTSTORE_DB_INTEGRATION !== '1') return t.skip('Requires the explicitly named disposable local PostgreSQL database.');
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.equal(database.pathname, '/smartstore_codex_test');
  assert.equal(process.env.SMARTSTORE_MARKETPLACE_STORE, 'database');
  const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const values = { AUTH_SECRET: 'isolated-local-apple-grant-secret-over32chars', APPLE_TEAM_ID: 'test-team', APPLE_KEY_ID: 'test-key',
    APPLE_PRIVATE_KEY: signingKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), SMARTSTORE_RATE_LIMIT_BACKEND: 'memory' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  const suffix = randomUUID();
  const identity = { id: `apple:revocation-${suffix}`, email: `apple-revocation-${suffix}@example.test`, name: 'Disposable Apple fixture' };
  const grant = { clientId: 'com.souqhamad.fixture', subject: `revocation-${suffix}`, token: `private-refresh-${suffix}`, tokenType: 'refresh_token' as const };
  const encrypted = mergeAppleAuthorization(identity.id, null, grant);
  await prisma.user.create({ data: { ...identity, appleAuthorizationTokens: encrypted } });
  const request = (path: string, method: string) => new Request(`https://example.test${path}`, {
    method, headers: { Authorization: `Bearer ${createSignedSession(identity)}` },
  });
  let providerStatus = 503;
  let revocations = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://appleid.apple.com/auth/revoke');
    assert.equal((init?.body as URLSearchParams).get('token'), grant.token);
    revocations++;
    return new Response(null, { status: providerStatus });
  });
  try {
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: identity.id } });
    assert.deepEqual(stored.appleAuthorizationTokens, encrypted);
    assert.ok(!JSON.stringify(stored.appleAuthorizationTokens).includes(grant.token));
    const sessionResponse = await getSession(request('/api/auth/session', 'GET'));
    const session = await sessionResponse.json();
    assert.equal(session.authenticated, true);
    assert.equal(session.user.id, identity.id);
    assert.ok(!JSON.stringify(session).includes('appleAuthorizationTokens'));
    assert.ok(!JSON.stringify(session).includes(grant.token));
    assert.equal((await DELETE(request('/api/account/profile', 'DELETE'))).status, 503);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: identity.id } })).deletedAt, null);
    assert.equal(await prisma.adminAuditLog.count({ where: { targetId: identity.id, action: 'delete_user' } }), 0);
    providerStatus = 200;
    assert.equal((await DELETE(request('/api/account/profile', 'DELETE'))).status, 200);
    assert.equal(await prisma.user.findUnique({ where: { id: identity.id } }), null);
    assert.equal(revocations, 2);
    assert.equal(await prisma.adminAuditLog.count({ where: { targetId: identity.id, action: 'delete_user' } }), 1);
  } finally {
    await prisma.user.deleteMany({ where: { id: identity.id } });
    await prisma.adminAuditLog.deleteMany({ where: { targetId: identity.id } });
  }
});
