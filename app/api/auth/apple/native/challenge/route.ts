import { z } from 'zod';

import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { createAppleNativeChallenge, isAppleNativeAuthConfigured } from '@/lib/auth/apple-native';
import { getCommissionAgreement, getCookieValue } from '@/lib/auth/session';

const schema = z.object({ codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });

export async function POST(request: Request) {
  const oversized = rejectOversizedRequest(request, 2048);
  if (oversized) return oversized;
  const limited = await enforceApiRateLimit(request, { namespace: 'apple_native_challenge', maxRequests: 30, windowMs: 60_000 });
  if (limited) return limited;
  if (!getCommissionAgreement(request)) return Response.json({ error: 'commission_agreement_required' }, { status: 409, headers: noStoreHeaders });
  if (!isAppleNativeAuthConfigured()) return Response.json({ error: 'apple_native_unavailable' }, { status: 503, headers: noStoreHeaders });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers: noStoreHeaders });
  const agreementToken = getCookieValue(request, 'smartstore_commission_agreement') ?? request.headers.get('x-souq-hamad-commission-agreement')!;
  return Response.json(createAppleNativeChallenge(parsed.data.codeChallenge, agreementToken), { headers: noStoreHeaders });
}
