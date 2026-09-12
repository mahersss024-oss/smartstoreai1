import { listUserFavoritesPage } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to view favorites.',
      },
      { status: 401 },
    );
  }

  const favoritesPage = await listUserFavoritesPage(
    session.user.id,
    parsePaginationFromRequest(request, { defaultLimit: 24, maxLimit: 48 }),
  );

  return Response.json({
    favorites: favoritesPage.items,
    pagination: favoritesPage.pagination,
  }, {
    headers: noStoreHeaders,
  });
}
