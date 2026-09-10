import { z } from 'zod';

import { updateCommissionSaleAmountForSeller } from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

const updateCommissionSchema = z.object({
  productValue: z.number().positive(),
});

type RouteContext = {
  params: Promise<{
    commissionId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to update commissions.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'commission_update',
    actorId: session.user.id,
    maxRequests: 20,
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

  const parsed = updateCommissionSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { commissionId } = await context.params;
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'commission_update',
    actorKey: `${session.user.id}:${commissionId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await updateCommissionSaleAmountForSeller(
    commissionId,
    session.user.id,
    parsed.data.productValue,
  );

  if (result.status === 'not_found') {
    const responseBody = { error: 'commission_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'locked') {
    const responseBody = {
      error: 'commission_locked',
      commission: result.commission,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  return idempotency ? idempotency.complete(result) : Response.json(result);
}
