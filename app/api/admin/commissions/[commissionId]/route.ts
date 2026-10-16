import { z } from 'zod';
import { withEvidenceProtection } from '@/agent/marketplace/evidence';

import { setCommissionStatusForAdmin } from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const maxAdminCommissionStatusRequestBytes = 4 * 1024;

const commissionStatusSchema = z.object({
  status: z.enum(['due', 'paid', 'waived', 'disputed']),
});

type RouteContext = {
  params: Promise<{
    commissionId: string;
  }>;
};

async function enforceAdminCommissionMutationRateLimit(
  request: Request,
  adminId: string,
) {
  return enforceApiRateLimit(request, {
    namespace: 'admin_commission_mutation',
    actorId: adminId,
    maxRequests: 60,
    windowMs: 60_000,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'owner_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminCommissionMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxAdminCommissionStatusRequestBytes,
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

  const parsed = commissionStatusSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { commissionId } = await context.params;
  const result = await setCommissionStatusForAdmin(
    commissionId,
    parsed.data.status,
    session.user,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'commission_not_found' }, { status: 404 });
  }

  return Response.json(result);
}

export async function DELETE(request: Request, context: RouteContext) {
  return withEvidenceProtection(deleteCommission)(request, context);
}

async function deleteCommission(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'owner_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminCommissionMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { commissionId } = await context.params;
  const existing = await prisma.commission.findUnique({
    where: { id: commissionId },
  });

  if (!existing) {
    return Response.json({ error: 'commission_not_found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.commission.delete({ where: { id: commissionId } }),
    prisma.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'update_commission',
        targetType: 'commission',
        targetId: commissionId,
        metadata: { operation: 'delete_commission' },
      },
    }),
  ]);

  try {
    publishRealtimeEvent({
      type: 'commission_updated',
      payload: {
        commissionId: existing.id,
        listingId: existing.listingId,
        sellerId: existing.sellerId,
        status: 'deleted',
        reason: 'deleted',
      },
      visibility: {
        includeAdmins: true,
        userIds: [existing.sellerId],
      },
    });
  } catch {
    // Commission deletion should not fail due to realtime publish.
  }

  return Response.json({ status: 'deleted' });
}
