import { z } from 'zod';

import {
  getSellerRatingState,
  rateSeller,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

const ratingSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = decodeURIComponent(rawUserId);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'seller_rating_state',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const result = await getSellerRatingState(userId, session.user);

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
    namespace: 'seller_rating',
    actorId: session.user.id,
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const payload = await request.json().catch(() => null);
  const parsed = ratingSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json({ error: 'invalid_rating' }, { status: 400 });
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'seller_rating_upsert',
    actorKey: `${session.user.id}:${userId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await rateSeller(userId, session.user, parsed.data);

  if (result.status === 'not_found') {
    const responseBody = { error: 'user_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'self_rating_blocked') {
    const responseBody = { error: 'self_rating_blocked' };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'invalid_rating') {
    const responseBody = { error: 'invalid_rating' };

    return idempotency
      ? idempotency.complete(responseBody, 400)
      : Response.json(responseBody, { status: 400 });
  }

  return idempotency ? idempotency.complete(result) : Response.json(result);
}
