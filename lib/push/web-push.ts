import {
  createCipheriv,
  createECDH,
  createHmac,
  randomBytes,
} from 'node:crypto';

import {
  buildAuthorizationHeader,
  getVapidConfig,
  isPushConfigured,
} from './vapid';
import { fetchWithTimeout } from '../api/fetch-timeout';
import { isAllowedWebPushEndpoint } from './endpoint';

// Minimal Web Push (RFC 8291 aes128gcm) sender built on node:crypto only.

export type PushSubscriptionRecord = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export type PushMessage = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type EncryptedPayload = {
  body: Buffer;
  salt: Buffer;
  localPublicKey: Buffer;
};

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url');
}

function hkdf(
  salt: Buffer,
  ikm: Buffer,
  info: Buffer,
  length: number,
) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const output = createHmac('sha256', prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();

  return output.subarray(0, length);
}

function encryptPayload(
  sub: PushSubscriptionRecord,
  plaintext: Buffer,
): EncryptedPayload {
  const recipientPublicKey = base64UrlDecode(sub.p256dh);
  const authSecret = base64UrlDecode(sub.auth);

  const localEcdh = createECDH('prime256v1');
  localEcdh.generateKeys();
  const localPublicKey = localEcdh.getPublicKey();
  const sharedSecret = localEcdh.computeSecret(recipientPublicKey);
  const salt = randomBytes(16);

  // RFC 8291 key derivation.
  const authInfo = Buffer.from('WebPush: info\0');
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([authInfo, recipientPublicKey, localPublicKey]),
    32,
  );
  const cek = hkdf(
    salt,
    ikm,
    Buffer.from('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = hkdf(
    salt,
    ikm,
    Buffer.from('Content-Encoding: nonce\0'),
    12,
  );

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // RFC 8188 record padding delimiter.
  const padded = Buffer.concat([plaintext, Buffer.from([2])]);
  const encrypted = Buffer.concat([
    cipher.update(padded),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return { body: encrypted, salt, localPublicKey };
}

function buildEncryptedRequest(encrypted: EncryptedPayload) {
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);

  return Buffer.concat([
    encrypted.salt,
    recordSize,
    Buffer.from([encrypted.localPublicKey.length]),
    encrypted.localPublicKey,
    encrypted.body,
  ]);
}

export type SendPushResult =
  | { ok: true }
  | { ok: false; status?: number; reason: string; expired?: boolean };

function getPushTimeoutMs() {
  const rawValue = process.env.SMARTSTORE_PUSH_TIMEOUT_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 10_000;

  if (!Number.isFinite(parsedValue)) {
    return 10_000;
  }

  return Math.min(Math.max(parsedValue, 1_000), 30_000);
}

export async function sendWebPush(
  subscription: PushSubscriptionRecord,
  message: PushMessage,
): Promise<SendPushResult> {
  const config = getVapidConfig();

  if (!config) {
    return { ok: false, reason: 'push_not_configured' };
  }

  // Revalidate persisted subscriptions as well as new registrations. Unsafe old
  // records are deactivated by the dispatcher without sending their payload.
  if (!isAllowedWebPushEndpoint(subscription.endpoint)) {
    return { ok: false, reason: 'invalid_push_endpoint', expired: true };
  }

  try {
    const payload = Buffer.from(
      JSON.stringify({
        title: message.title,
        body: message.body,
        url: message.url ?? '/',
        tag: message.tag,
      }),
      'utf8',
    );
    const encrypted = encryptPayload(subscription, payload);
    const body = buildEncryptedRequest(encrypted);

    const response = await fetchWithTimeout(
      subscription.endpoint,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Encoding': 'aes128gcm',
          TTL: '2419200',
          Authorization: buildAuthorizationHeader(subscription.endpoint, config),
        },
        body,
      },
      getPushTimeoutMs(),
    );

    if (response.ok) {
      return { ok: true };
    }

    // 404/410 means the subscription is gone and should be deactivated.
    const expired = response.status === 404 || response.status === 410;

    return {
      ok: false,
      status: response.status,
      reason: `push_failed_${response.status}`,
      expired,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

export { isPushConfigured, getVapidConfig };
