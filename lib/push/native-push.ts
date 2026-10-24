import { createSign } from 'node:crypto';

import {
  deactivateMobilePushToken,
  listActiveMobilePushTokensForUser,
} from '@/agent/marketplace/mobile-push-tokens';

import { fetchWithTimeout } from '../api/fetch-timeout';
import { postApnsHttp2 } from './apns-http2';

type NativePushMessage = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type FirebaseServiceAccountConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
  useSandbox: boolean;
};

type FirebaseAccessToken = {
  token: string;
  expiresAt: number;
};

type NativePushSendResult =
  | { ok: true }
  | { ok: false; reason: string; status?: number; expired?: boolean };

let cachedAccessToken: FirebaseAccessToken | null = null;

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function getNativePushTimeoutMs() {
  const rawValue =
    process.env.SMARTSTORE_NATIVE_PUSH_TIMEOUT_MS?.trim() ||
    process.env.SMARTSTORE_PUSH_TIMEOUT_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 10_000;

  if (!Number.isFinite(parsedValue)) {
    return 10_000;
  }

  return Math.min(Math.max(parsedValue, 1_000), 30_000);
}

function decodePrivateKey(value: string) {
  const trimmed = value.trim();

  if (trimmed.includes('BEGIN PRIVATE KEY')) {
    return trimmed.replace(/\\n/g, '\n');
  }

  try {
    return Buffer.from(trimmed, 'base64').toString('utf8').replace(/\\n/g, '\n');
  } catch {
    return trimmed.replace(/\\n/g, '\n');
  }
}

function getFirebaseServiceAccountConfig(): FirebaseServiceAccountConfig | null {
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey: decodePrivateKey(privateKey),
  };
}

function getApnsConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const keyId = process.env.APNS_KEY_ID?.trim();
  const privateKey =
    process.env.APNS_PRIVATE_KEY?.trim() || process.env.APNS_AUTH_KEY?.trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || 'com.souqhamad.app';
  const useSandbox =
    process.env.APNS_USE_SANDBOX?.trim().toLowerCase() === 'true' ||
    process.env.APNS_USE_SANDBOX?.trim() === '1';

  if (!teamId || !keyId || !privateKey || !bundleId) {
    return null;
  }

  return {
    teamId,
    keyId,
    privateKey: decodePrivateKey(privateKey),
    bundleId,
    useSandbox,
  };
}

function isNativePushConfigured() {
  return Boolean(getFirebaseServiceAccountConfig() || getApnsConfig());
}

function createServiceAccountJwt(config: FirebaseServiceAccountConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: config.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims),
  )}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(config.privateKey);

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

async function getFirebaseAccessToken(config: FirebaseServiceAccountConfig) {
  const now = Date.now();

  if (cachedAccessToken && cachedAccessToken.expiresAt - 60_000 > now) {
    return cachedAccessToken.token;
  }

  const response = await fetchWithTimeout(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createServiceAccountJwt(config),
      }),
    },
    getNativePushTimeoutMs(),
  );

  if (!response.ok) {
    throw new Error(`firebase_auth_failed_${response.status}`);
  }

  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    throw new Error('firebase_auth_missing_token');
  }

  cachedAccessToken = {
    token: payload.access_token,
    expiresAt: now + (payload.expires_in ?? 3600) * 1000,
  };

  return cachedAccessToken.token;
}

async function sendFirebaseMessage(
  token: string,
  message: NativePushMessage,
): Promise<NativePushSendResult> {
  const config = getFirebaseServiceAccountConfig();

  if (!config) {
    return { ok: false, reason: 'native_push_not_configured' };
  }

  const controller = new AbortController();
  let responseDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const accessToken = await getFirebaseAccessToken(config);
    // Keep this signal active while parsing a rejection body as well as while
    // waiting for headers; token cleanup must not hang on a stalled provider.
    responseDeadline = setTimeout(() => controller.abort(), getNativePushTimeoutMs());
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
        config.projectId,
      )}/messages:send`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: {
              title: message.title,
              body: message.body,
            },
            data: {
              url: message.url ?? '/',
              tag: message.tag ?? '',
            },
            android: {
              notification: {
                tag: message.tag,
                click_action: 'OPEN_APP',
              },
            },
            apns: {
              payload: {
                aps: {
                  sound: 'default',
                  category: message.tag,
                },
              },
            },
          },
        }),
      },
    );

    if (response.ok) {
      return { ok: true };
    }

    const failure = await response.json().catch(() => null) as {
      error?: { details?: Array<{ '@type'?: string; errorCode?: string; fieldViolations?: Array<{ field?: string }> }> };
    } | null;
    const details = Array.isArray(failure?.error?.details) ? failure.error.details : [];
    const unregistered = details.some(detail => detail?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && detail.errorCode === 'UNREGISTERED');
    const invalidToken = details.some(detail => detail?.['@type'] === 'type.googleapis.com/google.rpc.BadRequest' &&
      Array.isArray(detail.fieldViolations) && detail.fieldViolations.some(violation => violation?.field === 'message.token'));

    return {
      ok: false,
      status: response.status,
      reason: `native_push_failed_${response.status}`,
      // INVALID_ARGUMENT also covers payload/configuration errors. Do not
      // delete a valid device token merely because its message was rejected.
      expired: (response.status === 404 && unregistered) || (response.status === 400 && invalidToken),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'UnknownError',
    };
  } finally {
    clearTimeout(responseDeadline);
  }
}

function createApnsJwt(config: ApnsConfig) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: config.keyId };
  const claims = {
    iss: config.teamId,
    iat: now,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(
    JSON.stringify(claims),
  )}`;
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign({
      key: config.privateKey,
      dsaEncoding: 'ieee-p1363',
    });

  return `${unsigned}.${base64UrlEncode(signature)}`;
}

function isExpiredApnsReason(reason: string | undefined) {
  return (
    reason === 'BadDeviceToken' ||
    reason === 'DeviceTokenNotForTopic' ||
    reason === 'Unregistered'
  );
}

async function sendApnsMessage(
  token: string,
  message: NativePushMessage,
): Promise<NativePushSendResult> {
  const config = getApnsConfig();

  if (!config) {
    return { ok: false, reason: 'apns_not_configured' };
  }

  try {
    const host = config.useSandbox
      ? 'https://api.sandbox.push.apple.com'
      : 'https://api.push.apple.com';
    const response = await postApnsHttp2({
      host,
      token,
      authorization: `bearer ${createApnsJwt(config)}`,
      topic: config.bundleId,
      payload: {
        aps: {
          alert: {
            title: message.title,
            body: message.body,
          },
          sound: 'default',
          category: message.tag,
        },
        url: message.url ?? '/',
        tag: message.tag ?? '',
      },
      timeoutMs: getNativePushTimeoutMs(),
    });

    if (response.status === 200) {
      return { ok: true };
    }

    return {
      ok: false,
      status: response.status,
      reason: response.reason ? `apns_${response.reason}` : `apns_failed_${response.status}`,
      expired: response.status === 410 || isExpiredApnsReason(response.reason),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'UnknownError',
    };
  }
}

export async function sendNativePushToUser(
  userId: string,
  message: NativePushMessage,
) {
  if (!isNativePushConfigured()) {
    return;
  }

  const tokens = await listActiveMobilePushTokensForUser(userId);

  await Promise.all(
    tokens.map(async (record) => {
      const result =
        record.platform === 'ios'
          ? await sendApnsMessage(record.token, message)
          : await sendFirebaseMessage(record.token, message);

      if (!result.ok && result.expired) {
        await deactivateMobilePushToken(record.token, userId);
      }
    }),
  );
}
