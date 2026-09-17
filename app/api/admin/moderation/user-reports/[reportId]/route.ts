import { z } from 'zod';

import { setUserReportModerationStatus } from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';

const actionSchema = z.object({
  action: z.enum([
    'review',
    'dismiss',
    'warn',
    'restrict',
    'close_conversation',
  ]),
});

type RouteContext = { params: Promise<{ reportId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401 });
  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimited = await enforceApiRateLimit(request, {
    namespace: 'moderation_user_report_mutation',
    actorId: session.user.id,
    maxRequests: 90,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const oversized = rejectOversizedRequest(request, 4 * 1024);
  if (oversized) return oversized;

  const payload = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { reportId } = await context.params;
  const result = await setUserReportModerationStatus(
    reportId,
    parsed.data.action,
    session.user,
  );
  if (result.status === 'not_found') {
    return Response.json({ error: 'report_not_found' }, { status: 404 });
  }
  return Response.json(result);
}
