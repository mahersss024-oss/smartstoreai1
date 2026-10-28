import { createHash } from 'node:crypto';
import { after } from 'next/server';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { hasVerifiedAdminAccess, isPlatformOwner } from '@/lib/auth/authorization';
import type { AuthSession } from '@/lib/auth/session';
import { noStoreHeaders } from '@/lib/api/no-store';
import { createAdminAuditLog } from '@/lib/admin/audit';
import { deleteEvidenceObject, readEvidenceObject, readEvidenceSource, storeEvidenceObject } from './object-storage';

export type EvidenceSource = 'Report' | 'UserReport';
const activeCases = { status: { not: 'disposed' } };
const evidenceActions = new Set(['evidence_retry', 'evidence_extend', 'evidence_hold', 'evidence_release', 'evidence_dispose']);

function evidenceEnabled() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export function evidenceHash(data: Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

async function lockEvidenceWrites(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(771203, 1)`;
}

async function lockCaseEntities(tx: Prisma.TransactionClient, sourceType: EvidenceSource, sourceId: string) {
  const current = await tx.evidenceCase.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } }, select: { listingId: true, participantIds: true } });
  if (!current) return;
  const keys = [...current.participantIds.map(id => `user:${id}`), ...(current.listingId ? [`listing:${current.listingId}`] : [])];
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${key}))`;
  }
}

export async function lockUserEvidenceEntities(tx: Prisma.TransactionClient, userId: string) {
  const listings = await tx.listing.findMany({ where: { sellerId: userId }, select: { id: true } });
  const keys = [`user:${userId}`, ...listings.map(listing => `listing:${listing.id}`)].sort();
  for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${key}))`;
}

export async function hasProtectedUserEvidence(userId: string, tx: Prisma.TransactionClient = prisma) {
  return Boolean(await tx.evidenceCase.findFirst({ where: { ...activeCases, participantIds: { has: userId } }, select: { id: true } }));
}

export function evidenceMutationResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/evidence_protected|evidence_copy_pending/.test(message)) {
    return Response.json({ error: 'evidence_protected', message: 'المحتوى مرتبط بقضية محفوظة. يمكن إخفاؤه، ولا يمكن إتلاف الأدلة المحمية.' }, { status: 409, headers: noStoreHeaders });
  }
  throw error;
}

export function withEvidenceProtection<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try { return await handler(...args); } catch (error) { return evidenceMutationResponse(error); }
  };
}

export async function copyEvidenceAssets(sourceType: EvidenceSource, sourceId: string) {
  if (!evidenceEnabled()) return;
  const evidenceCase = await prisma.evidenceCase.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!evidenceCase || ['disposed', 'disposing'].includes(evidenceCase.status)) return;
  const assets = await prisma.evidenceAsset.findMany({ where: { caseId: evidenceCase.id, status: { not: 'stored' } }, orderBy: { id: 'asc' } });
  for (const asset of assets) {
    // A durable lease permits recovery after a process exits during an upload.
    const claimed = await prisma.$transaction(async tx => {
      await lockEvidenceWrites(tx);
      const current = await tx.evidenceCase.findUniqueOrThrow({ where: { id: evidenceCase.id } });
      if (['disposed', 'disposing'].includes(current.status)) return false;
      const result = await tx.evidenceAsset.updateMany({ where: { id: asset.id, OR: [{ status: { in: ['pending', 'failed'] } }, { status: 'copying', leaseUntil: { lt: new Date() } }] }, data: { status: 'copying', leaseUntil: new Date(Date.now() + 10 * 60_000), attempts: { increment: 1 }, lastError: null } });
      return result.count === 1;
    });
    if (!claimed) continue;
    try {
      const { data, mediaType } = await readEvidenceSource(asset.sourceUrl);
      const hash = evidenceHash(data);
      await storeEvidenceObject(asset.objectKey, data, mediaType);
      const stored = await readEvidenceObject(asset.objectKey);
      if (evidenceHash(stored) !== hash) throw new Error('evidence_checksum_mismatch');
      await prisma.evidenceAsset.update({ where: { id: asset.id }, data: { status: 'stored', sha256: hash, byteLength: data.length, mediaType, lastError: null } });
    } catch (error) {
      const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'evidence_copy_failed';
      await prisma.evidenceAsset.update({ where: { id: asset.id }, data: { status: 'failed', lastError: code } });
    }
  }
  await prisma.$transaction(async tx => {
    await lockEvidenceWrites(tx);
    const pending = await tx.evidenceAsset.count({ where: { caseId: evidenceCase.id, status: { not: 'stored' } } });
    await tx.evidenceCase.updateMany({ where: { id: evidenceCase.id, status: { notIn: ['disposed', 'disposing'] } }, data: { captureStatus: pending ? 'incomplete' : 'complete' } });
  });
}

export function scheduleEvidenceCopy(sourceType: EvidenceSource, sourceId: string) {
  if (!evidenceEnabled()) return;
  try {
    after(() => copyEvidenceAssets(sourceType, sourceId).catch(() => { console.warn('[evidence] background_copy_failed'); }));
  } catch {
    // Direct unit/CLI callers have no request lifetime; pending jobs remain durable.
    console.warn('[evidence] copy_pending_without_request_context');
  }
}

export function scheduleListingEvidenceCopy(listingId: string) {
  if (!evidenceEnabled()) return;
  try {
    after(async () => {
      const cases = await prisma.evidenceCase.findMany({ where: { listingId, status: { notIn: ['disposed', 'disposing'] }, captureStatus: { not: 'complete' } }, select: { sourceType: true, sourceId: true } });
      for (const c of cases) await copyEvidenceAssets(c.sourceType as EvidenceSource, c.sourceId);
    });
  } catch { console.warn('[evidence] listing_copy_pending_without_request_context'); }
}

async function caseEvent(tx: Prisma.TransactionClient, caseId: string, actorId: string, action: string, payload: Prisma.InputJsonObject = {}) {
  await tx.evidenceEvent.create({ data: { caseId, actorId, action, payload } });
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
  await createAdminAuditLog(tx, { adminId: actor?.id ?? null, action: 'manage_evidence', targetType: 'evidence_case', targetId: caseId, metadata: { operation: action, ...payload } });
}

export async function readCaseEvidence(sourceType: EvidenceSource, sourceId: string, actorId: string, request: Request) {
  if (!evidenceEnabled()) return Response.json({ error: 'database_evidence_required' }, { status: 503, headers: noStoreHeaders });
  const evidenceCase = await prisma.evidenceCase.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
  if (!evidenceCase) return Response.json({ error: 'evidence_not_found' }, { status: 404, headers: noStoreHeaders });
  if (evidenceCase.status !== 'disposed' && evidenceCase.captureStatus !== 'complete') scheduleEvidenceCopy(sourceType, sourceId);
  if (evidenceCase.status !== 'disposed') {
    const [integrity] = await prisma.$queryRaw<Array<{ valid: boolean }>>`SELECT encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') = "snapshotHash" AS valid FROM "EvidenceCase" WHERE id = ${evidenceCase.id}`;
    if (!integrity?.valid) return Response.json({ error: 'evidence_integrity_failed' }, { status: 409, headers: noStoreHeaders });
  }
  const url = new URL(request.url);
  const assetId = url.searchParams.get('asset');
  if (assetId) {
    const asset = await prisma.evidenceAsset.findFirst({ where: { id: assetId, caseId: evidenceCase.id, status: 'stored' } });
    if (!asset || ['disposed', 'disposing'].includes(evidenceCase.status)) return Response.json({ error: 'asset_unavailable' }, { status: 404, headers: noStoreHeaders });
    await caseEvent(prisma, evidenceCase.id, actorId, 'asset.viewed', { assetId });
    const data = await readEvidenceObject(asset.objectKey);
    if (evidenceHash(data) !== asset.sha256) return Response.json({ error: 'evidence_integrity_failed' }, { status: 409, headers: noStoreHeaders });
    return new Response(new Uint8Array(data), { headers: { ...noStoreHeaders, 'Content-Type': asset.mediaType ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  const page = Math.max(1, Math.min(100_000, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1));
  const snapshot = evidenceCase.snapshot as Record<string, Prisma.JsonValue>;
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const [assets, events] = await Promise.all([
    prisma.evidenceAsset.findMany({ where: { caseId: evidenceCase.id }, orderBy: { id: 'asc' }, select: { id: true, status: true, mediaType: true, sha256: true, attempts: true, lastError: true } }),
    prisma.evidenceEvent.findMany({ where: { caseId: evidenceCase.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * 50, take: 51 }),
  ]);
  await caseEvent(prisma, evidenceCase.id, actorId, 'case.viewed', { page });
  return Response.json({ evidenceCase: { ...evidenceCase, snapshot: { ...snapshot, messages: messages.slice((page - 1) * 50, page * 50) } }, assets, events: events.slice(0, 50), page, hasMore: messages.length > page * 50 || events.length > 50 }, { headers: noStoreHeaders });
}

export async function actOnCaseEvidence(sourceType: EvidenceSource, sourceId: string, session: AuthSession, payload: unknown) {
  if (!payload || typeof payload !== 'object' || !('action' in payload) || typeof payload.action !== 'string' || !evidenceActions.has(payload.action)) return null;
  if (!evidenceEnabled()) return Response.json({ error: 'database_evidence_required' }, { status: 503 });
  const action = payload.action;
  if (action === 'evidence_dispose' && !isPlatformOwner(session)) return Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders });
  if (action !== 'evidence_retry' && !(await hasVerifiedAdminAccess(session))) return Response.json({ error: 'owner_required' }, { status: 403 });
  const reason = 'reason' in payload && typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 500) : '';
  const days = 'days' in payload ? Number(payload.days) : 0;
  if (action !== 'evidence_retry' && reason.length < 5) return Response.json({ error: 'reason_required' }, { status: 400 });
  if (action === 'evidence_extend' && (!Number.isInteger(days) || days < 1 || days > 3650)) return Response.json({ error: 'invalid_retention_days' }, { status: 400 });
  if (action === 'evidence_dispose' && (!('confirmation' in payload) || payload.confirmation !== 'إتلاف الأدلة')) return Response.json({ error: 'confirmation_required' }, { status: 400 });
  const result = await prisma.$transaction(async tx => {
    await lockCaseEntities(tx, sourceType, sourceId);
    await lockEvidenceWrites(tx);
    await tx.$queryRaw`SELECT id FROM "EvidenceCase" WHERE "sourceType" = ${sourceType} AND "sourceId" = ${sourceId} FOR UPDATE`;
    const current = await tx.evidenceCase.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } });
    if (!current) return { error: 'evidence_not_found', status: 404 };
    if (current.status === 'disposed') return { error: 'evidence_disposed', status: 409 };
    if (current.status === 'disposing' && action !== 'evidence_dispose') return { error: 'evidence_disposal_in_progress', status: 409 };
    if (action === 'evidence_dispose') {
      const relatedOpen = await tx.evidenceCase.count({ where: { status: 'open', OR: [{ id: current.id }, ...(current.listingId ? [{ listingId: current.listingId }] : []), { participantIds: { hasSome: current.participantIds } }] } });
      const outstanding = current.listingId ? await tx.commission.count({ where: { listingId: current.listingId, status: { not: 'paid' } } }) : 0;
      if (relatedOpen || outstanding || current.legalHold || !current.closedAt || !current.retainUntil || current.retainUntil > new Date() || current.captureStatus !== 'complete') return { error: 'evidence_retention_protected', status: 409 };
      await tx.evidenceCase.update({ where: { id: current.id }, data: { status: 'disposing' } });
    } else if (action === 'evidence_extend') {
      const base = Math.max(Date.now(), current.retainUntil?.getTime() ?? 0);
      await tx.evidenceCase.update({ where: { id: current.id }, data: { retainUntil: new Date(base + days * 86_400_000) } });
    } else if (action === 'evidence_hold' || action === 'evidence_release') {
      await tx.evidenceCase.update({ where: { id: current.id }, data: { legalHold: action === 'evidence_hold' } });
    }
    await caseEvent(tx, current.id, session.user.id, action, { reason, days });
    return { caseId: current.id };
  });
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status, headers: noStoreHeaders });
  if (action === 'evidence_retry') await copyEvidenceAssets(sourceType, sourceId);
  if (action === 'evidence_dispose') {
    const assets = await prisma.evidenceAsset.findMany({ where: { caseId: result.caseId } });
    try { for (const asset of assets) await deleteEvidenceObject(asset.objectKey); }
    catch { return Response.json({ error: 'evidence_disposal_incomplete' }, { status: 503, headers: noStoreHeaders }); }
    await prisma.$transaction(async tx => {
      await lockEvidenceWrites(tx);
      const current = await tx.evidenceCase.findUniqueOrThrow({ where: { id: result.caseId } });
      if (current.status === 'disposed') return;
      if (current.status !== 'disposing') throw new Error('evidence_disposal_state_changed');
      await tx.evidenceAsset.deleteMany({ where: { caseId: current.id } });
      await tx.evidenceEvent.deleteMany({ where: { caseId: current.id } });
      await tx.evidenceCase.update({ where: { id: current.id }, data: { snapshot: {}, snapshotHash: '', participantIds: [], conversationIds: [], listingId: null, status: 'disposed', captureStatus: 'disposed', disposedAt: new Date() } });
      await caseEvent(tx, current.id, session.user.id, 'case.disposed', { reason });
    });
  }
  return Response.json({ status: 'completed' }, { headers: noStoreHeaders });
}
