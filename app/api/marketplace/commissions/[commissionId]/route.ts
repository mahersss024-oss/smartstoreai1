import { z } from 'zod';

import { updateCommissionSaleAmountForSeller } from '@/agent/marketplace/repository';
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
  const result = await updateCommissionSaleAmountForSeller(
    commissionId,
    session.user.id,
    parsed.data.productValue,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'commission_not_found' }, { status: 404 });
  }

  if (result.status === 'locked') {
    return Response.json(
      { error: 'commission_locked', commission: result.commission },
      { status: 409 },
    );
  }

  return Response.json(result);
}
