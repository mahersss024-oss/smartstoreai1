import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { getMaintenanceOverview } from '@/lib/admin/maintenance';
import { getDatabaseCompatibility, getDatabaseOverview, getDatabaseTablePage } from '@/lib/admin/database-inspection';

export const dynamic = 'force-dynamic';
type OwnerAccess = { session: NonNullable<ReturnType<typeof getAuthSession>> } | { response: Response };
function access(request: Request): OwnerAccess {
  const session = getAuthSession(request);
  if (!session) return { response: Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders }) };
  if (!isPlatformOwner(session)) return { response: Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders }) };
  return { session };
}
function noStoreResponse(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(noStoreHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function readOnly(request: Request): Response {
  const owner = access(request); if ('response' in owner) return owner.response;
  return Response.json({ error: 'maintenance_read_only', monitoringOnly: true }, { status: 403, headers: noStoreHeaders });
}
export async function GET(request: Request) {
  const owner = access(request); if ('response' in owner) return owner.response;
  const url = new URL(request.url);
  if (url.searchParams.get('resource') === 'market_reset') return readOnly(request);
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return Response.json({ error: 'database_required' }, { status: 503, headers: noStoreHeaders });
  const databaseRequest = url.searchParams.get('resource') === 'database';
  const limited = await enforceApiRateLimit(request, { namespace: databaseRequest ? 'owner_database_inspection' : 'owner_maintenance_monitoring',
    actorId: owner.session.user.id, maxRequests: databaseRequest ? 60 : 12, windowMs: 60_000 });
  if (limited) return noStoreResponse(limited);
  try {
    if (databaseRequest) {
      const model = url.searchParams.get('model');
      const result = model
        ? await getDatabaseTablePage(model,
          Math.max(1, Math.min(100_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)),
          Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25)),
          (url.searchParams.get('search') ?? '').trim().slice(0, 120))
        : url.searchParams.get('view') === 'compatibility' ? await getDatabaseCompatibility() : await getDatabaseOverview();
      if (!result) return Response.json({ error: 'model_not_found' }, { status: 404, headers: noStoreHeaders });
      return Response.json({ ...result, monitoringOnly: true }, { headers: noStoreHeaders });
    }
    return Response.json(await getMaintenanceOverview(), { headers: noStoreHeaders });
  } catch {
    console.warn('[owner_maintenance_monitoring] read_failed');
    return Response.json({ error: databaseRequest ? 'database_inspection_unavailable' : 'maintenance_unavailable' }, { status: 503, headers: noStoreHeaders });
  }
}
// Explicit denials keep bookmarked forms and old clients harmless, regardless of flags.
export async function POST(request: Request) { return readOnly(request); }
export async function PUT(request: Request) { return readOnly(request); }
export async function PATCH(request: Request) { return readOnly(request); }
export async function DELETE(request: Request) { return readOnly(request); }
