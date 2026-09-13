import { createCommissionAgreementCookie } from '@/lib/auth/session';
import { rejectOversizedRequest } from '@/lib/api/request-size';

const maxCommissionAgreementRequestBytes = 1024;

export async function POST(request: Request) {
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
      commissionRatePercent: 1,
    },
    {
      headers: {
        'Set-Cookie': createCommissionAgreementCookie(),
      },
    },
  );
}
