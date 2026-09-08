import { z } from 'zod';

import {
  deleteListingImageForSeller,
  setPrimaryListingImageForSeller,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

const imageActionSchema = z.object({
  action: z.enum(['set_primary']),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
    imageId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to update listing images.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'listing_image_update',
    actorId: session.user.id,
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const action = imageActionSchema.safeParse(payload);

  if (!action.success) {
    return Response.json(
      { error: 'invalid_request', details: action.error.flatten() },
      { status: 400 },
    );
  }

  const { listingId, imageId } = await context.params;
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: `listing_image:${action.data.action}`,
    actorKey: `${session.user.id}:${listingId}:${imageId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const listing = await setPrimaryListingImageForSeller(
    listingId,
    session.user.id,
    imageId,
  );

  if (!listing) {
    const responseBody = { error: 'listing_or_image_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  const responseBody = { listing };

  return idempotency
    ? idempotency.complete(responseBody)
    : Response.json(responseBody);
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to delete listing images.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'listing_image_delete',
    actorId: session.user.id,
    maxRequests: 20,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { listingId, imageId } = await context.params;
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'listing_image:delete',
    actorKey: `${session.user.id}:${listingId}:${imageId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const listing = await deleteListingImageForSeller(
    listingId,
    session.user.id,
    imageId,
  );

  if (!listing) {
    const responseBody = { error: 'listing_or_image_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  const responseBody = { listing };

  return idempotency
    ? idempotency.complete(responseBody)
    : Response.json(responseBody);
}
