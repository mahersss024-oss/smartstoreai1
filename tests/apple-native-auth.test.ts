import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { POST as challengeRoute } from '@/app/api/auth/apple/native/challenge/route';
import { POST as nativeRoute } from '@/app/api/auth/apple/native/route';
import { appleNativeDigest, parseAppleNativeChallenge, consumeAppleNativeChallenge } from '@/lib/auth/apple-native';
import { createCommissionAgreementToken, parseSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const clientId = 'com.souqhamad.native.test';
const verifier = 'a'.repeat(64);

function setup(t: TestContext) {
  const values = { SMARTSTORE_MARKETPLACE_STORE: 'file', APPLE_NATIVE_CLIENT_ID: clientId, APPLE_CLIENT_ID: '', APPLE_TEAM_ID: 'test-team', APPLE_KEY_ID: 'test-key', APPLE_PRIVATE_KEY: ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
}

function jwt(nonce: string, overrides: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ kid: 'test-rsa', alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: clientId, sub: 'native-apple-user', email: 'native-apple@example.test', email_verified: true, exp: Math.floor(Date.now() / 1000) + 300, nonce, ...overrides })).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), rsa.privateKey).toString('base64url')}`;
}

function req(path: string, body: unknown, agreement?: string) {
  return new Request(`https://souqhamad.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(agreement ? { 'x-souq-hamad-commission-agreement': agreement } : {}) }, body: JSON.stringify(body) });
}

async function start(agreement: string) {
  const response = await challengeRoute(req('/api/auth/apple/native/challenge', { codeChallenge: appleNativeDigest(verifier) }, agreement));
  assert.equal(response.status, 200);
  return response.json();
}

function mockApple(t: TestContext, getToken: () => string) {
  let exchanges = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [{ ...rsa.publicKey.export({ format: 'jwk' }), kid: 'test-rsa', alg: 'RS256' }] });
    assert.equal(url, 'https://appleid.apple.com/auth/token');
    const form = init?.body as URLSearchParams;
    assert.equal(form.get('client_id'), clientId);
    const claims = JSON.parse(Buffer.from(form.get('client_secret')!.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.sub, clientId);
    exchanges++;
    return form.get('code') === 'valid-once-code' ? Response.json({ id_token: getToken() }) : Response.json({ error: 'invalid_grant' }, { status: 400 });
  });
  return () => exchanges;
}

test('Apple native requires agreement and truthful explicit native configuration', async t => {
  setup(t);
  assert.equal((await challengeRoute(req('/api/auth/apple/native/challenge', { codeChallenge: appleNativeDigest(verifier) }))).status, 409);
  process.env.APPLE_NATIVE_CLIENT_ID = '';
  const response = await challengeRoute(req('/api/auth/apple/native/challenge', { codeChallenge: appleNativeDigest(verifier) }, createCommissionAgreementToken()));
  assert.equal(response.status, 503);
});

test('Apple challenge is bound to verifier, agreement, signature, expiry and single use', async t => {
  setup(t);
  const agreement = createCommissionAgreementToken();
  const challenge = await start(agreement);
  assert.equal(parseAppleNativeChallenge(challenge.challengeToken, 'b'.repeat(64), agreement), null);
  assert.equal(parseAppleNativeChallenge(challenge.challengeToken, verifier, `${agreement}tampered`), null);
  assert.equal(parseAppleNativeChallenge(`${challenge.challengeToken}tampered`, verifier, agreement), null);
  const parsed = parseAppleNativeChallenge(challenge.challengeToken, verifier, agreement)!;
  assert.equal(parsed.nonce, challenge.nonce);
  assert.equal(await consumeAppleNativeChallenge(parsed), true);
  assert.equal(await consumeAppleNativeChallenge(parsed), false);
  t.mock.method(Date, 'now', () => (challenge.expiresAt + 1) * 1000);
  assert.equal(parseAppleNativeChallenge(challenge.challengeToken, verifier, agreement), null);
});

test('Apple native rejects wrong nonce and audience before exchanging the code', async t => {
  setup(t);
  const agreement = createCommissionAgreementToken();
  const challenge = await start(agreement);
  const exchanges = mockApple(t, () => jwt(challenge.nonce));
  for (const identityToken of [jwt('unbound-nonce'), jwt(challenge.nonce, { aud: 'other.app' }), `${jwt(challenge.nonce)}tampered`]) {
    const response = await nativeRoute(req('/api/auth/apple/native', { ...challenge, codeVerifier: verifier, identityToken, authorizationCode: 'valid-once-code' }, agreement));
    assert.equal(response.status, 401);
  }
  assert.equal(exchanges(), 0);
});

test('Apple challenge claims use a shared unique database record and fail closed on database failure', async t => {
  setup(t);
  const agreement = createCommissionAgreementToken();
  const issued = await start(agreement);
  const challenge = parseAppleNativeChallenge(issued.challengeToken, verifier, agreement)!;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  const original = prisma.apiIdempotencyKey.create;
  t.after(() => { prisma.apiIdempotencyKey.create = original; });
  let claimed = false;
  let failed = false;
  prisma.apiIdempotencyKey.create = (async ({ data }: { data: { namespace: string; key: string; actorKey: string } }) => {
    assert.equal(data.namespace, 'apple_native_challenge');
    assert.equal(data.key, challenge.id);
    assert.equal(data.actorKey, clientId);
    if (failed) throw new Error('isolated database failure');
    if (claimed) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
    claimed = true;
    return {};
  }) as unknown as typeof prisma.apiIdempotencyKey.create;
  assert.equal(await consumeAppleNativeChallenge(challenge), true);
  assert.equal(await consumeAppleNativeChallenge(challenge), false);
  failed = true;
  await assert.rejects(() => consumeAppleNativeChallenge(challenge), /isolated database failure/);
});

test('Apple native verifies authorization code and exchange identity before issuing bearer session', async t => {
  setup(t);
  const agreement = createCommissionAgreementToken();
  let exchangeToken = '';
  const exchanges = mockApple(t, () => exchangeToken);
  for (const failure of ['bad-code', 'different-sub', 'different-nonce']) {
    const challenge = await start(agreement);
    exchangeToken = jwt(failure === 'different-nonce' ? 'other-flow' : challenge.nonce, failure === 'different-sub' ? { sub: 'other-user' } : {});
    const response = await nativeRoute(req('/api/auth/apple/native', { ...challenge, codeVerifier: verifier, identityToken: jwt(challenge.nonce), authorizationCode: failure === 'bad-code' ? 'invalid-code' : 'valid-once-code' }, agreement));
    assert.equal(response.status, 401);
  }
  const challenge = await start(agreement);
  exchangeToken = jwt(challenge.nonce);
  const body = { ...challenge, codeVerifier: verifier, identityToken: exchangeToken, authorizationCode: 'valid-once-code', fullName: 'عميل التطبيق' };
  const response = await nativeRoute(req('/api/auth/apple/native', body, agreement));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control')!, /no-store/);
  const payload = await response.json();
  assert.equal(payload.authenticated, true);
  assert.equal(payload.user.id, 'apple:native-apple-user');
  assert.equal(parseSignedSession(payload.sessionToken)?.user.id, payload.user.id);
  assert.equal(payload.expiresAt, parseSignedSession(payload.sessionToken)?.expiresAt);
  assert.equal((await nativeRoute(req('/api/auth/apple/native', body, agreement))).status, 409);
  assert.equal(exchanges(), 4);
  assert.ok(!JSON.stringify(payload).includes('client_secret'));
});
