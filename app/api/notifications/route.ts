import {
  listAccountFollowNotifications,
  markAccountFollowNotificationsRead,
} from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'notifications_list',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  return Response.json(await listAccountFollowNotifications(session.user));
}

export async function PATCH(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'notifications_update',
    actorId: session.user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  return Response.json(await markAccountFollowNotificationsRead(session.user));
}
