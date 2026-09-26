import {
  getSellerFollowState,
  toggleSellerFollow,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = decodeURIComponent(rawUserId);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'seller_follow_state',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const result = await getSellerFollowState(userId, session.user);

  if (result.status === 'not_found') {
    return Response.json({ error: 'user_not_found' }, { status: 404 });
  }

  return Response.json(result);
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = decodeURIComponent(rawUserId);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'seller_follow',
    actorId: session.user.id,
    maxRequests: 40,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'seller_follow_toggle',
    actorKey: `${session.user.id}:${userId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await toggleSellerFollow(userId, session.user);

  if (result.status === 'not_found') {
    const responseBody = { error: 'user_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'self_follow_blocked') {
    const responseBody = { error: 'self_follow_blocked' };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  return idempotency ? idempotency.complete(result) : Response.json(result);
}
