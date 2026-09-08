import { getCommissionPaymentMethods } from '@/agent/marketplace/commission-payment-methods';
import { getAuthSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to view commission payment methods.',
      },
      { status: 401 },
    );
  }

  return Response.json({
    paymentMethods: getCommissionPaymentMethods(),
  });
}
