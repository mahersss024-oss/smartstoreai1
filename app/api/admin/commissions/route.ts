import { listAdminCommissionsPage } from '@/agent/marketplace/repository';
import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const commissionsPage = await listAdminCommissionsPage(
    parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
  );

  return Response.json({
    commissions: commissionsPage.items,
    pagination: commissionsPage.pagination,
  });
}
