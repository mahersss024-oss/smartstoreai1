import { getListing, getPublicSellerProfile } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ listingId: string }> };

/** Matches the public call option on published listing details. */
export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);
  const limited = await enforceApiRateLimit(request, {
    namespace: 'listing_contact', actorId: session?.user.id, maxRequests: 60, windowMs: 60_000,
  });
  if (limited) return limited;
  const { listingId } = await context.params;
  const listing = await getListing(listingId);
  if (!listing || listing.status !== 'published') {
    return Response.json({ error: 'listing_not_found' }, { status: 404, headers: noStoreHeaders });
  }
  if (session?.user.id === listing.sellerId) {
    return Response.json({ error: 'self_contact_blocked' }, { status: 409, headers: noStoreHeaders });
  }
  const seller = await getPublicSellerProfile(listing.sellerId);
  return Response.json({ phoneNumber: seller?.phoneNumber?.trim() || null }, { headers: noStoreHeaders });
}
