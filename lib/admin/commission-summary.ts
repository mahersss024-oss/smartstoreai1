import type { PrismaClient } from '@prisma/client';

import { listAdminCommissions } from '@/agent/marketplace/store';
import { prisma } from '@/lib/db/prisma';

/** Totals describe the entire commission ledger, independently of its visible page. */
export async function getAdminCommissionSummary(
  database: Pick<PrismaClient, 'commission'> = prisma,
) {
  const summary = { totalDue: 0, totalPaid: 0, totalRecords: 0 };
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') {
    for (const commission of listAdminCommissions()) {
      summary.totalRecords++;
      if (commission.status === 'due') summary.totalDue += commission.commissionAmount ?? 0;
      if (commission.status === 'paid') summary.totalPaid += commission.commissionAmount ?? 0;
    }
    return summary;
  }

  const groups = await database.commission.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { commissionAmount: true },
  });
  for (const group of groups) {
    summary.totalRecords += group._count._all;
    const amount = Number(group._sum.commissionAmount ?? 0);
    if (group.status === 'due') summary.totalDue += amount;
    if (group.status === 'paid') summary.totalPaid += amount;
  }
  return summary;
}
