import { createSign } from 'node:crypto';

import {
  deactivateMobilePushToken,
  listActiveMobilePushTokensForUser,
} from '@/agent/marketplace/mobile-push-tokens';

import { fetchWithTimeout } from '../api/fetch-timeout';

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

export function isNativePushConfigured() {
  return Boolean(getFirebaseServiceAccountConfig());
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

  try {
    const accessToken = await getFirebaseAccessToken(config);
    const response = await fetchWithTimeout(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
        config.projectId,
      )}/messages:send`,
      {
        method: 'POST',
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
      getNativePushTimeoutMs(),
    );

    if (response.ok) {
      return { ok: true };
    }

    return {
      ok: false,
      status: response.status,
      reason: `native_push_failed_${response.status}`,
      expired: response.status === 404 || response.status === 400,
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
      const result = await sendFirebaseMessage(record.token, message);

      if (!result.ok && result.expired) {
        await deactivateMobilePushToken(record.token, userId);
      }
    }),
  );
}
