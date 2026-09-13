import { listModerationQueuePage } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  return Response.json(
    await listModerationQueuePage(
      parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
    ),
    {
      headers: noStoreHeaders,
    },
  );
}
