import { listUserFavorites } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to view favorites.',
      },
      { status: 401 },
    );
  }

  return Response.json({
    favorites: await listUserFavorites(session.user.id),
  });
}
