import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { GET as startGoogle } from '@/app/api/auth/google/start/route';
import { GET as callbackGoogle } from '@/app/api/auth/google/callback/route';
import { POST as callbackApple } from '@/app/api/auth/apple/callback/route';
import { GET as startApple } from '@/app/api/auth/apple/start/route';
import { createMobileAuthState } from '@/lib/auth/mobile-oauth';
import { createCommissionAgreementCookie, createOauthState, createOauthStateCookie, isOauthStateValid } from '@/lib/auth/session';

function testEnvironment(overrides: Record<string, string> = {}) {
  const changes = {
    GOOGLE_CLIENT_ID: 'browser-boundary.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'synthetic-browser-boundary-secret',
    NEXT_PUBLIC_APP_URL: 'https://souqhamad.com',
    SMARTSTORE_MARKETPLACE_STORE: 'file',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    SMARTSTORE_REALTIME_BACKEND: 'memory',
    SMARTSTORE_PUSH_ENABLED: '0',
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  Object.assign(process.env, changes);
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

const cookiePair = (cookie: string) => cookie.split(';')[0];
const sessionCookie = (response: Response) => response.headers.getSetCookie().find(value => value.startsWith('smartstore_session='));

test('browser OAuth state requires its matching signed browser cookie', () => {
  const state = createOauthState();
  assert.equal(isOauthStateValid(state, undefined), false);
  assert.equal(isOauthStateValid(state, createOauthState()), false);
  assert.equal(isOauthStateValid('unsigned-state', 'unsigned-state'), false);
  assert.equal(isOauthStateValid(`${state}tampered`, `${state}tampered`), false);
  assert.equal(isOauthStateValid(state, state), true);
});

test('Google callback rejects missing and different browser cookies before contacting Google', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider request'); };
  try {
    const state = createOauthState();
    const url = `https://souqhamad.com/api/auth/google/callback?code=synthetic-code&state=${encodeURIComponent(state)}`;
    for (const cookie of ['', cookiePair(createOauthStateCookie(createOauthState()))]) {
      const result = await callbackGoogle(new Request(url, { headers: { cookie } }));
      assert.equal(result.status, 307);
      assert.equal(sessionCookie(result), undefined);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('Google browser start/callback succeeds once and does not recover a session from a consumed code', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  let exchanges = 0;
  let profiles = 0;
  globalThis.fetch = async input => {
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      exchanges++;
      return exchanges === 1 ? Response.json({ access_token: 'synthetic-access-token' })
        : Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    assert.equal(String(input), 'https://www.googleapis.com/oauth2/v3/userinfo');
    profiles++;
    return Response.json({ sub: 'browser-boundary-user', email: 'browser-boundary@example.invalid', email_verified: true });
  };
  try {
    const agreement = cookiePair(createCommissionAgreementCookie());
    const started = await startGoogle(new Request('https://souqhamad.com/api/auth/google/start', { headers: { cookie: agreement } }));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = started.headers.getSetCookie().find(value => value.startsWith('smartstore_oauth_state='))!;
    assert.ok(stateCookie);
    const url = `https://souqhamad.com/api/auth/google/callback?code=browser-boundary-once-code&state=${encodeURIComponent(state)}`;
    const request = () => new Request(url, { headers: { cookie: `${agreement}; ${cookiePair(stateCookie)}` } });
    const initial = await callbackGoogle(request());
    assert.ok(sessionCookie(initial));
    const replay = await callbackGoogle(request());
    assert.equal(sessionCookie(replay), undefined);
    assert.equal(exchanges, 2);
    assert.equal(profiles, 1);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('Google administrative sign-in returns to the signed administration destination', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => String(input) === 'https://oauth2.googleapis.com/token'
    ? Response.json({ access_token: 'synthetic-admin-return-access' })
    : Response.json({ sub: 'admin-return-fixture', email: 'admin-return@example.invalid', email_verified: true });
  try {
    const agreement = cookiePair(createCommissionAgreementCookie());
    const started = await startGoogle(new Request('https://souqhamad.com/api/auth/google/start?return_to=%2Fadmin%2Fusers', { headers: { cookie: agreement } }));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const cookie = `${agreement}; ${cookiePair(createOauthStateCookie(state))}`;
    const response = await callbackGoogle(new Request(`https://souqhamad.com/api/auth/google/callback?code=admin-return-fixture&state=${encodeURIComponent(state)}`, { headers: { cookie } }));
    assert.equal(response.status, 307);
    assert.equal(new URL(response.headers.get('location')!).pathname, '/admin/users');
    assert.ok(sessionCookie(response));
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('Apple form_post rejects an absent browser binding before external token exchange', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Unexpected provider request'); };
  try {
    const state = createOauthState();
    const response = await callbackApple(new Request('https://souqhamad.com/api/auth/apple/callback', {
      method: 'POST', body: new URLSearchParams({ code: 'apple-code', id_token: 'apple-token', state }),
    }));
    assert.equal(response.status, 400);
    assert.equal(sessionCookie(response), undefined);
    assert.equal(calls, 0);
    const cookie = createOauthStateCookie(state, { sameSite: 'None', secure: true });
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
    assert.equal(isOauthStateValid(state, state), true);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('mobile browser handoff retains its explicit signed-state error callback', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    return Response.json({ error: 'invalid_grant' }, { status: 400 });
  };
  try {
    const state = createMobileAuthState();
    const response = await callbackGoogle(new Request(`https://souqhamad.com/api/auth/google/callback?code=mobile-expired-code&state=${encodeURIComponent(state)}`, {
      headers: { cookie: cookiePair(createOauthStateCookie(state)) },
    }));
    const target = new URL(response.headers.get('location')!);
    assert.equal(target.protocol, 'smartstore:');
    assert.equal(target.searchParams.get('error'), 'google_sign_in_expired');
    assert.equal(sessionCookie(response), undefined);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('mobile browser callback rejects a signed state stolen from a different browser', async () => {
  const restore = testEnvironment();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('A mismatched browser must not reach the provider'); };
  try {
    const state = createMobileAuthState();
    for (const cookie of ['', cookiePair(createOauthStateCookie(createMobileAuthState()))]) {
      const response = await callbackGoogle(new Request(`https://souqhamad.com/api/auth/google/callback?code=unused&state=${encodeURIComponent(state)}`, { headers: { cookie } }));
      assert.equal(new URL(response.headers.get('location')!).searchParams.get('error'), 'google_invalid_state');
      assert.equal(sessionCookie(response), undefined);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('Apple form_post with the matching browser cookie completes its verified sign-in and redirects with GET', async () => {
  const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identityKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clientId = 'com.souqhamad.browser.test';
  const restore = testEnvironment({
    APPLE_CLIENT_ID: clientId, APPLE_TEAM_ID: 'browser-test-team', APPLE_KEY_ID: 'browser-test-key',
    APPLE_PRIVATE_KEY: signingKey.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const originalFetch = globalThis.fetch;
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'browser-apple-key' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({ iss: 'https://appleid.apple.com', aud: clientId,
    sub: 'browser-apple-user', email: 'browser-apple@example.invalid', email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url');
  const token = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), identityKey.privateKey).toString('base64url')}`;
  const requested: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    requested.push(url);
    if (url === 'https://appleid.apple.com/auth/token') return Response.json({ id_token: token });
    assert.equal(url, 'https://appleid.apple.com/auth/keys');
    return Response.json({ keys: [{ ...identityKey.publicKey.export({ format: 'jwk' }), kid: 'browser-apple-key', alg: 'RS256' }] });
  };
  try {
    const agreement = cookiePair(createCommissionAgreementCookie());
    const started = await startApple(new Request('https://souqhamad.com/api/auth/apple/start', { headers: { cookie: agreement } }));
    const state = new URL(started.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = started.headers.getSetCookie().find(value => value.startsWith('smartstore_oauth_state='))!;
    assert.match(stateCookie, /SameSite=None/);
    assert.match(stateCookie, /Secure/);
    const response = await callbackApple(new Request('https://souqhamad.com/api/auth/apple/callback', {
      method: 'POST', headers: { origin: 'https://appleid.apple.com', cookie: `${agreement}; ${cookiePair(stateCookie)}` },
      body: new URLSearchParams({ state, code: 'browser-apple-code', id_token: token }),
    }));
    assert.ok(sessionCookie(response));
    assert.equal(response.status, 303, 'form_post must not replay its POST against the GET-only home page');
    assert.deepEqual(requested, ['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/keys']);
  } finally { globalThis.fetch = originalFetch; restore(); }
});
