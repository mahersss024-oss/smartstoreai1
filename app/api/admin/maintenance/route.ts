import { noStoreHeaders } from '@/lib/api/no-store';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

function retiredResponse(request: Request) {
  const session = getAuthSession(request);
  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  }
  if (!isPlatformOwner(session)) {
    return Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders });
  }
  return Response.json({ error: 'maintenance_retired' }, { status: 410, headers: noStoreHeaders });
}

// Keep the legacy path fail-closed for stale clients and saved links. No database
// or storage operations are reachable through this route.
export async function GET(request: Request) {
  return retiredResponse(request);
}

export async function POST(request: Request) {
  return retiredResponse(request);
}
