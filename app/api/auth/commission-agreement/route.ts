import {
  commissionPolicyVersion,
  createCommissionAgreementToken,
  createCommissionAgreementCookie,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
} from '@/lib/auth/session';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';

const maxCommissionAgreementRequestBytes = 1024;

export async function POST(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'commission_agreement',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxCommissionAgreementRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('accepted' in payload) ||
    payload.accepted !== true
  ) {
    return Response.json(
      { error: 'commission_agreement_required' },
      { status: 400 },
    );
  }

  return Response.json(
    {
      accepted: true,
      agreementToken: createCommissionAgreementToken(),
      commissionRatePercent: 1,
      platformAgreementVersion,
      termsVersion,
      privacyPolicyVersion,
      listingPolicyVersion,
      commissionPolicyVersion,
    },
    {
      headers: {
        'Set-Cookie': createCommissionAgreementCookie(),
      },
    },
  );
}
