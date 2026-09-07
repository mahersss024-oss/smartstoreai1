import { listSellerCommissionsPage } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

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

  const commissionsPage = await listSellerCommissionsPage(
    session.user.id,
    parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
  );

  return Response.json({
    commissions: commissionsPage.items,
    pagination: commissionsPage.pagination,
  });
}
