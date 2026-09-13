import { z } from 'zod';

import { createConversationForListing } from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';

const maxCreateConversationRequestBytes = 4 * 1024;

const createConversationSchema = z.object({
  listingId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to message a seller.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'conversation_create',
    actorId: session.user.id,
    maxRequests: 20,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxCreateConversationRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createConversationSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'conversation_create',
    actorKey: `${session.user.id}:${parsed.data.listingId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await createConversationForListing(
    parsed.data.listingId,
    session.user,
  );

  if (result.status === 'not_found') {
    const responseBody = { error: 'listing_not_found_or_unavailable' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'self_contact_blocked') {
    const responseBody = { error: 'self_contact_blocked' };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  const responseStatus = result.status === 'created' ? 201 : 200;

  return idempotency
    ? idempotency.complete(result, responseStatus)
    : Response.json(result, { status: responseStatus });
}
