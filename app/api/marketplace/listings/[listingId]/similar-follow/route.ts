import {
  getSimilarListingFollowState,
  toggleSimilarListingFollow,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'similar_listing_follow_state',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { listingId: rawListingId } = await context.params;
  const result = await getSimilarListingFollowState(
    decodeURIComponent(rawListingId),
    session.user,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  return Response.json(result);
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'similar_listing_follow',
    actorId: session.user.id,
    maxRequests: 40,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { listingId: rawListingId } = await context.params;
  const listingId = decodeURIComponent(rawListingId);
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'similar_listing_follow_toggle',
    actorKey: `${session.user.id}:${listingId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await toggleSimilarListingFollow(listingId, session.user);

  if (result.status === 'not_found') {
    const responseBody = { error: 'listing_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  return idempotency ? idempotency.complete(result) : Response.json(result);
}
