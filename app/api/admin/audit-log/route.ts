import type { AdminAuditAction, Prisma } from '@prisma/client';

import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { createPaginationMeta, parsePaginationFromRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

const auditActions = new Set<AdminAuditAction>([
  'approve_listing',
  'update_listing',
  'reject_listing',
  'delete_listing',
  'review_report',
  'dismiss_report',
  'update_commission',
  'update_user',
  'delete_user',
  'warn_user',
  'restrict_conversation',
  'maintenance_cleanup',
  'update_site_message',
]);

function parseDate(value: string | null, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401 });
  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('query')?.trim();
  const admin = url.searchParams.get('admin')?.trim();
  const actionValue = url.searchParams.get('action')?.trim() as AdminAuditAction | undefined;
  const targetType = url.searchParams.get('targetType')?.trim();
  const from = parseDate(url.searchParams.get('from'));
  const to = parseDate(url.searchParams.get('to'), true);
  const pagination = parsePaginationFromRequest(request, { defaultLimit: 25, maxLimit: 50 });
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(actionValue && auditActions.has(actionValue) ? { action: actionValue } : {}),
    ...(targetType ? { targetType } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    ...(admin
      ? {
          admin: {
            is: {
              OR: [
                { id: { contains: admin, mode: 'insensitive' } },
                { email: { contains: admin, mode: 'insensitive' } },
                { name: { contains: admin, mode: 'insensitive' } },
              ],
            },
          },
        }
      : {}),
    ...(query
      ? {
          OR: [
            { targetId: { contains: query, mode: 'insensitive' } },
            { targetType: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        metadata: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  const hasMore = records.length > pagination.limit;

  return Response.json(
    {
      records: records.slice(0, pagination.limit),
      pagination: {
        ...createPaginationMeta({ page: pagination.page, limit: pagination.limit, hasMore }),
        total,
      },
    },
    { headers: noStoreHeaders },
  );
}
