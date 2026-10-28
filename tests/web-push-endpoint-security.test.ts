import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { POST as subscribe } from '@/app/api/push/subscribe/route';
import { sendWebPush } from '@/lib/push/web-push';

const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(key.x!, 'base64url'), Buffer.from(key.y!, 'base64url')]).toString('base64url');
const auth = Buffer.alloc(16, 1).toString('base64url');
const rejected = [
  'http://127.0.0.1/internal', 'https://127.0.0.1/internal', 'https://[::1]/internal',
  'https://169.254.169.254/latest/meta-data', 'https://2130706433/internal',
  'https://fcm.googleapis.com.attacker.invalid/push', 'https://attacker.invalid/push',
  'https://fcm.googleapis.com@127.0.0.1/push', 'https://user:secret@fcm.googleapis.com/push',
  'http://fcm.googleapis.com/push', 'https://fcm.googleapis.com:8443/push',
  'https://fcm.googleapis.com/push#fragment',
];

function setup() {
  const env = {
    SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    SMARTSTORE_VAPID_PUBLIC_KEY: publicKey, SMARTSTORE_VAPID_PRIVATE_KEY: key.d!,
    SMARTSTORE_VAPID_SUBJECT: 'mailto:synthetic@example.invalid',
  };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  return () => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function request(endpoint: string) {
  return new Request('https://souqhamad.com/api/push/subscribe', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, keys: { p256dh: publicKey, auth } }),
  });
}

test('Web Push subscription rejects local, untrusted, credentialed and non-HTTPS destinations', async () => {
  const restore = setup();
  try {
    for (const endpoint of rejected) {
      const response = await subscribe(request(endpoint));
      assert.equal(response.status, 400, endpoint);
      assert.equal((await response.json()).error, 'invalid_push_endpoint');
    }
  } finally { restore(); }
});

test('known browser push provider registrations retain their existing contract', async () => {
  const restore = setup();
  try {
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/browser-test',
      'https://updates.push.services.mozilla.com/wpush/v2/browser-test',
      'https://web.push.apple.com/browser-test',
      'https://wns2-example.notify.windows.com/browser-test',
    ]) {
      const response = await subscribe(request(endpoint));
      assert.equal(response.status, 200);
      assert.equal(typeof (await response.json()).id, 'string');
    }
  } finally { restore(); }
});

test('sending previously stored unsafe subscriptions makes no network request', async () => {
  const restore = setup();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 201 }); };
  try {
    for (const endpoint of rejected) {
      const result = await sendWebPush({ endpoint, p256dh: publicKey, auth }, { title: 'Test', body: 'Fixture' });
      assert.equal(result.ok, false, endpoint);
      if (!result.ok) {
        assert.equal(result.reason, 'invalid_push_endpoint');
        assert.equal(result.expired, true);
      }
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('Web Push sends only to the validated provider and never follows redirects', async () => {
  const restore = setup();
  const originalFetch = globalThis.fetch;
  let redirect: RequestRedirect | undefined;
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    redirect = init?.redirect;
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } });
  };
  try {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/redirect-test';
    const result = await sendWebPush({ endpoint, p256dh: publicKey, auth }, { title: 'Test', body: 'Fixture' });
    assert.equal(redirect, 'error');
    assert.deepEqual(calls, [endpoint]);
    assert.equal(result.ok, false);
  } finally { globalThis.fetch = originalFetch; restore(); }
});
