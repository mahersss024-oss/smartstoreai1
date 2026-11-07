import { listAdminCommissionsPage } from '@/agent/marketplace/repository';
import { getAdminCommissionSummary } from '@/lib/admin/commission-summary';
import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'owner_required' }, { status: 403 });
  }

  const [commissionsPage, summary] = await Promise.all([
    listAdminCommissionsPage(parsePaginationFromRequest(request, { defaultLimit: 20, maxLimit: 48 })),
    getAdminCommissionSummary(),
  ]);

  return Response.json({
    commissions: commissionsPage.items,
    pagination: commissionsPage.pagination,
    summary,
  }, {
    headers: noStoreHeaders,
  });
}
