import {
  getAuthSession,
  getCommissionAgreement,
} from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const commissionAgreement = getCommissionAgreement(request);

  return Response.json({
    authenticated: Boolean(session),
    user: session?.user ?? null,
    commissionAgreementAccepted: Boolean(commissionAgreement),
    commissionAgreement,
  });
}
