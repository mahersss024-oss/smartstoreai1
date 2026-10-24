import {
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
} from 'node:crypto';
import type { JsonWebKey as CryptoJsonWebKey } from 'node:crypto';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

const appleIssuer = 'https://appleid.apple.com';
const appleKeysUrl = 'https://appleid.apple.com/auth/keys';
const clientSecretMaxAgeSeconds = 60 * 60 * 24 * 180;

type AppleJwtHeader = {
  alg?: string;
  kid?: string;
};

type AppleJwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  nonce?: string;
};

export type AppleIdentity = {
  sub: string;
  email: string;
};

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

function parseBase64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

function readAsn1Length(bytes: Buffer, offset: number) {
  const first = bytes[offset];

  if (first < 0x80) {
    return { length: first, offset: offset + 1 };
  }

  const byteCount = first & 0x7f;
  let length = 0;

  for (let index = 0; index < byteCount; index += 1) {
    length = (length << 8) + bytes[offset + 1 + index];
  }

  return { length, offset: offset + 1 + byteCount };
}

function leftPadSignaturePart(value: Buffer, byteLength: number) {
  const trimmed = value.length > byteLength ? value.subarray(value.length - byteLength) : value;

  if (trimmed.length === byteLength) {
    return trimmed;
  }

  return Buffer.concat([Buffer.alloc(byteLength - trimmed.length), trimmed]);
}

function derToJoseSignature(signature: Buffer, byteLength: number) {
  let offset = 0;

  if (signature[offset] !== 0x30) {
    throw new Error('Invalid ECDSA DER signature.');
  }

  offset += 1;
  const sequenceLength = readAsn1Length(signature, offset);
  offset = sequenceLength.offset;

  if (signature[offset] !== 0x02) {
    throw new Error('Invalid ECDSA signature r marker.');
  }

  offset += 1;
  const rLength = readAsn1Length(signature, offset);
  const r = signature.subarray(rLength.offset, rLength.offset + rLength.length);
  offset = rLength.offset + rLength.length;

  if (signature[offset] !== 0x02) {
    throw new Error('Invalid ECDSA signature s marker.');
  }

  offset += 1;
  const sLength = readAsn1Length(signature, offset);
  const s = signature.subarray(sLength.offset, sLength.offset + sLength.length);

  return Buffer.concat([
    leftPadSignaturePart(r, byteLength),
    leftPadSignaturePart(s, byteLength),
  ]).toString('base64url');
}

function getRequiredAppleConfig(clientId = process.env.APPLE_CLIENT_ID?.trim()) {
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const keyId = process.env.APPLE_KEY_ID?.trim();
  const privateKey = process.env.APPLE_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');

  if (!clientId || !teamId || !keyId || !privateKey) {
    return null;
  }

  return { clientId, teamId, keyId, privateKey };
}

export function isAppleAuthConfigured(clientId?: string) {
  return Boolean(getRequiredAppleConfig(clientId));
}

export function getAppleClientId() {
  return process.env.APPLE_CLIENT_ID?.trim() ?? '';
}

export function createAppleClientSecret(now = Math.floor(Date.now() / 1000), clientId?: string) {
  const config = getRequiredAppleConfig(clientId);

  if (!config) {
    throw new Error('APPLE_AUTH_NOT_CONFIGURED');
  }

  const header = {
    alg: 'ES256',
    kid: config.keyId,
    typ: 'JWT',
  };
  const payload = {
    iss: config.teamId,
    iat: now,
    exp: now + clientSecretMaxAgeSeconds,
    aud: appleIssuer,
    sub: clientId ?? config.clientId,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signer = createSign('SHA256');

  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(createPrivateKey(config.privateKey));

  return `${signingInput}.${derToJoseSignature(signature, 32)}`;
}

function isAudienceValid(audience: string | string[] | undefined, clientId: string) {
  return Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;
}

export async function verifyAppleIdentityToken(
  idToken: string,
  clientId = getAppleClientId(),
  expectedNonce?: string,
): Promise<AppleIdentity | null> {
  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');

  if (!encodedHeader || !encodedPayload || !encodedSignature || !clientId) {
    return null;
  }

  const header = parseBase64UrlJson<AppleJwtHeader>(encodedHeader);
  const payload = parseBase64UrlJson<AppleJwtPayload>(encodedPayload);

  if (
    !header?.kid ||
    header.alg !== 'RS256' ||
    !payload?.sub ||
    !payload.email ||
    payload.iss !== appleIssuer ||
    !isAudienceValid(payload.aud, clientId) ||
    typeof payload.exp !== 'number' ||
    payload.exp <= Math.floor(Date.now() / 1000) ||
    payload.email_verified === false ||
    payload.email_verified === 'false' ||
    (expectedNonce !== undefined && payload.nonce !== expectedNonce)
  ) {
    return null;
  }

  const keysResponse = await fetchWithTimeout(appleKeysUrl, { cache: 'no-store' });

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
    email: payload.email,
  };
}
