import { listSellerCommissions } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to view commissions.',
      },
      { status: 401 },
    );
  }

  return Response.json({
    commissions: await listSellerCommissions(session.user.id),
  });
}
