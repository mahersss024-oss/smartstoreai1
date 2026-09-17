import { listAdminCommissionsPage } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';
import { hasPlatformOwnerAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasPlatformOwnerAccess(session))) {
    return Response.json({ error: 'owner_required' }, { status: 403 });
  }

  const commissionsPage = await listAdminCommissionsPage(
    parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 }),
  );

  return Response.json({
    commissions: commissionsPage.items,
    pagination: commissionsPage.pagination,
  }, {
    headers: noStoreHeaders,
  });
}
