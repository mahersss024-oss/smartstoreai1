import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { appleGrantFromTokenResponse, mergeAppleAuthorization, revokeAppleAuthorizations } from '@/lib/auth/apple-authorization';

const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const grant = { clientId: 'com.souqhamad.fixture', subject: 'apple-subject', token: 'private-refresh-fixture', tokenType: 'refresh_token' as const };
function setup(t: TestContext) {
  const values = { AUTH_SECRET: 'isolated-test-apple-encryption-secret-over32chars', APPLE_TEAM_ID: 'fixture-team', APPLE_KEY_ID: 'fixture-key',
    APPLE_PRIVATE_KEY: signingKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

test('Apple authorization prefers refresh tokens, accepts access-token fallback, and rejects missing/oversized tokens', () => {
  assert.deepEqual(appleGrantFromTokenResponse({ refresh_token: 'refresh', access_token: 'access' }, grant.clientId, grant.subject), { ...grant, token: 'refresh' });
  assert.deepEqual(appleGrantFromTokenResponse({ access_token: 'access' }, grant.clientId, grant.subject), { ...grant, token: 'access', tokenType: 'access_token' });
  for (const value of [{}, { refresh_token: 123 }, { refresh_token: ' ' }, { access_token: 'x'.repeat(8193) }]) {
    assert.equal(appleGrantFromTokenResponse(value, grant.clientId, grant.subject), undefined);
  }
});

test('Apple grants are encrypted at rest, deduplicated per client/subject, and revoked only against Apple', async t => {
  setup(t);
  const first = mergeAppleAuthorization('owner', null, grant);
  assert.ok(!JSON.stringify(first).includes(grant.token));
  assert.notDeepEqual(first, mergeAppleAuthorization('owner', null, grant), 'Encryption uses an independent nonce.');
  const newer = { ...grant, token: 'fresh-private-token' };
  const merged = mergeAppleAuthorization('owner', mergeAppleAuthorization('owner', first, { ...grant, clientId: 'web-client' }), newer);
  assert.equal((merged as unknown[]).length, 2);
  const revoked: Array<{ client: string | null; token: string | null }> = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://appleid.apple.com/auth/revoke');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method, 'POST');
    assert.ok(init?.signal);
    const form = init?.body as URLSearchParams;
    revoked.push({ client: form.get('client_id'), token: form.get('token') });
    const claims = JSON.parse(Buffer.from(form.get('client_secret')!.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.sub, form.get('client_id'));
    assert.equal(claims.aud, 'https://appleid.apple.com');
    return new Response(null, { status: 200 });
  });
  await revokeAppleAuthorizations('owner', merged);
  assert.deepEqual(revoked, [{ client: 'web-client', token: grant.token }, { client: grant.clientId, token: newer.token }]);
});

test('an encrypted Apple authorization cannot be moved to another account or client or altered', async t => {
  setup(t);
  const stored = mergeAppleAuthorization('owner', null, grant);
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Unexpected network access.'); });
  await assert.rejects(revokeAppleAuthorizations('different-owner', stored));
  const changed = structuredClone(stored) as Array<Record<string, unknown>>;
  changed[0].clientId = 'different-client';
  await assert.rejects(revokeAppleAuthorizations('owner', changed));
  changed[0].nonce = 'invalid';
  await assert.rejects(revokeAppleAuthorizations('owner', changed), /apple_token_storage_invalid/);
  process.env.AUTH_SECRET = 'different-encryption-key';
  await assert.rejects(revokeAppleAuthorizations('owner', stored));
  assert.equal(requests, 0);
});

test('Apple authorization fails closed when provider revocation fails and never follows a redirect', async t => {
  setup(t);
  const stored = mergeAppleAuthorization('owner', null, grant);
  t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error');
    return new Response(null, { status: 400 });
  });
  await assert.rejects(revokeAppleAuthorizations('owner', stored), /apple_revocation_unavailable/);
});
