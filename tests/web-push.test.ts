import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { sendWebPush } from '@/lib/push/web-push';
import { buildAuthorizationHeader, isPushConfigured } from '@/lib/push/vapid';

function withVapidEnv(
  publicKey: string,
  privateKey: string,
  fn: () => void,
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    public: env.SMARTSTORE_VAPID_PUBLIC_KEY,
    private: env.SMARTSTORE_VAPID_PRIVATE_KEY,
    subject: env.SMARTSTORE_VAPID_SUBJECT,
  };

  env.SMARTSTORE_VAPID_PUBLIC_KEY = publicKey;
  env.SMARTSTORE_VAPID_PRIVATE_KEY = privateKey;
  env.SMARTSTORE_VAPID_SUBJECT = 'mailto:ops@smartstore-ai.com';

  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries({
      SMARTSTORE_VAPID_PUBLIC_KEY: previous.public,
      SMARTSTORE_VAPID_PRIVATE_KEY: previous.private,
      SMARTSTORE_VAPID_SUBJECT: previous.subject,
    })) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }
}

function withMutableVapidEnv(
  values: {
    publicKey: string;
    privateKey: string;
    subject?: string;
    timeoutMs?: string;
  },
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = {
    public: env.SMARTSTORE_VAPID_PUBLIC_KEY,
    private: env.SMARTSTORE_VAPID_PRIVATE_KEY,
    subject: env.SMARTSTORE_VAPID_SUBJECT,
    timeout: env.SMARTSTORE_PUSH_TIMEOUT_MS,
  };

  env.SMARTSTORE_VAPID_PUBLIC_KEY = values.publicKey;
  env.SMARTSTORE_VAPID_PRIVATE_KEY = values.privateKey;
  env.SMARTSTORE_VAPID_SUBJECT =
    values.subject ?? 'mailto:ops@smartstore-ai.com';

  if (values.timeoutMs === undefined) {
    delete env.SMARTSTORE_PUSH_TIMEOUT_MS;
  } else {
    env.SMARTSTORE_PUSH_TIMEOUT_MS = values.timeoutMs;
  }

  return () => {
    for (const [key, value] of Object.entries({
      SMARTSTORE_VAPID_PUBLIC_KEY: previous.public,
      SMARTSTORE_VAPID_PRIVATE_KEY: previous.private,
      SMARTSTORE_VAPID_SUBJECT: previous.subject,
      SMARTSTORE_PUSH_TIMEOUT_MS: previous.timeout,
    })) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  };
}

function createVapidKeys() {
  const { privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const privateJwk = privateKey.export({ format: 'jwk' });
  const x = Buffer.from(privateJwk.x!, 'base64url');
  const y = Buffer.from(privateJwk.y!, 'base64url');
  const uncompressed = Buffer.concat([Buffer.from([0x04]), x, y]);

  return {
    publicKey: uncompressed.toString('base64url'),
    privateKey: privateJwk.d!,
  };
}

test('isPushConfigured is false without env keys', () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.SMARTSTORE_VAPID_PUBLIC_KEY;
  delete env.SMARTSTORE_VAPID_PUBLIC_KEY;

  try {
    assert.equal(isPushConfigured(), false);
  } finally {
    env.SMARTSTORE_VAPID_PUBLIC_KEY = previous;
  }
});

test('builds a VAPID authorization header with the public key', () => {
  const keys = createVapidKeys();

  withVapidEnv(keys.publicKey, keys.privateKey, () => {
    assert.equal(isPushConfigured(), true);

    const header = buildAuthorizationHeader(
      'https://fcm.googleapis.com/fcm/send/abc',
      {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        subject: 'mailto:ops@smartstore-ai.com',
      },
    );

    assert.match(header, /^vapid t=/);
    assert.ok(header.includes(keys.publicKey));
  });
});

test('sendWebPush fails cleanly when push is not configured', async () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.SMARTSTORE_VAPID_PUBLIC_KEY;
  const previousPrivate = env.SMARTSTORE_VAPID_PRIVATE_KEY;
  const previousSubject = env.SMARTSTORE_VAPID_SUBJECT;
  delete env.SMARTSTORE_VAPID_PUBLIC_KEY;
  delete env.SMARTSTORE_VAPID_PRIVATE_KEY;
  delete env.SMARTSTORE_VAPID_SUBJECT;

  try {
    const result = await sendWebPush(
      {
        endpoint: 'https://push.example.com/x',
        p256dh: 'abc',
        auth: 'def',
      },
      { title: 'Test', body: 'Body' },
    );

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.equal(result.reason, 'push_not_configured');
    }
  } finally {
    env.SMARTSTORE_VAPID_PUBLIC_KEY = previous;
    env.SMARTSTORE_VAPID_PRIVATE_KEY = previousPrivate;
    env.SMARTSTORE_VAPID_SUBJECT = previousSubject;
  }
});

test('sendWebPush times out stalled push endpoints', async () => {
  const vapidKeys = createVapidKeys();
  const recipientKeys = createVapidKeys();
  const restoreEnv = withMutableVapidEnv({
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
    timeoutMs: '1',
  });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });

    throw new Error('unreachable');
  };

  try {
    const result = await sendWebPush(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/stalled',
        p256dh: recipientKeys.publicKey,
        auth: Buffer.alloc(16, 1).toString('base64url'),
      },
      { title: 'Test', body: 'Body' },
    );

    assert.equal(result.ok, false);

    if (!result.ok) {
      assert.match(result.reason, /AbortError|TimeoutError/i);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
