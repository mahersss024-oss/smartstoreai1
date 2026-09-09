import {
  getAuthSession,
  getCommissionAgreement,
  isAdminSession,
} from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const commissionAgreement = getCommissionAgreement(request);

  return Response.json({
    authenticated: Boolean(session),
    user: session
      ? {
          ...session.user,
          role: isAdminSession(session) ? 'admin' : session.user.role ?? 'user',
        }
      : null,
    commissionAgreementAccepted: Boolean(commissionAgreement),
    commissionAgreement,
  });
}
