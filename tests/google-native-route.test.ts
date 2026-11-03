import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { GET as nativeConfig } from '@/app/api/auth/google/native-config/route';
import { POST as nativeSignIn } from '@/app/api/auth/google/native/route';
import { POST as acceptAgreement } from '@/app/api/auth/commission-agreement/route';
import { GET as readSession } from '@/app/api/auth/session/route';
import { createCommissionAgreementToken, parseSignedSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { mockDatabaseMethod } from './helpers/mock-database-method';

const nativeClientId = 'native-route-fixture.apps.googleusercontent.com';
const serverClientId = 'web-route-fixture.apps.googleusercontent.com';
const expectedKeysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://accounts.google.com';

function environment(t: TestContext, overrides: Record<string, string> = {}) {
  const values = {
    AUTH_SECRET: 'isolated-google-native-route-auth-secret',
    GOOGLE_NATIVE_CLIENT_ID: nativeClientId,
    GOOGLE_CLIENT_ID: serverClientId,
    GOOGLE_CLIENT_SECRET: 'synthetic-must-never-be-returned-secret',
    SMARTSTORE_MARKETPLACE_STORE: 'file',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
    SMARTSTORE_ADMIN_EMAILS: '', DATABASE_URL: '', NODE_ENV: 'test',
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

function token(overrides: Record<string, unknown> = {}, key = signingKeys.privateKey) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'native-route-test-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: issuer, aud: nativeClientId, sub: 'native-route-customer',
    email: ' NATIVE-CUSTOMER@EXAMPLE.TEST ', email_verified: true,
    name: 'Verified native customer', picture: 'https://profile.example.invalid/customer.jpg',
    exp: Math.floor(Date.now() / 1000) + 300, ...overrides,
  })).toString('base64url');
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

function request(body: unknown, agreement: string | null = createCommissionAgreementToken()) {
  return new Request('https://native-route.example.test/api/auth/google/native', {
    method: 'POST', headers: {
      'Content-Type': 'application/json',
      ...(agreement ? { 'x-souq-hamad-commission-agreement': agreement } : {}),
    }, body: JSON.stringify(body),
  });
}

function mockKeys(t: TestContext, responder?: () => Response) {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.equal(String(input), expectedKeysUrl, 'Only the controlled Google JWKS transport is allowed.');
    calls++;
    return responder ? responder() : Response.json({ keys: [{
      ...signingKeys.publicKey.export({ format: 'jwk' }), kid: 'native-route-test-key', alg: 'RS256',
    }] });
  });
  return () => calls;
}

function prohibitRegistration(t: TestContext) {
  let attempts = 0;
  mockDatabaseMethod(t, prisma, '$transaction', async () => {
    attempts++;
    throw new Error('Rejected native credentials must not start registration.');
  });
  return () => attempts;
}

test('Google native configuration uses the explicit native client, server fallback and truthful unavailable response', async t => {
  environment(t);
  const calls = mockKeys(t);
  const get = () => nativeConfig(new Request('https://native-route.example.test/api/auth/google/native-config'));
  for (const [native, server, status, expected] of [
    [` ${nativeClientId} `, serverClientId, 200, { clientId: nativeClientId }],
    ['', ` ${serverClientId} `, 200, { clientId: serverClientId }],
    ['', '', 503, { error: 'google_native_unavailable' }],
  ] as const) {
    process.env.GOOGLE_NATIVE_CLIENT_ID = native; process.env.GOOGLE_CLIENT_ID = server;
    const response = await get();
    assert.equal(response.status, status);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await response.json(), expected);
    assert.equal(response.headers.has('set-cookie'), false);
    assert.equal(JSON.stringify(expected).includes('synthetic-must-never-be-returned-secret'), false);
  }
  assert.equal(calls(), 0);
});

test('Google native sign-in consumes the accepted agreement and returns matching verified bearer and cookie sessions', async t => {
  environment(t);
  const calls = mockKeys(t);
  const agreement = await acceptAgreement(new Request('https://native-route.example.test/api/auth/commission-agreement', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted: true }),
  }));
  assert.equal(agreement.status, 200);
  const accepted = await agreement.json();
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.commissionRatePercent, 1);
  assert.equal(typeof accepted.agreementToken, 'string');
  assert.match(agreement.headers.get('set-cookie') ?? '', /^smartstore_commission_agreement=/);
  const response = await nativeSignIn(request({ idToken: token() }, accepted.agreementToken));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const payload = await response.json();
  assert.equal(payload.authenticated, true);
  assert.deepEqual(payload.user, {
    id: 'google:native-route-customer', email: 'native-customer@example.test',
    name: 'Verified native customer', picture: 'https://profile.example.invalid/customer.jpg',
  });
  assert.deepEqual(parseSignedSession(payload.sessionToken)?.user, payload.user);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, /^smartstore_session=/);
  assert.match(cookie, /HttpOnly/);
  const cookieToken = decodeURIComponent(cookie.split(';')[0].slice('smartstore_session='.length));
  assert.deepEqual(parseSignedSession(cookieToken)?.user, payload.user);
  const session = await readSession(new Request('https://native-route.example.test/api/auth/session', {
    headers: { Authorization: `Bearer ${payload.sessionToken}` },
  }));
  assert.equal(session.status, 200);
  const current = await session.json();
  assert.equal(current.authenticated, true);
  assert.equal(current.user.id, payload.user.id);
  assert.equal(current.user.email, payload.user.email);
  assert.equal(JSON.stringify(payload).includes('synthetic-must-never-be-returned-secret'), false);
  assert.equal(calls(), 1);
});

test('Google native rejects absent agreement and token input before any provider or registration work', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'database' });
  const calls = mockKeys(t);
  const registrations = prohibitRegistration(t);
  const missingAgreement = await nativeSignIn(request({ idToken: token() }, null));
  assert.equal(missingAgreement.status, 409);
  assert.deepEqual(await missingAgreement.json(), { error: 'commission_agreement_required' });
  for (const body of [{}, { idToken: '' }, { idToken: '  ' }, { idToken: 42 }]) {
    const response = await nativeSignIn(request(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'missing_google_id_token' });
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.equal(calls(), 0);
  assert.equal(registrations(), 0);
});

test('Google native rejects invalid audience issuer expiry verified-email and signature without issuing or persisting a session', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'database' });
  const calls = mockKeys(t);
  const registrations = prohibitRegistration(t);
  for (const idToken of [
    token({ aud: 'another-client.apps.googleusercontent.com' }), token({ iss: 'https://attacker.example.invalid' }),
    token({ exp: Math.floor(Date.now() / 1000) - 1 }), token({ email_verified: false }),
    token({ email_verified: 'false' }), token({}, otherKeys.privateKey), 'not.a.valid-token',
  ]) {
    const response = await nativeSignIn(request({ idToken }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    assert.deepEqual(await response.json(), { error: 'invalid_google_id_token' });
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.equal(calls(), 1, 'Only the structurally valid token with an invalid signature reaches the JWKS transport.');
  assert.equal(registrations(), 0);
});

test('Google native provider key denial cannot issue a bearer or begin account registration', async t => {
  environment(t, { SMARTSTORE_MARKETPLACE_STORE: 'database' });
  let result = new Response('unavailable', { status: 503 });
  const calls = mockKeys(t, () => result);
  const registrations = prohibitRegistration(t);
  for (const providerResponse of [
    new Response('unavailable', { status: 503 }), Response.json({ keys: [] }),
    new Response('invalid JSON', { status: 200 }),
  ]) {
    result = providerResponse;
    const response = await nativeSignIn(request({ idToken: token() }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'invalid_google_id_token' });
    assert.equal(response.headers.has('set-cookie'), false);
  }
  assert.equal(calls(), 3);
  assert.equal(registrations(), 0);
});
