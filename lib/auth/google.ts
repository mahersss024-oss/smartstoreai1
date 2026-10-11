import { createPublicKey, createVerify } from 'node:crypto';
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { normalizeAuthEmail } from '@/lib/auth/identity';
import {
  commissionAgreementVersion,
  commissionPolicyVersion,
  getCommissionAgreement,
  getConfiguredRoleForEmail,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
  type AuthSessionUser,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

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

function shouldPersistUserRegistration() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export async function persistGoogleUserRegistration(
  request: Request,
  user: AuthSessionUser,
) {
  if (!shouldPersistUserRegistration()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_USER_REGISTRATION_REQUIRED');
    }

    return user;
  }

  const commissionAgreement = getCommissionAgreement(request);
  const registrationData = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    commissionAgreementVersion: commissionAgreement
      ? commissionAgreementVersion
      : undefined,
    commissionAgreementAccepted: commissionAgreement
      ? new Date(commissionAgreement.acceptedAt * 1000)
      : undefined,
    platformAgreementVersion: commissionAgreement
      ? platformAgreementVersion
      : undefined,
    platformAgreementAccepted: commissionAgreement
      ? new Date(commissionAgreement.acceptedAt * 1000)
      : undefined,
    termsVersion: commissionAgreement ? termsVersion : undefined,
    privacyPolicyVersion: commissionAgreement ? privacyPolicyVersion : undefined,
    listingPolicyVersion: commissionAgreement ? listingPolicyVersion : undefined,
    commissionPolicyVersion: commissionAgreement
      ? commissionPolicyVersion
      : undefined,
  };

  const existingUserByEmail = await prisma.user.findUnique({
    where: { email: user.email },
  });

  if (existingUserByEmail?.deletedAt) {
    throw new Error('ACCOUNT_SOFT_DELETED');
  }

  if (existingUserByEmail && existingUserByEmail.id !== user.id) {
    const updatedUser = await prisma.user.update({
      where: { email: user.email },
      data: {
        ...registrationData,
        name: existingUserByEmail.name ?? user.name,
        picture: existingUserByEmail.picture ?? user.picture,
      },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name ?? undefined,
      picture: updatedUser.picture ?? undefined,
      role: updatedUser.role,
    };
  }

  const updatedUser = await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      role: getConfiguredRoleForEmail(user.email),
      ...registrationData,
    },
    update: {
      ...registrationData,
      name: existingUserByEmail?.name ?? user.name,
      picture: existingUserByEmail?.picture ?? user.picture,
    },
  });

  return {
    id: updatedUser.id,
    email: updatedUser.email,
    name: updatedUser.name ?? undefined,
    picture: updatedUser.picture ?? undefined,
    role: updatedUser.role,
  };
}
