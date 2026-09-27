import { noStoreHeaders } from '@/lib/api/no-store';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAdminOverview } from '@/lib/admin/overview';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  return Response.json(
    await getAdminOverview(),
    { headers: noStoreHeaders },
  );
}
