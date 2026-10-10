import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { GET as startGoogleAuth } from '@/app/api/auth/google/start/route';
import { createCommissionAgreementCookie } from '@/lib/auth/session';
import { createAppleClientSecret, isAppleAuthConfigured } from '@/lib/auth/apple';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

test('apple auth requires explicit production credentials', () => {
  const previous = {
    clientId: process.env.APPLE_CLIENT_ID,
    teamId: process.env.APPLE_TEAM_ID,
    keyId: process.env.APPLE_KEY_ID,
    privateKey: process.env.APPLE_PRIVATE_KEY,
  };

  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;

  try {
    assert.equal(isAppleAuthConfigured(), false);
    assert.throws(() => createAppleClientSecret(), /APPLE_AUTH_NOT_CONFIGURED/);
  } finally {
    restoreEnv('APPLE_CLIENT_ID', previous.clientId);
    restoreEnv('APPLE_TEAM_ID', previous.teamId);
    restoreEnv('APPLE_KEY_ID', previous.keyId);
    restoreEnv('APPLE_PRIVATE_KEY', previous.privateKey);
  }
});

test('apple auth routes use Apple OAuth endpoints and callback state', () => {
  const startRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'apple',
    'start',
    'route.ts',
  );
  const callbackRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'apple',
    'callback',
    'route.ts',
  );

  assert.match(startRoute, /appleid\.apple\.com\/auth\/authorize/);
  assert.match(startRoute, /enforceApiRateLimit/);
  assert.match(startRoute, /auth_apple_start/);
  assert.match(startRoute, /Apple sign-in is temporarily unavailable/);
  assert.doesNotMatch(startRoute, /Apple OAuth is not configured/);
  assert.match(startRoute, /isMobileAuthRequest\(request\)/);
  assert.match(startRoute, /createMobileAuthState\(\)/);
  assert.match(startRoute, /response_mode', 'form_post'/);
  assert.match(startRoute, /createOauthStateCookie/);
  assert.match(startRoute, /sameSite:\s*'None'/);
  assert.match(startRoute, /secure:\s*true/);
  assert.match(callbackRoute, /appleid\.apple\.com\/auth\/token/);
  assert.match(callbackRoute, /verifyAppleIdentityToken/);
  assert.match(callbackRoute, /parseMobileAuthState\(state\)/);
  assert.match(callbackRoute, /createMobileAuthCallbackUrl\(createMobileAuthTicket\(registeredUser\)\)/);
  assert.match(callbackRoute, /normalizeAuthEmail\(identity\.email\)/);
  assert.match(callbackRoute, /getOauthState/);
  assert.match(callbackRoute, /enforceApiRateLimit/);
  assert.match(callbackRoute, /auth_apple_callback/);
  assert.match(callbackRoute, /Apple sign-in is temporarily unavailable/);
  assert.match(callbackRoute, /rejectOversizedRequest/);
  assert.match(callbackRoute, /fetchWithTimeout/);
});

test('apple identity token verification uses bounded JWKS fetches', () => {
  const appleAuth = readProjectFile('lib', 'auth', 'apple.ts');

  assert.match(appleAuth, /fetchWithTimeout\(appleKeysUrl/);
  assert.doesNotMatch(appleAuth, /await fetch\(appleKeysUrl/);
});

test('google auth callback uses bounded external provider calls', () => {
  const startRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'google',
    'start',
    'route.ts',
  );
  const callbackRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'google',
    'callback',
    'route.ts',
  );

  assert.match(startRoute, /enforceApiRateLimit/);
  assert.match(startRoute, /auth_google_start/);
  assert.match(startRoute, /Google sign-in is temporarily unavailable/);
  assert.doesNotMatch(startRoute, /GOOGLE_CLIENT_ID is not configured/);
  assert.match(callbackRoute, /enforceApiRateLimit/);
  assert.match(callbackRoute, /auth_google_callback/);
  assert.match(callbackRoute, /Google sign-in is temporarily unavailable/);
  assert.doesNotMatch(callbackRoute, /Google OAuth is not configured/);
  assert.match(callbackRoute, /fetchWithTimeout\('https:\/\/oauth2\.googleapis\.com\/token'/);
  assert.match(callbackRoute, /fetchWithTimeout\(\s*'https:\/\/www\.googleapis\.com\/oauth2\/v3\/userinfo'/);
  assert.match(callbackRoute, /normalizeAuthEmail\(userInfo\.email\)/);
  assert.match(callbackRoute, /tokenResponse\.json\(\)\.catch/);
  assert.match(callbackRoute, /userInfoResponse\.json\(\)\.catch/);
});

test('google auth start uses the configured سوق حمد callback url', async () => {
  const previous = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
  };

  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.NEXT_PUBLIC_APP_URL = 'https://www.souqhamad.com';

  try {
    const response = await startGoogleAuth(
      new Request('https://www.souqhamad.com/api/auth/google/start', {
        headers: {
          cookie: createCommissionAgreementCookie(),
        },
      }),
    );
    const location = response.headers.get('location');

    assert.ok(location);
    assert.equal(
      new URL(location).searchParams.get('redirect_uri'),
      'https://souqhamad.com/api/auth/google/callback',
    );
  } finally {
    restoreEnv('GOOGLE_CLIENT_ID', previous.clientId);
    restoreEnv('NEXT_PUBLIC_APP_URL', previous.publicAppUrl);
  }
});

test('google auth start accepts explicit mobile client marker', async () => {
  const previous = {
    clientId: process.env.GOOGLE_CLIENT_ID,
    publicAppUrl: process.env.NEXT_PUBLIC_APP_URL,
  };

  process.env.GOOGLE_CLIENT_ID = 'google-client-id';
  process.env.NEXT_PUBLIC_APP_URL = 'https://souqhamad.com';

  try {
    const response = await startGoogleAuth(
      new Request('https://souqhamad.com/api/auth/google/start?client=mobile', {
        headers: {
          cookie: createCommissionAgreementCookie(),
        },
      }),
    );
    const location = response.headers.get('location');

    assert.ok(location);
    assert.match(new URL(location).searchParams.get('state') ?? '', /^mobile:/);
  } finally {
    restoreEnv('GOOGLE_CLIENT_ID', previous.clientId);
    restoreEnv('NEXT_PUBLIC_APP_URL', previous.publicAppUrl);
  }
});

test('mobile auth marker is preserved through commission agreement', () => {
  const startRoute = readProjectFile(
    'app',
    'api',
    'auth',
    'google',
    'start',
    'route.ts',
  );
  const agreementPage = readProjectFile('app', 'commission-agreement', 'page.tsx');

  assert.match(startRoute, /appendMobileClientParam\(agreementUrl\)/);
  assert.match(agreementPage, /client=mobile/);
});

test('home login control offers Google and Apple choices', () => {
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(homePage, /function AuthProviderMenu/);
  assert.match(homePage, /api\/auth\/google\/start/);
  assert.match(homePage, /api\/auth\/apple\/start/);
  assert.doesNotMatch(homePage, /NEXT_PUBLIC_ENABLE_APPLE_SIGN_IN/);
});

test('commission agreement copy does not imply Google is the only provider', () => {
  const agreementPage = readProjectFile('app', 'commission-agreement', 'page.tsx');

  assert.match(agreementPage, /مزود الدخول المختار/);
  assert.doesNotMatch(agreementPage, /تسجيل Google/);
});

test('login provider controls use brand marks instead of letter placeholders', () => {
  const providerMarks = readProjectFile('components', 'auth-provider-mark.tsx');
  const homePage = readProjectFile('app', 'page.tsx');

  assert.match(providerMarks, /export function GoogleMark/);
  assert.match(providerMarks, /#4285F4/);
  assert.match(providerMarks, /#34A853/);
  assert.match(providerMarks, /#FBBC05/);
  assert.match(providerMarks, /#EA4335/);
  assert.match(providerMarks, /export function AppleMark/);
  assert.match(homePage, /<GoogleMark className="size-5" \/>/);
  assert.match(homePage, /<AppleMark className="size-5/);
});
