import { createPublicKey, createVerify } from 'node:crypto';
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { normalizeAuthEmail } from '@/lib/auth/identity';
import { persistUserRegistration } from '@/lib/auth/registration';
import type { AuthSessionUser } from '@/lib/auth/session';

const googleIssuer = 'https://accounts.google.com';
const googleIssuerLegacy = 'accounts.google.com';
const googleKeysUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const googleNativeClientIdEnv = 'GOOGLE_NATIVE_CLIENT_ID';

type GoogleJwtHeader = {
  alg?: string;
  kid?: string;
};

type GoogleJwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
};

export type GoogleIdentity = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function getGoogleClientIdCandidates() {
  return [
    process.env[googleNativeClientIdEnv]?.trim(),
    process.env.GOOGLE_CLIENT_ID?.trim(),
  ].filter((value): value is string => Boolean(value));
}

function isAudienceValid(audience: string | string[] | undefined) {
  const candidates = getGoogleClientIdCandidates();

  if (candidates.length === 0) {
    return false;
  }

  return Array.isArray(audience)
    ? audience.some((value) => candidates.includes(value))
    : Boolean(audience && candidates.includes(audience));
}

export function getGoogleNativeClientId() {
  return (
    process.env[googleNativeClientIdEnv]?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    ''
  );
}

export async function verifyGoogleIdentityToken(
  idToken: string,
): Promise<GoogleIdentity | null> {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');

  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    return null;
  }

  const header = parseBase64UrlJson<GoogleJwtHeader>(encodedHeader);
  const payload = parseBase64UrlJson<GoogleJwtPayload>(encodedPayload);

  if (
    !header?.kid ||
    header.alg !== 'RS256' ||
    !payload?.sub ||
    !payload.email ||
    (payload.iss !== googleIssuer && payload.iss !== googleIssuerLegacy) ||
    !isAudienceValid(payload.aud) ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Math.floor(Date.now() / 1000) ||
    payload.email_verified === false ||
    payload.email_verified === 'false'
  ) {
    return null;
  }

  const keysResponse = await fetchWithTimeout(googleKeysUrl, { cache: 'no-store' });

  if (!keysResponse.ok) {
    return null;
  }

  const keysJson = (await keysResponse.json().catch(() => null)) as {
    keys?: Array<CryptoJsonWebKey & { kid?: string; alg?: string }>;
  } | null;
  const jwk = keysJson?.keys?.find(
    (key) => key.kid === header.kid && key.alg === 'RS256',
  );

  if (!jwk) {
    return null;
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const isValid = verifier.verify(
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(encodedSignature, 'base64url'),
  );

  if (!isValid) {
    return null;
  }

  return {
    sub: payload.sub,
    email: normalizeAuthEmail(payload.email),
    name: payload.name,
    picture: payload.picture,
  };
}

export async function persistGoogleUserRegistration(
  request: Request,
  user: AuthSessionUser,
) {
  return persistUserRegistration(request, user);
}
