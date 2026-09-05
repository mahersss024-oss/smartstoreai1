import { listSellerListings } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

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

  return Response.json({
    listings: await listSellerListings(session.user.id),
  });
}
