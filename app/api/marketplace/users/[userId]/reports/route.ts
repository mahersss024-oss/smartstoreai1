import { z } from 'zod';

import { reportUserDirect } from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

const reportSchema = z.object({
  reason: z.string().trim().min(2).max(120),
  details: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const { userId: rawUserId } = await context.params;
  const userId = decodeURIComponent(rawUserId);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'direct_user_report',
    actorId: session.user.id,
    maxRequests: 20,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const payload = await request.json().catch(() => null);
  const parsed = reportSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json({ error: 'invalid_report' }, { status: 400 });
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'direct_user_report_create',
    actorKey: `${session.user.id}:${userId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await reportUserDirect(userId, session.user, parsed.data);

  if (result.status === 'not_found') {
    const responseBody = { error: 'user_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'self_report_blocked') {
    const responseBody = { error: 'self_report_blocked' };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'already_reported') {
    const responseBody = {
      error: 'already_reported',
      report: result.report,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  return idempotency
    ? idempotency.complete(result, 201)
    : Response.json(result, { status: 201 });
}
