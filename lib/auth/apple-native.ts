import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { createAppleClientSecret, isAppleAuthConfigured, verifyAppleIdentityToken } from '@/lib/auth/apple';
import { prisma } from '@/lib/db/prisma';

const challengeLifetimeSeconds = 5 * 60;
const usedDevelopmentChallenges = new Map<string, number>();

type AppleNativeChallenge = {
  id: string;
  nonce: string;
  codeChallenge: string;
  clientId: string;
  agreementDigest: string;
  expiresAt: number;
};

export function getAppleNativeClientId() {
  return process.env.APPLE_NATIVE_CLIENT_ID?.trim() ?? '';
}

export function isAppleNativeAuthConfigured() {
  return Boolean(getAppleNativeClientId() && isAppleAuthConfigured(getAppleNativeClientId()));
}

function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (value) return value;
  if (process.env.NODE_ENV !== 'production') return 'development-only-smartstore-auth-secret';
  throw new Error('AUTH_SECRET is required in production.');
}

function sign(payload: string) {
  return createHmac('sha256', secret()).update(`apple-native-challenge:${payload}`).digest('base64url');
}

export function appleNativeDigest(value: string) {
  return createHash('sha256').update(value).digest('base64url');
}

export function createAppleNativeChallenge(codeChallenge: string, agreementToken: string) {
  const challenge: AppleNativeChallenge = {
    id: randomBytes(24).toString('base64url'),
    nonce: randomBytes(32).toString('base64url'),
    codeChallenge,
    clientId: getAppleNativeClientId(),
    agreementDigest: appleNativeDigest(agreementToken),
    expiresAt: Math.floor(Date.now() / 1000) + challengeLifetimeSeconds,
  };
  const payload = Buffer.from(JSON.stringify(challenge)).toString('base64url');
  return { challengeToken: `${payload}.${sign(payload)}`, nonce: challenge.nonce, clientId: challenge.clientId, expiresAt: challenge.expiresAt };
}

export function parseAppleNativeChallenge(token: string, codeVerifier: string, agreementToken: string): AppleNativeChallenge | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const challenge = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AppleNativeChallenge;
    if (!challenge.id || !challenge.nonce || challenge.clientId !== getAppleNativeClientId() ||
      challenge.codeChallenge !== appleNativeDigest(codeVerifier) ||
      challenge.agreementDigest !== appleNativeDigest(agreementToken) ||
      typeof challenge.expiresAt !== 'number' || challenge.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return challenge;
  } catch {
    return null;
  }
}

/** The existing unique API-key table provides cross-instance single use without a schema change. */
export async function consumeAppleNativeChallenge(challenge: AppleNativeChallenge) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE === 'database') {
    try {
      await prisma.apiIdempotencyKey.create({ data: {
        namespace: 'apple_native_challenge', actorKey: challenge.clientId, key: challenge.id,
        status: 'completed', response: { used: true }, statusCode: 204,
      } });
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return false;
      throw error;
    }
  }
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_NATIVE_AUTH_REQUIRED');
  const now = Math.floor(Date.now() / 1000);
  for (const [id, expiresAt] of usedDevelopmentChallenges) if (expiresAt <= now) usedDevelopmentChallenges.delete(id);
  if (usedDevelopmentChallenges.has(challenge.id)) return false;
  usedDevelopmentChallenges.set(challenge.id, challenge.expiresAt);
  return true;
}

export async function exchangeAppleNativeCode(code: string, challenge: AppleNativeChallenge) {
  const response = await fetchWithTimeout('https://appleid.apple.com/auth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: challenge.clientId,
      client_secret: createAppleClientSecret(undefined, challenge.clientId),
    }),
  });
  const payload = await response.json().catch(() => null) as { id_token?: unknown; error?: unknown } | null;
  if (!response.ok || payload?.error || typeof payload?.id_token !== 'string') return null;
  return verifyAppleIdentityToken(payload.id_token, challenge.clientId, challenge.nonce);
}
