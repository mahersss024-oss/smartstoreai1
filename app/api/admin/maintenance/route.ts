import { z } from 'zod';
import { withEvidenceProtection } from '@/agent/marketplace/evidence';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { executeMaintenanceCleanup, getMaintenancePreview, MaintenanceError, maintenanceScopes } from '@/lib/admin/maintenance';
import { getDatabaseCompatibility, getDatabaseOverview, getDatabaseTablePage } from '@/lib/admin/database-inspection';
import { schedulePendingImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import { executeMarketReset, getMarketResetPreview, MarketResetError, marketResetConfirmation } from '@/lib/admin/market-reset';

export const dynamic = 'force-dynamic';
const cleanupSchema = z.object({ scope: z.enum(maintenanceScopes), confirmation: z.literal('تنظيف'), reason: z.string().trim().min(5).max(500), previewToken: z.string().min(1).max(2000) }).strict();
const resetSchema = z.object({ action: z.literal('market_reset'), confirmation: z.literal(marketResetConfirmation),
  reason: z.string().trim().min(5).max(500), previewToken: z.string().min(1).max(2000),
  backupConfirmed: z.literal(true), includeProtectedData: z.literal(true) }).strict();
type OwnerAccess = { session: NonNullable<ReturnType<typeof getAuthSession>> } | { response: Response };
function access(request: Request): OwnerAccess {
  const session = getAuthSession(request);
  if (!session) return { response: Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders }) };
  if (!isPlatformOwner(session)) return { response: Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders }) };
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return { response: Response.json({ error: 'database_required' }, { status: 503, headers: noStoreHeaders }) };
  return { session };
}
function failed(error: unknown) {
  if (error instanceof MaintenanceError || error instanceof MarketResetError) return Response.json({ error: error.code }, { status: error.status, headers: noStoreHeaders });
  const code = typeof error === 'object' && error && 'code' in error ? error.code : '';
  if (code === '55P03' || code === 'P2010' && 'meta' in (error as object) &&
    (error as { meta?: { code?: string } }).meta?.code === '55P03') return Response.json({ error: 'reset_busy' }, { status: 409, headers: noStoreHeaders });
  if (code === 'P2034' || code === 'P2028' || code === 'P2010') return Response.json({ error: 'preview_stale' }, { status: 409, headers: noStoreHeaders });
  console.warn('[admin_maintenance] operation_failed');
  return Response.json({ error: 'maintenance_unavailable' }, { status: 503, headers: noStoreHeaders });
}
function noStoreResponse(response: Response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(noStoreHeaders)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export async function GET(request: Request) {
  const owner = access(request); if ('response' in owner) return owner.response;
  const url = new URL(request.url);
  const databaseRequest = url.searchParams.get('resource') === 'database';
  const limited = await enforceApiRateLimit(request, {
    namespace: databaseRequest ? 'owner_database_inspection' : 'owner_maintenance_preview',
    actorId: owner.session.user.id,
    maxRequests: databaseRequest ? 60 : 12,
    windowMs: 60_000,
  });
  if (limited) return noStoreResponse(limited);
  if (url.searchParams.get('resource') === 'market_reset') {
    try { return Response.json(await getMarketResetPreview(owner.session.user.id), { headers: noStoreHeaders }); }
    catch (error) { return failed(error); }
  }
  if (databaseRequest) {
    try {
      const model = url.searchParams.get('model');
      const result = model
        ? await getDatabaseTablePage(
            model,
            Math.max(1, Math.min(100_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1)),
            Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25)),
            (url.searchParams.get('search') ?? '').trim().slice(0, 120),
          )
        : url.searchParams.get('view') === 'compatibility'
          ? await getDatabaseCompatibility()
          : await getDatabaseOverview();
      if (!result) return Response.json({ error: 'model_not_found' }, { status: 404, headers: noStoreHeaders });
      return Response.json(result, { headers: noStoreHeaders });
    } catch {
      console.warn('[owner_database_inspection] read_failed');
      return Response.json({ error: 'database_inspection_unavailable' }, { status: 503, headers: noStoreHeaders });
    }
  }
  const value = url.searchParams.get('scope');
  const scope = value ? z.enum(maintenanceScopes).safeParse(value) : null;
  if (scope && !scope.success) return Response.json({ error: 'invalid_scope' }, { status: 400, headers: noStoreHeaders });
  try { return Response.json(await getMaintenancePreview(owner.session.user.id, scope?.success ? scope.data : undefined), { headers: noStoreHeaders }); } catch (error) { return failed(error); }
}
export async function POST(request: Request) { return withEvidenceProtection(cleanup)(request); }
async function cleanup(request: Request): Promise<Response> {
  const owner = access(request); if ('response' in owner) return owner.response;
  const limited = await enforceApiRateLimit(request, { namespace: 'owner_maintenance_cleanup', actorId: owner.session.user.id, maxRequests: 6, windowMs: 60_000 });
  if (limited) return noStoreResponse(limited);
  const oversized = rejectOversizedRequest(request, 4096); if (oversized) return oversized;
  const body: unknown = await request.json().catch(() => null);
  if (body && typeof body === 'object' && 'action' in body && body.action === 'market_reset') {
    const reset = resetSchema.safeParse(body);
    if (!reset.success) return Response.json({ error: 'invalid_reset_request' }, { status: 400, headers: noStoreHeaders });
    try {
      const result = await executeMarketReset({ ...reset.data, actorId: owner.session.user.id });
      schedulePendingImageObjectCleanup();
      try { publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: 'market_reset' }, visibility: { includePublic: true, includeAdmins: true } }); } catch { /* Already committed. */ }
      return Response.json(result, { headers: noStoreHeaders });
    } catch (error) { return failed(error); }
  }
  const parsed = cleanupSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_cleanup_request' }, { status: 400, headers: noStoreHeaders });
  try {
    const result = await executeMaintenanceCleanup({ ...parsed.data, actorId: owner.session.user.id });
    schedulePendingImageObjectCleanup();
    try { publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: parsed.data.scope }, visibility: { includePublic: true, includeAdmins: true } }); } catch { /* Cleanup is already committed. */ }
    return Response.json({ status: 'completed', ...result }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof Error && /evidence_protected|evidence_copy_pending/.test(error.message)) throw error;
    return failed(error);
  }
}
