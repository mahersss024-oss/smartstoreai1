import type { AdminAuditAction, Prisma } from '@prisma/client';

export async function createAdminAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    adminId: string | null;
    action: AdminAuditAction;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.adminId) return;
  await tx.adminAuditLog.create({ data: {
    adminId: input.adminId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
  } });
}
