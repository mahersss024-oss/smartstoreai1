import { toggleFavoriteListing } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to save favorites.',
      },
      { status: 401 },
    );
  }

  const { listingId } = await context.params;
  const result = await toggleFavoriteListing(listingId, session.user);

  if (result.status === 'not_found') {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  if (result.status === 'self_favorite_blocked') {
    return Response.json({ error: 'self_favorite_blocked' }, { status: 409 });
  }

  return Response.json(result);
}
