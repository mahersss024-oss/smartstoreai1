import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAdminOverview } from '@/lib/admin/overview';
import { getAuthSession } from '@/lib/auth/session';
import { getAdminWorkspace, workspaceMonth } from '@/lib/admin/workspace';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get('view') === 'workspace') {
    const month = workspaceMonth(url.searchParams.get('month'));
    if (!month) return Response.json({ error: 'invalid_month' }, { status: 400, headers: noStoreHeaders });
    return Response.json(await getAdminWorkspace(month), { headers: noStoreHeaders });
  }

  return Response.json(
    await getAdminOverview(),
    { headers: noStoreHeaders },
  );
}
