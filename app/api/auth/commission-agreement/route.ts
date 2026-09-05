import { createCommissionAgreementCookie } from '@/lib/auth/session';

export async function POST(request: Request) {
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
