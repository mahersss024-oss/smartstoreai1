import { getListing } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ listingId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  const limited = await enforceApiRateLimit(request, {
    namespace: 'owned_listing_detail', actorId: session.user.id, maxRequests: 120, windowMs: 60_000,
  });
  if (limited) return limited;
  const { listingId } = await context.params;
  const listing = await getListing(listingId);
  if (!listing || listing.sellerId !== session.user.id) {
    return Response.json({ error: 'listing_not_found' }, { status: 404, headers: noStoreHeaders });
  }
  return Response.json({ listing }, { headers: noStoreHeaders });
}
