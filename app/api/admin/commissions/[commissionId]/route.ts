import { z } from 'zod';

import { setCommissionStatusForAdmin } from '@/agent/marketplace/repository';
import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

const commissionStatusSchema = z.object({
  status: z.enum(['due', 'paid', 'waived', 'disputed']),
});

type RouteContext = {
  params: Promise<{
    commissionId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
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
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
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

  return Response.json({ status: 'deleted' });
}
