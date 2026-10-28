import { generateKeyPairSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import http2, { type ClientHttp2Session, type OutgoingHttpHeaders } from 'node:http2';

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
  'SMARTSTORE_NATIVE_PUSH_TIMEOUT_MS',
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

function fakeApnsConnection(status: number, reason?: string, capture?: (host: string, headers: OutgoingHttpHeaders, body: string) => void) {
  return (host: string) => {
    const session = new EventEmitter() as EventEmitter & { request: (headers: OutgoingHttpHeaders) => unknown; close: () => void; destroy: () => void; alpnProtocol: string };
    session.alpnProtocol = 'h2';
    session.close = () => {}; session.destroy = () => {};
    session.request = headers => {
      const stream = new EventEmitter() as EventEmitter & { end: (body: string) => void; close: () => void; destroy: () => void };
      stream.close = () => {}; stream.destroy = () => {};
      stream.end = body => {
        capture?.(host, headers, body);
        queueMicrotask(() => {
          stream.emit('response', { ':status': status });
          if (reason) stream.emit('data', Buffer.from(JSON.stringify({ reason })));
          stream.emit('end');
        });
      };
      return stream;
    };
    return session as unknown as ClientHttp2Session;
  };
}

test('native push sends iPhone tokens through APNs', async t => {
  const originalEnv = snapshotNativePushEnv();

  resetMobilePushTokenStoreForTests();
  configureApnsForTest();

  let capturedRequest:
    | {
        url: string;
        headers: Headers;
        body: Record<string, unknown>;
      }
    | undefined;

  t.mock.method(http2, 'connect', fakeApnsConnection(200, undefined, (host, headers, body) => {
    capturedRequest = {
      url: `${host}${headers[':path']}`,
      headers: new Headers(Object.entries(headers).filter(([key]) => !key.startsWith(':')).map(([key, value]): [string, string] => [key, String(value)])),
      body: JSON.parse(body),
    };
  }));

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
    restoreNativePushEnv(originalEnv);
    resetMobilePushTokenStoreForTests();
  }
});

test('native push deactivates expired APNs tokens', async t => {
  const originalEnv = snapshotNativePushEnv();

  resetMobilePushTokenStoreForTests();
  configureApnsForTest();

  t.mock.method(http2, 'connect', fakeApnsConnection(410, 'Unregistered'));

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
    restoreNativePushEnv(originalEnv);
    resetMobilePushTokenStoreForTests();
  }
});

test('APNs delivery errors keep valid device registrations unless APNs identifies an invalid token', async t => {
  for (const [status, reason, remains] of [[400, 'PayloadTooLarge', true], [403, 'ExpiredProviderToken', true], [400, 'BadDeviceToken', false]] as const) {
    await t.test(reason, async child => {
      const originalEnv = snapshotNativePushEnv();
      resetMobilePushTokenStoreForTests(); configureApnsForTest();
      child.mock.method(http2, 'connect', fakeApnsConnection(status, reason));
      try {
        await saveMobilePushToken({ userId: 'user-ios-error', token: 'ios-error-token-fixture', platform: 'ios' });
        const delivery = sendNativePushToUser('user-ios-error', { title: 'رسالة', body: 'أهلًا' });
        if (remains) await assert.rejects(delivery, /native_push_delivery_failed/); else await delivery;
        assert.equal((await listActiveMobilePushTokensForUser('user-ios-error')).length, remains ? 1 : 0);
      } finally { restoreNativePushEnv(originalEnv); resetMobilePushTokenStoreForTests(); }
    });
  }
});

test('FCM only deactivates registrations for token-specific failures, not generic HTTP errors', async t => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fcmError = (errorCode: string) => ({ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode });
  const badRequest = (field: string) => ({ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field }] });
  const cases = [
    { name: 'payload INVALID_ARGUMENT', status: 400, details: [badRequest('message.data[0].value')], remains: true },
    { name: 'ambiguous INVALID_ARGUMENT', status: 400, details: [fcmError('INVALID_ARGUMENT')], remains: true },
    { name: 'invalid registration field', status: 400, details: [badRequest('message.token')], remains: false },
    { name: 'unregistered device', status: 404, details: [fcmError('UNREGISTERED')], remains: false },
    { name: 'wrong project or generic not found', status: 404, details: [], remains: true },
    { name: 'temporary provider outage', status: 503, details: [], remains: true },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async child => {
      const originalEnv = snapshotNativePushEnv();
      resetMobilePushTokenStoreForTests();
      process.env.SMARTSTORE_MARKETPLACE_STORE = '';
      process.env.FIREBASE_PROJECT_ID = 'test-project';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.invalid';
      process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      delete process.env.APNS_TEAM_ID; delete process.env.APNS_KEY_ID;
      child.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-firebase-access', expires_in: 3600 });
        assert.equal(url, 'https://fcm.googleapis.com/v1/projects/test-project/messages:send');
        return Response.json({ error: { details: fixture.details } }, { status: fixture.status });
      });
      try {
        await saveMobilePushToken({ userId: 'user-android-error', token: 'android-error-token-fixture', platform: 'android' });
        const delivery = sendNativePushToUser('user-android-error', { title: 'رسالة', body: 'أهلًا' });
        if (fixture.remains) await assert.rejects(delivery, /native_push_delivery_failed/); else await delivery;
        assert.equal((await listActiveMobilePushTokensForUser('user-android-error')).length, fixture.remains ? 1 : 0);
      } finally { restoreNativePushEnv(originalEnv); resetMobilePushTokenStoreForTests(); }
    });
  }
});

test('FCM rejection parsing is aborted by the delivery deadline and preserves the token', async t => {
  const originalEnv = snapshotNativePushEnv();
  resetMobilePushTokenStoreForTests();
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.SMARTSTORE_MARKETPLACE_STORE = '';
  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_CLIENT_EMAIL = 'test@example.invalid';
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  process.env.SMARTSTORE_NATIVE_PUSH_TIMEOUT_MS = '1000';
  delete process.env.APNS_TEAM_ID; delete process.env.APNS_KEY_ID;
  let aborted = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-firebase-access', expires_in: 3600 });
    const body = new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => { aborted = true; controller.error(new Error('fixture response aborted')); }, { once: true });
    } });
    return new Response(body, { status: 400 });
  });
  try {
    await saveMobilePushToken({ userId: 'android-stalled', token: 'android-stalled-token-fixture', platform: 'android' });
    await assert.rejects(sendNativePushToUser('android-stalled', { title: 'رسالة', body: 'أهلًا' }), /native_push_delivery_failed/);
    assert.equal(aborted, true);
    assert.equal((await listActiveMobilePushTokensForUser('android-stalled')).length, 1);
  } finally { restoreNativePushEnv(originalEnv); resetMobilePushTokenStoreForTests(); }
});
