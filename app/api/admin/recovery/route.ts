import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAuthSession } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { isSameOriginApiMutationAllowed } from '@/lib/security/same-origin';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getRecoveryEmergencyPlan } from '@/lib/recovery/emergency-plan';
import { executeRecoveryRestore, getRecoveryRdsStatus, previewRecoveryRestore } from '@/lib/recovery/rds';
import { verifyRestoredDatabase } from '@/lib/recovery/restored-database';
import { getRecoveryMediaRun, getRecoveryMediaStatus, recoveryMediaConfirmation,
  restoreRecoveryMedia, startRecoveryMediaBackup } from '@/lib/recovery/media';
import { RecoveryError, recoveryRestoreConfirmation } from '@/lib/recovery/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reason = z.string().trim().min(5).max(500);
const restoreTarget = z.string().regex(/^souqhamad-recovery-[a-f0-9]{20}$/);
const uuid = z.string().uuid();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview_restore'), mode: z.enum(['snapshot', 'point_in_time']),
    snapshotId: z.string().min(1).max(255).optional(), restoreTime: z.string().datetime().optional() }).strict(),
  z.object({ action: z.literal('restore_database'), previewToken: z.string().min(1).max(8000),
    confirmation: z.literal(recoveryRestoreConfirmation), reason, costAcknowledged: z.literal(true) }).strict(),
  z.object({ action: z.literal('verify_database'), targetId: restoreTarget }).strict(),
  z.object({ action: z.literal('start_media_backup'), requestId: uuid, reason }).strict(),
  z.object({ action: z.literal('media_status'), operationId: uuid, kind: z.enum(['backup', 'quarantine_restore']) }).strict(),
  z.object({ action: z.literal('restore_media'), requestId: uuid, backupId: uuid,
    confirmation: z.literal(recoveryMediaConfirmation), reason }).strict(),
]);
function json(body: unknown, status = 200) { return Response.json(body, { status, headers: noStoreHeaders }); }
type OwnerAccess = { session: NonNullable<ReturnType<typeof getAuthSession>> } | { response: Response };
function owner(request: Request): OwnerAccess {
  const session = getAuthSession(request);
  if (!session) return { response: json({ error: 'auth_required' }, 401) };
  if (!isPlatformOwner(session)) return { response: json({ error: 'owner_required' }, 403) };
  return { session };
}
function failure(error: unknown) {
  if (error instanceof RecoveryError) return json({ error: error.code }, error.status);
  console.warn('[owner_recovery] operation_failed');
  return json({ error: 'recovery_unavailable' }, 503);
}
function audit(actorId: string, action: string, result: string) {
  // Kept in the external application logs; no customer profile or secret values.
  console.info(JSON.stringify({ event: 'owner_recovery', actorHash: createHash('sha256').update(actorId).digest('hex'),
    action, result, at: new Date().toISOString() }));
}

export async function GET(request: Request) {
  const access = owner(request); if ('response' in access) return access.response;
  const limited = await enforceApiRateLimit(request, { namespace: 'owner_recovery_read', actorId: access.session.user.id,
    maxRequests: 30, windowMs: 60_000 });
  if (limited) return limited;
  const url = new URL(request.url);
  if (url.searchParams.get('download') === 'plan') return Response.json(getRecoveryEmergencyPlan(), {
    headers: { ...noStoreHeaders, 'Content-Disposition': 'attachment; filename="souqhamad-recovery-plan.json"' },
  });
  try {
    const [rds, media] = await Promise.all([getRecoveryRdsStatus(), getRecoveryMediaStatus()]);
    const missingConfiguration = [
      ...(!rds.configured ? ['SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS', 'SMARTSTORE_RECOVERY_DB_SUBNET_GROUP']
        .filter(name => !process.env[name]?.trim()) : []),
      ...(!rds.enabled ? ['SMARTSTORE_RECOVERY_ENABLED'] : []),
      ...(!process.env.SMARTSTORE_RECOVERY_CA_BUNDLE_FILE?.trim() ? ['SMARTSTORE_RECOVERY_CA_BUNDLE_FILE'] : []),
      ...(!media.configured ? ['SMARTSTORE_RECOVERY_MEDIA_ORIGIN', 'SMARTSTORE_RECOVERY_MEDIA_SECRET']
        .filter(name => !process.env[name]?.trim()) : []),
      ...(process.env.SMARTSTORE_RECOVERY_MEDIA_ENABLED !== '1' ? ['SMARTSTORE_RECOVERY_MEDIA_ENABLED'] : []),
    ];
    return json({ rds, media, capabilities: {
      databaseRestore: rds.enabled && rds.readStatus === 'available',
      databaseVerify: rds.readStatus === 'available' && Boolean(process.env.SMARTSTORE_RECOVERY_CA_BUNDLE_FILE?.trim()),
      mediaBackup: media.backupEnabled && media.readStatus === 'available',
      mediaRestore: media.backupEnabled && media.readStatus === 'available',
    }, emergencyPlanDownloadPath: '/api/admin/recovery?download=plan',
    productionCutoverAllowed: false,
    missingConfiguration,
    requiredConfiguration: [
      'SMARTSTORE_RECOVERY_ENABLED', 'SMARTSTORE_RECOVERY_AWS_REGION', 'SMARTSTORE_RECOVERY_ACCOUNT_ID',
      'SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER', 'SMARTSTORE_RECOVERY_SECURITY_GROUP_IDS',
      'SMARTSTORE_RECOVERY_DB_SUBNET_GROUP', 'SMARTSTORE_RECOVERY_CA_BUNDLE_FILE',
      'SMARTSTORE_RECOVERY_MEDIA_ORIGIN', 'SMARTSTORE_RECOVERY_MEDIA_SECRET', 'SMARTSTORE_RECOVERY_MEDIA_ENABLED',
    ] });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const access = owner(request); if ('response' in access) return access.response;
  if (!isSameOriginApiMutationAllowed(request)) return json({ error: 'cross_site_request_blocked' }, 403);
  const limited = await enforceApiRateLimit(request, { namespace: 'owner_recovery_write', actorId: access.session.user.id,
    maxRequests: 8, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = await rejectOversizedRequest(request, 12_000); if (oversized) return oversized;
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: 'recovery_request_invalid' }, 400);
  const data = parsed.data;
  try {
    const actor = access.session.user.id;
    if (data.action === 'preview_restore') return json(await previewRecoveryRestore(actor, data));
    if (data.action === 'verify_database') return json(await verifyRestoredDatabase(actor, { targetId: data.targetId }));
    if (data.action === 'media_status') return json(await getRecoveryMediaRun(data.operationId, data.kind));
    audit(actor, data.action, 'requested');
    if (data.action === 'restore_database') {
      const result = await executeRecoveryRestore(actor, data); audit(actor, data.action, result.targetId); return json(result, 202);
    }
    if (data.action === 'start_media_backup') {
      const result = await startRecoveryMediaBackup(data.requestId); audit(actor, data.action, result.id); return json(result, 202);
    }
    const result = await restoreRecoveryMedia(data); audit(actor, data.action, result.id); return json(result, 202);
  } catch (error) { audit(access.session.user.id, data.action, 'failed'); return failure(error); }
}
