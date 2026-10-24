import { z } from 'zod';

import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { verifyAppleIdentityToken } from '@/lib/auth/apple';
import { consumeAppleNativeChallenge, exchangeAppleNativeCode, isAppleNativeAuthConfigured, parseAppleNativeChallenge } from '@/lib/auth/apple-native';
import { normalizeAuthEmail } from '@/lib/auth/identity';
import { persistUserRegistration } from '@/lib/auth/registration';
import { createSignedSession, getCommissionAgreement, getCookieValue, parseSignedSession } from '@/lib/auth/session';

const schema = z.object({
  challengeToken: z.string().min(1).max(4096),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  identityToken: z.string().min(1).max(12 * 1024),
  authorizationCode: z.string().min(1).max(4096),
  fullName: z.string().trim().min(1).max(80).optional(),
});

export async function POST(request: Request) {
  const oversized = rejectOversizedRequest(request, 24 * 1024);
  if (oversized) return oversized;
  const limited = await enforceApiRateLimit(request, { namespace: 'apple_native_auth', maxRequests: 30, windowMs: 60_000 });
  if (limited) return limited;
  if (!getCommissionAgreement(request)) return Response.json({ error: 'commission_agreement_required' }, { status: 409, headers: noStoreHeaders });
  if (!isAppleNativeAuthConfigured()) return Response.json({ error: 'apple_native_unavailable' }, { status: 503, headers: noStoreHeaders });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers: noStoreHeaders });
  const agreementToken = getCookieValue(request, 'smartstore_commission_agreement') ?? request.headers.get('x-souq-hamad-commission-agreement')!;
  const challenge = parseAppleNativeChallenge(parsed.data.challengeToken, parsed.data.codeVerifier, agreementToken);
  if (!challenge) return Response.json({ error: 'invalid_apple_challenge' }, { status: 401, headers: noStoreHeaders });
  try {
    const identity = await verifyAppleIdentityToken(parsed.data.identityToken, challenge.clientId, challenge.nonce);
    if (!identity) return Response.json({ error: 'invalid_apple_id_token' }, { status: 401, headers: noStoreHeaders });
    if (!(await consumeAppleNativeChallenge(challenge))) return Response.json({ error: 'apple_challenge_used' }, { status: 409, headers: noStoreHeaders });
    const exchanged = await exchangeAppleNativeCode(parsed.data.authorizationCode, challenge);
    if (!exchanged || exchanged.sub !== identity.sub || normalizeAuthEmail(exchanged.email) !== normalizeAuthEmail(identity.email)) {
      return Response.json({ error: 'invalid_apple_authorization_code' }, { status: 401, headers: noStoreHeaders });
    }
    const user = await persistUserRegistration(request, {
      id: `apple:${identity.sub}`, email: normalizeAuthEmail(identity.email), name: parsed.data.fullName,
    });
    const sessionToken = createSignedSession(user);
    return Response.json({ authenticated: true, user, sessionToken, expiresAt: parseSignedSession(sessionToken)!.expiresAt }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof Error && error.message === 'ACCOUNT_SOFT_DELETED') {
      return Response.json({ error: 'account_deactivated' }, { status: 403, headers: noStoreHeaders });
    }
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[apple_native_auth] failed=${errorName}`);
    return Response.json({ error: 'apple_native_auth_failed' }, { status: 502, headers: noStoreHeaders });
  }
}
