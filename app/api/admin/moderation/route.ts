import { listModerationQueuePage } from '@/agent/marketplace/repository';
import { getAuthSession, isModeratorSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isModeratorSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  return Response.json(
    await listModerationQueuePage(
      parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
    ),
  );
}
