import { listModerationQueuePage } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';
import {
  acknowledgeReportNotification,
  listReportNotifications,
} from '@/lib/admin/report-notifications';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  if (new URL(request.url).searchParams.get('view') === 'notifications') {
    if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database')
      return Response.json(
        { error: 'database_required' },
        { status: 503, headers: noStoreHeaders },
      );
    const limited = await enforceApiRateLimit(request, {
      namespace: 'admin_report_notifications',
      actorId: session.user.id,
      maxRequests: 120,
      windowMs: 60_000,
    });
    if (limited) return limited;
    const pagination = parsePaginationFromRequest(request, {
      defaultLimit: 20,
      maxLimit: 48,
    });
    return Response.json(
      await listReportNotifications(pagination.page, pagination.limit),
      { headers: noStoreHeaders },
    );
  }
  const params = new URL(request.url).searchParams;
  const reportId = params.get('reportId');
  const sourceType = params.get('sourceType');
  if (
    reportId &&
    (reportId.length > 128 ||
      (sourceType !== 'Report' && sourceType !== 'UserReport'))
  )
    return Response.json(
      { error: 'invalid_report_filter' },
      { status: 400, headers: noStoreHeaders },
    );
  return Response.json(
    await listModerationQueuePage(
      parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
      reportId
        ? { reportId, sourceType: sourceType as 'Report' | 'UserReport' }
        : undefined,
    ),
    {
      headers: noStoreHeaders,
    },
  );
}

const acknowledgeSchema = z
  .object({
    action: z.literal('notification_viewed'),
    caseId: z.string().min(1).max(128),
  })
  .strict();

export async function PATCH(request: Request) {
  const session = getAuthSession(request);
  if (!session)
    return Response.json({ error: 'auth_required' }, { status: 401 });
  if (!(await hasVerifiedModeratorAccess(session)))
    return Response.json({ error: 'admin_required' }, { status: 403 });
  const limited = await enforceApiRateLimit(request, {
    namespace: 'admin_report_notification_ack',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const oversized = rejectOversizedRequest(request, 2048);
  if (oversized) return oversized;
  const parsed = acknowledgeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database')
    return Response.json(
      { error: 'database_required' },
      { status: 503, headers: noStoreHeaders },
    );
  const acknowledged = await acknowledgeReportNotification(
    parsed.data.caseId,
    session.user.id,
  );
  if (!acknowledged)
    return Response.json(
      { error: 'notification_not_found' },
      { status: 404, headers: noStoreHeaders },
    );
  try {
    await publishRealtimeEvent({
      type: 'moderation_updated',
      payload: {
        entity: 'report',
        entityId: parsed.data.caseId,
        status: 'notification_viewed',
      },
      visibility: { includeAdmins: true },
    });
  } catch {
    console.warn('[admin_notifications] realtime_publish_failed');
  }
  return Response.json({ acknowledged: true }, { headers: noStoreHeaders });
}
