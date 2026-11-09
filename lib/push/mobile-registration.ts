import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function sign(payload: string) {
  const secret = process.env.AUTH_SECRET?.trim() ||
    (process.env.NODE_ENV !== 'production' ? 'development-only-smartstore-auth-secret' : '');
  if (!secret) throw new Error('AUTH_SECRET is required in production.');
  return createHmac('sha256', secret).update(`mobile-push-removal:v1:${payload}`).digest('base64url');
}

/** This capability can only deactivate one specific registration, including
 * after its login expires. It grants no session, reads, or registration rights. */
export function createMobilePushRemovalToken(userId: string, token: string, registrationKey: string) {
  const payload = Buffer.from(JSON.stringify({ userId, registrationKey,
    tokenHash: createHash('sha256').update(token).digest('hex') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function parseMobilePushRemovalToken(value: string, token: string) {
  if (value.length > 2048) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload)), received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claim.userId !== 'string' || !claim.userId ||
      typeof claim.registrationKey !== 'string' || !/^[a-f0-9-]{36}$/.test(claim.registrationKey) ||
      claim.tokenHash !== createHash('sha256').update(token).digest('hex')) return null;
    return { userId: claim.userId as string, registrationKey: claim.registrationKey as string };
  } catch { return null; }
}
