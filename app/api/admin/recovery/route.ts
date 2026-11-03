import { getAuthSession } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getRecoveryEmergencyPlan } from '@/lib/recovery/emergency-plan';
import { getRecoveryRdsStatus } from '@/lib/recovery/rds';
import { getRecoveryMediaStatus } from '@/lib/recovery/media';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStoreHeaders }); }
type OwnerAccess = { session: NonNullable<ReturnType<typeof getAuthSession>> } | { response: Response };
function owner(request: Request): OwnerAccess {
  const session = getAuthSession(request);
  if (!session) return { response: json({ error: 'auth_required' }, 401) };
  if (!isPlatformOwner(session)) return { response: json({ error: 'owner_required' }, 403) };
  return { session };
}
export async function GET(request: Request) {
  const access = owner(request); if ('response' in access) return access.response;
  const limited = await enforceApiRateLimit(request, { namespace: 'owner_recovery_read', actorId: access.session.user.id,
    maxRequests: 30, windowMs: 60_000 });
  if (limited) {
    const headers = new Headers(limited.headers);
    for (const [name, value] of Object.entries(noStoreHeaders)) headers.set(name, value);
    return new Response(limited.body, { status: limited.status, headers });
  }
  if (new URL(request.url).searchParams.get('download') === 'plan') return Response.json(getRecoveryEmergencyPlan(), {
    headers: { ...noStoreHeaders, 'Content-Disposition': 'attachment; filename="souqhamad-recovery-plan.json"' },
  });
  const [rds, media] = await Promise.all([getRecoveryRdsStatus(), getRecoveryMediaStatus()]);
  return json({ rds, media, monitoringOnly: true, productionCutoverAllowed: false,
    capabilities: { databaseRestore: false, databaseVerify: false, mediaBackup: false, mediaRestore: false },
    emergencyPlanDownloadPath: '/api/admin/recovery?download=plan',
    requiredConfiguration: ['SMARTSTORE_RECOVERY_MONITORING_ENABLED', 'SMARTSTORE_RECOVERY_AWS_REGION',
      'SMARTSTORE_RECOVERY_ACCOUNT_ID', 'SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER'] });
}
function readOnly(request: Request): Response {
  const access = owner(request); if ('response' in access) return access.response;
  return json({ error: 'recovery_read_only', monitoringOnly: true }, 403);
}
// No body parsing, cloud operation, SQL or feature flag can enable these verbs.
export async function POST(request: Request) { return readOnly(request); }
export async function PUT(request: Request) { return readOnly(request); }
export async function PATCH(request: Request) { return readOnly(request); }
export async function DELETE(request: Request) { return readOnly(request); }
