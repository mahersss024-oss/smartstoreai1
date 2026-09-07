import { listSellerListingsPage } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to view seller listings.',
      },
      { status: 401 },
    );
  }

  const listingsPage = await listSellerListingsPage(
    session.user.id,
    parsePaginationFromRequest(request, { defaultLimit: 24, maxLimit: 48 }),
  );

  return Response.json({
    listings: listingsPage.items,
    pagination: listingsPage.pagination,
  });
}
