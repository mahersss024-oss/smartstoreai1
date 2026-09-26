import { z } from 'zod';

import { setReportModerationStatus } from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import {
  hasVerifiedAdminAccess,
  hasVerifiedModeratorAccess,
} from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

const maxReportModerationActionRequestBytes = 4 * 1024;

const reportActionSchema = z.object({
  action: z.enum(['review', 'dismiss']),
});

type RouteContext = {
  params: Promise<{
    reportId: string;
  }>;
};

function getReportStatus(action: z.infer<typeof reportActionSchema>['action']) {
  return action === 'review' ? 'reviewed' : 'dismissed';
}

async function enforceModerationReportMutationRateLimit(
  request: Request,
  moderatorId: string,
) {
  return enforceApiRateLimit(request, {
    namespace: 'moderation_report_mutation',
    actorId: moderatorId,
    maxRequests: 120,
    windowMs: 60_000,
  });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceModerationReportMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxReportModerationActionRequestBytes,
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

  const parsed = reportActionSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { reportId } = await context.params;
  const result = await setReportModerationStatus(
    reportId,
    getReportStatus(parsed.data.action),
    session.user,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'report_not_found' }, { status: 404 });
  }

  return Response.json(result);
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceModerationReportMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { reportId } = await context.params;
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, status: true },
  });

  if (!report) {
    return Response.json({ error: 'report_not_found' }, { status: 404 });
  }

  if (report.status === 'open') {
    return Response.json({ error: 'report_must_be_closed' }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.report.delete({ where: { id: reportId } }),
    prisma.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'dismiss_report',
        targetType: 'report',
        targetId: reportId,
        metadata: {
          operation: 'moderation_report_delete',
          status: report.status,
        },
      },
    }),
  ]);

  return Response.json({ status: 'deleted', reportId });
}
