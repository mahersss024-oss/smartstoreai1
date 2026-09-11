import { createSign, createPrivateKey } from 'node:crypto';

// Minimal VAPID (RFC 8292) support implemented with node:crypto only, so push
// notifications work without adding a native/heavy dependency.
//
// Required environment variables:
//   SMARTSTORE_VAPID_PUBLIC_KEY   base64url-encoded uncompressed P-256 point
//   SMARTSTORE_VAPID_PRIVATE_KEY  base64url-encoded P-256 private scalar
//   SMARTSTORE_VAPID_SUBJECT      mailto: or https: contact (audience subject)

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.SMARTSTORE_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.SMARTSTORE_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.SMARTSTORE_VAPID_SUBJECT?.trim();

  if (!publicKey || !privateKey || !subject) {
    return null;
  }

  return { publicKey, privateKey, subject };
}

export function isPushConfigured() {
  return getVapidConfig() !== null;
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

/**
 * Builds a signed VAPID JWT (ES256) for the given push service audience.
 * @param audience origin of the push endpoint, e.g. https://fcm.googleapis.com
 */
export function createVapidJwt(audience: string, config: VapidConfig) {
  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      aud: audience,
      exp: now + 12 * 60 * 60,
      sub: config.subject,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign('SHA256');
  signer.update(signingInput);
  signer.end();

  // VAPID private keys are raw P-256 scalars; node needs a JWK for ES256.
  const keyObject = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: config.privateKey,
      x: jwkXFromPublicKey(config.publicKey),
      y: jwkYFromPublicKey(config.publicKey),
    },
    format: 'jwk',
  });
  const signature = signer.sign({ key: keyObject, dsaEncoding: 'ieee-p1363' });

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function decodePublicKey(publicKey: string) {
  const bytes = Buffer.from(publicKey, 'base64url');

  // Uncompressed P-256 point: 0x04 || X(32) || Y(32)
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    return null;
  }

  return {
    x: bytes.subarray(1, 33),
    y: bytes.subarray(33, 65),
  };
}

function jwkXFromPublicKey(publicKey: string) {
  return base64UrlEncode(decodePublicKey(publicKey)?.x ?? Buffer.alloc(32));
}

function jwkYFromPublicKey(publicKey: string) {
  return base64UrlEncode(decodePublicKey(publicKey)?.y ?? Buffer.alloc(32));
}

export function buildAuthorizationHeader(
  endpoint: string,
  config: VapidConfig,
) {
  const audience = new URL(endpoint).origin;
  const jwt = createVapidJwt(audience, config);

  return `vapid t=${jwt}, k=${config.publicKey}`;
}
