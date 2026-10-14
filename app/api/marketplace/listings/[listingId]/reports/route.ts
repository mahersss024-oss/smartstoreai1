import { z } from 'zod';

import { hasReportedListing, reportListing } from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';

const maxReportRequestBytes = 8 * 1024;

const reportSchema = z.object({
  reason: z.enum([
    'prohibited_item',
    'fraud',
    'counterfeit',
    'wrong_category',
    'misleading_images',
    'abusive_content',
    'other',
  ]),
  details: z.string().trim().max(1000).optional(),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401 });
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'report_state', actorId: session.user.id, maxRequests: 120, windowMs: 60_000,
  });
  if (rateLimitResponse) return rateLimitResponse;
  const { listingId } = await context.params;
  return Response.json({ isReported: await hasReportedListing(listingId, session.user) }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to report a listing.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'report',
    actorId: session.user.id,
    maxRequests: 8,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxReportRequestBytes,
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

  const parsed = reportSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { listingId } = await context.params;
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'report_create',
    actorKey: `${session.user.id}:${listingId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await reportListing(
    listingId,
    session.user,
    parsed.data.reason,
    parsed.data.details,
  );

  if (result.status === 'not_found') {
    const responseBody = { error: 'listing_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  return idempotency
    ? idempotency.complete(result, 201)
    : Response.json(result, { status: 201 });
}
