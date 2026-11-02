import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { createAppleClientSecret } from './apple';
import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

export type AppleAuthorizationGrant = { clientId: string; subject: string; token: string; tokenType: 'refresh_token' | 'access_token' };
type StoredGrant = Omit<AppleAuthorizationGrant, 'token'> & { version: 1; nonce: string; tag: string; ciphertext: string };
export function hasAppleAuthorization(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}
function key() {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error('apple_token_storage_unavailable');
  return createHmac('sha256', secret).update('souq-hamad.apple-authorization.v1').digest();
}
function aad(userId: string, grant: Pick<AppleAuthorizationGrant, 'clientId' | 'subject' | 'tokenType'>) {
  return Buffer.from(JSON.stringify([userId, grant.clientId, grant.subject, grant.tokenType]));
}
export function appleGrantFromTokenResponse(value: unknown, clientId: string, subject: string): AppleAuthorizationGrant | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as { refresh_token?: unknown; access_token?: unknown };
  const tokenType = typeof payload.refresh_token === 'string' && payload.refresh_token ? 'refresh_token' : 'access_token';
  const token = tokenType === 'refresh_token' ? payload.refresh_token : payload.access_token;
  if (!clientId || clientId.length > 255 || !subject || subject.length > 255 ||
    typeof token !== 'string' || !token.trim() || Buffer.byteLength(token, 'utf8') > 8192) return undefined;
  return { clientId, subject, token, tokenType };
}
function storedGrants(value: unknown): StoredGrant[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8 || value.some(grant => !grant || grant.version !== 1 ||
    typeof grant.clientId !== 'string' || !grant.clientId || grant.clientId.length > 255 ||
    typeof grant.subject !== 'string' || !grant.subject || grant.subject.length > 255 ||
    !['refresh_token', 'access_token'].includes(grant.tokenType) ||
    !['nonce', 'tag', 'ciphertext'].every(field => typeof grant[field] === 'string' && /^[A-Za-z0-9_-]+$/.test(grant[field])) ||
    grant.nonce.length !== 16 || grant.tag.length !== 22 || grant.ciphertext.length > 10923)) throw new Error('apple_token_storage_invalid');
  return value;
}
export function mergeAppleAuthorization(userId: string, previous: unknown, grant: AppleAuthorizationGrant): Prisma.InputJsonValue {
  if (!userId || !appleGrantFromTokenResponse({ [grant.tokenType]: grant.token }, grant.clientId, grant.subject)) throw new Error('apple_token_storage_invalid');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(aad(userId, grant));
  const ciphertext = Buffer.concat([cipher.update(grant.token, 'utf8'), cipher.final()]);
  const stored: StoredGrant = { version: 1, clientId: grant.clientId, subject: grant.subject, tokenType: grant.tokenType,
    nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') };
  const grants = storedGrants(previous).filter(value => value.clientId !== grant.clientId || value.subject !== grant.subject);
  if (grants.length >= 8) throw new Error('apple_token_storage_limit');
  return [...grants, stored];
}
export async function revokeAppleAuthorizations(userId: string, value: unknown) {
  for (const grant of storedGrants(value)) {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(grant.nonce, 'base64url'));
    decipher.setAuthTag(Buffer.from(grant.tag, 'base64url')); decipher.setAAD(aad(userId, grant));
    const token = Buffer.concat([decipher.update(Buffer.from(grant.ciphertext, 'base64url')), decipher.final()]).toString('utf8');
    const response = await fetchWithTimeout('https://appleid.apple.com/auth/revoke', {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: grant.clientId, client_secret: createAppleClientSecret(undefined, grant.clientId), token, token_type_hint: grant.tokenType }),
    }, 10_000);
    await response.body?.cancel();
    if (response.status !== 200) throw new Error('apple_revocation_unavailable');
  }
}
