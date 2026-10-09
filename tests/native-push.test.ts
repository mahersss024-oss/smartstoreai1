import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  listActiveMobilePushTokensForUser,
  resetMobilePushTokenStoreForTests,
  saveMobilePushToken,
} from '@/agent/marketplace/mobile-push-tokens';
import { sendNativePushToUser } from '@/lib/push/native-push';

const nativePushEnvKeys = [
  'SMARTSTORE_MARKETPLACE_STORE',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'GOOGLE_CLOUD_PROJECT',
  'APNS_TEAM_ID',
  'APNS_KEY_ID',
  'APNS_PRIVATE_KEY',
  'APNS_AUTH_KEY',
  'APNS_BUNDLE_ID',
  'APNS_USE_SANDBOX',
] as const;

function snapshotNativePushEnv() {
  return Object.fromEntries(
    nativePushEnvKeys.map((key) => [key, process.env[key]]),
  );
}

function restoreNativePushEnv(snapshot: Record<string, string | undefined>) {
  for (const key of nativePushEnvKeys) {
    const value = snapshot[key];

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function configureApnsForTest() {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  process.env.SMARTSTORE_MARKETPLACE_STORE = '';
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;
  delete process.env.GOOGLE_CLOUD_PROJECT;
  process.env.APNS_TEAM_ID = 'TEAMID1234';
  process.env.APNS_KEY_ID = 'KEYID12345';
  process.env.APNS_PRIVATE_KEY = privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString();
  process.env.APNS_BUNDLE_ID = 'com.souqhamad.app';
  process.env.APNS_USE_SANDBOX = '0';
}

test('native push sends iPhone tokens through APNs', async () => {
  const originalEnv = snapshotNativePushEnv();
  const originalFetch = globalThis.fetch;

  resetMobilePushTokenStoreForTests();
  configureApnsForTest();

  let capturedRequest:
    | {
        url: string;
        headers: Headers;
        body: Record<string, unknown>;
      }
    | undefined;

  globalThis.fetch = async (input, init) => {
    capturedRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    };

    return new Response(null, { status: 200 });
  };

  try {
    await saveMobilePushToken({
      userId: 'user-ios',
      token: 'abcdef123456',
      platform: 'ios',
    });

    await sendNativePushToUser('user-ios', {
      title: 'رسالة جديدة',
      body: 'لديك رسالة في سوق حمد',
      url: '/conversations/123',
      tag: 'conversation',
    });

    assert.ok(capturedRequest);
    assert.equal(
      capturedRequest.url,
      'https://api.push.apple.com/3/device/abcdef123456',
    );
    assert.equal(capturedRequest.headers.get('apns-topic'), 'com.souqhamad.app');
    assert.equal(capturedRequest.headers.get('apns-push-type'), 'alert');
    assert.match(
      capturedRequest.headers.get('authorization') ?? '',
      /^bearer .+\..+\..+$/,
    );
    assert.deepEqual(capturedRequest.body, {
      aps: {
        alert: {
          title: 'رسالة جديدة',
          body: 'لديك رسالة في سوق حمد',
        },
        sound: 'default',
        category: 'conversation',
      },
      url: '/conversations/123',
      tag: 'conversation',
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreNativePushEnv(originalEnv);
    resetMobilePushTokenStoreForTests();
  }
});

test('native push deactivates expired APNs tokens', async () => {
  const originalEnv = snapshotNativePushEnv();
  const originalFetch = globalThis.fetch;

  resetMobilePushTokenStoreForTests();
  configureApnsForTest();

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ reason: 'Unregistered' }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    });

  try {
    await saveMobilePushToken({
      userId: 'user-ios',
      token: 'expired-ios-token',
      platform: 'ios',
    });

    await sendNativePushToUser('user-ios', {
      title: 'رسالة جديدة',
      body: 'لديك رسالة في سوق حمد',
    });

    assert.equal((await listActiveMobilePushTokensForUser('user-ios')).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreNativePushEnv(originalEnv);
    resetMobilePushTokenStoreForTests();
  }
});
