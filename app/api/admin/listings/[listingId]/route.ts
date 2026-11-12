import { assertStaffMutationAccess, withStaffMutationProtection } from '@/lib/auth/staff-mutation';
import type { Listing, ListingImage } from '@prisma/client';
import { z } from 'zod';
import { InvalidMarketplaceCategoryOptionError, marketplaceCategoryOptionAttribute, mergeMarketplaceCategoryAttributes } from '@/lib/marketplace/category-options';
import { isMarketplaceCategory } from '@/lib/marketplace/categories';
import { marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';
import { marketplaceAmountSchema } from '@/lib/marketplace/amounts';
import { withEvidenceProtection } from '@/agent/marketplace/evidence';

import { recordDatabaseFirstPublication } from '@/agent/marketplace/listing-publication';
import { ensureDatabaseSaleCommission } from '@/agent/marketplace/listing-commission';
import { enqueueImageObjectCleanup, processImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';
import { createUnassessedMarketplaceCompliance } from '@/agent/marketplace/policy';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { enqueueNotificationDelivery, scheduleNotificationDelivery } from '@/lib/push/delivery-jobs';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const maxAdminListingUpdateRequestBytes = 64 * 1024;

const adminListingUpdateSchema = z.object({
  expectedUpdatedAt: z.string().datetime().optional(),
  category: z.string().min(2).max(80).optional(),
  categoryOption: z.string().max(80).nullable().optional(),
  carModel: z.string().max(80).nullable().optional(),
  title: z.string().min(2).max(140).optional(),
  description: z.string().min(2).max(4000).optional(),
  price: marketplaceAmountSchema.nullable().optional(),
  priceMode: z.enum(['bid', 'negotiable']).nullable().optional(),
  city: z.string().min(2).max(80).nullable().optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).nullable().optional(),
  status: z
    .enum(['draft', 'pending', 'published', 'paused', 'sold', 'rejected', 'deleted'])
    .optional(),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

async function enforceAdminListingMutationRateLimit(
  request: Request,
  adminId: string,
) {
  return enforceApiRateLimit(request, {
    namespace: 'admin_listing_mutation',
    actorId: adminId,
    maxRequests: 60,
    windowMs: 60_000,
  });
}

function buildSearchText(input: {
  category?: string | null;
  title?: string | null;
  description?: string | null;
  city?: string | null;
  condition?: string | null;
  attributes?: unknown;
}) {
  const attributes =
    input.attributes && typeof input.attributes === 'object'
      ? Object.values(input.attributes as Record<string, unknown>).join(' ')
      : '';

  return normalizeMarketplaceSearchText(
    [
      input.category,
      input.title,
      input.description,
      input.city,
      input.condition,
      attributes,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  return withStaffMutationProtection(patchWithCurrentAccess)(request, context);
}

async function patchWithCurrentAccess(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminListingMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = await rejectOversizedRequest(
    request,
    maxAdminListingUpdateRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = adminListingUpdateSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { listingId } = await context.params;
  // Seller identity is immutable here; all editable state is read after locking.
  const identity = await prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } });
  if (!identity) return Response.json({ error: 'listing_not_found' }, { status: 404 });

  const mutation = await prisma.$transaction(async (tx): Promise<{ response: Response } | { existing: Listing; updated: Listing }> => {
    // Match seller edits/account deletion and the evidence triggers: advisory
    // entity keys precede row locks, then derive every partial update afresh.
    for (const key of [`listing:${listingId}`, `user:${identity.sellerId}`].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${key}))`;
    }
    await tx.$executeRaw`SELECT 1 FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
    const existing = await tx.listing.findUnique({ where: { id: listingId } });

    if (!existing) {
      return { response: Response.json({ error: 'listing_not_found' }, { status: 404 }) };
    }
    await assertStaffMutationAccess(tx, session, 'moderator');
    if (parsed.data.expectedUpdatedAt && existing.updatedAt.getTime() !== new Date(parsed.data.expectedUpdatedAt).getTime()) {
      return { response: Response.json({ error: 'listing_changed' }, { status: 409 }) };
    }

    if (parsed.data.category && parsed.data.category !== existing.category && !isMarketplaceCategory(parsed.data.category)) {
      return { response: Response.json({ error: 'invalid_category', message: 'اختر تصنيفًا من القائمة.' }, { status: 400 }) };
    }

    let attributes: Record<string, unknown>;
    try {
      attributes = mergeMarketplaceCategoryAttributes(parsed.data.category ?? existing.category,
        {
          ...(parsed.data.categoryOption !== undefined ? { [marketplaceCategoryOptionAttribute]: parsed.data.categoryOption } : {}),
          ...(parsed.data.carModel !== undefined ? { [marketplaceCarModelAttribute]: parsed.data.carModel } : {}),
        },
        { category: existing.category, attributes: existing.attributes && typeof existing.attributes === 'object' && !Array.isArray(existing.attributes) ? existing.attributes as Record<string, unknown> : {} });
    } catch (error) {
      if (error instanceof InvalidMarketplaceCategoryOptionError) return { response: Response.json({ error: 'invalid_category_option', message: error.message }, { status: 400 }) };
      throw error;
    }
    const nextListing = {
      category: parsed.data.category ?? existing.category,
      title: parsed.data.title ?? existing.title,
      description: parsed.data.description ?? existing.description,
      city: 'city' in parsed.data ? parsed.data.city : existing.city,
      condition:
        'condition' in parsed.data ? parsed.data.condition : existing.condition,
      attributes,
    };
    const contentChanged = ['category', 'categoryOption', 'carModel', 'title', 'description', 'city', 'condition'].some(
      (key) => key in parsed.data,
    );
    const compliance = contentChanged
      ? createUnassessedMarketplaceCompliance()
      : null;
    const priceMode =
      'priceMode' in parsed.data ? parsed.data.priceMode : existing.priceMode;
    const price =
      'price' in parsed.data
        ? priceMode
          ? null
          : parsed.data.price
        : undefined;

    if (parsed.data.status) {
      await recordDatabaseFirstPublication(tx, listingId, parsed.data.status);
    }
    const listing = await tx.listing.update({
      where: { id: listingId },
      data: {
        category: parsed.data.category,
        attributes: attributes as import('@prisma/client').Prisma.InputJsonObject,
        title: parsed.data.title,
        description: parsed.data.description,
        city: 'city' in parsed.data ? parsed.data.city : undefined,
        condition:
          'condition' in parsed.data ? parsed.data.condition ?? null : undefined,
        price,
        priceMode,
        status: parsed.data.status,
        searchText: contentChanged ? buildSearchText(nextListing) : undefined,
        compliance: parsed.data.status
          ? { ...(compliance ?? existing.compliance as Record<string, unknown>), humanDecision: ['published', 'draft'].includes(parsed.data.status) ? 'allow' : 'block', decision: ['published', 'draft'].includes(parsed.data.status) ? 'allow' : (compliance?.decision ?? 'allow') }
          : compliance ? { ...compliance, ...((existing.compliance as Record<string, unknown>).humanDecision === 'block' ? { humanDecision: 'block', decision: (existing.compliance as { decision?: string }).decision ?? compliance.decision } : {}) } : undefined,
      },
    });

    await ensureDatabaseSaleCommission(tx, listing);
    if (existing.status !== 'published' && listing.status === 'published') {
      await enqueueNotificationDelivery(tx, 'listing-published', listing.id, { listingId: listing.id });
    }
    await tx.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action:
          parsed.data.status === 'deleted' ? 'delete_listing' : 'update_listing',
        targetType: 'listing',
        targetId: listingId,
        metadata: {
          operation: 'admin_listing_update',
          previous: {
            category: existing.category,
            title: existing.title,
            description: existing.description,
            city: existing.city,
            condition: existing.condition,
            price: existing.price?.toString() ?? null,
            priceMode: existing.priceMode,
            status: existing.status,
          },
          updates: parsed.data,
        },
      },
    });

    return { existing, updated: listing };
  }, { isolationLevel: 'ReadCommitted' });

  if ('response' in mutation) return mutation.response;
  const { existing, updated } = mutation;

  if (existing.status !== 'published' && updated.status === 'published') {
    scheduleNotificationDelivery(true);
  }

  const nextStatus = updated.status;
  const visibility = {
    includePublic:
      nextStatus === 'published' ||
      nextStatus === 'paused' ||
      nextStatus === 'sold' ||
      nextStatus === 'deleted',
    includeAdmins: true,
    userIds: [updated.sellerId],
  };

  try {
    publishRealtimeEvent({
      type: 'ad_updated',
      payload: {
        listingId: updated.id,
        sellerId: updated.sellerId,
        status: nextStatus,
        reason: 'admin_update',
      },
      visibility,
    });

    if (updated.status !== existing.status) {
      publishRealtimeEvent({
        type: 'ad_status_changed',
        payload: {
          listingId: updated.id,
          sellerId: updated.sellerId,
          previousStatus: existing.status,
          status: updated.status,
        },
        visibility,
      });
    }

    if (updated.status === 'deleted') {
      publishRealtimeEvent({
        type: 'ad_deleted',
        payload: {
          listingId: updated.id,
          sellerId: updated.sellerId,
        },
        visibility,
      });
    }
  } catch {
    // Admin update must not fail due to realtime delivery.
  }

  return Response.json({
    listing: {
      ...updated,
      price:
        updated.price && typeof updated.price === 'object' && 'toNumber' in updated.price
          ? updated.price.toNumber()
          : updated.price,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withStaffMutationProtection(deleteWithCurrentAccess)(request, context);
}

async function deleteWithCurrentAccess(request: Request, context: RouteContext) {
  return withEvidenceProtection(deleteListing)(request, context);
}

async function deleteListing(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminListingMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { listingId } = await context.params;
  const identity = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { sellerId: true },
  });

  if (!identity) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  const deletion = await prisma.$transaction(async (tx): Promise<{ response: Response } | { existing: Listing & { images: ListingImage[] } }> => {
    // Match editors and evidence triggers before locking the listing row. A
    // restore may have committed since the identity lookup above.
    for (const key of [`listing:${listingId}`, `user:${identity.sellerId}`].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${key}))`;
    }
    await tx.$executeRaw`SELECT 1 FROM "Listing" WHERE id = ${listingId} FOR UPDATE`;
    const existing = await tx.listing.findUnique({ where: { id: listingId }, include: { images: true } });
    if (!existing) return { response: Response.json({ error: 'listing_not_found' }, { status: 404 }) };
    if (existing.status !== 'deleted') {
      return { response: Response.json({ error: 'listing_must_be_deleted_first' }, { status: 409 }) };
    }

    await assertStaffMutationAccess(tx, session, 'moderator');
    for (const image of existing.images) await enqueueImageObjectCleanup(tx, {
      imageId: image.id, urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl], preserveForRecovery: true,
    });
    // Permanent deletion cascades to the listing's dependent marketplace rows.
    await tx.listing.delete({ where: { id: listingId } });
    await tx.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'delete_listing',
        targetType: 'listing',
        targetId: listingId,
        metadata: { operation: 'admin_listing_delete', mode: 'permanent' },
      },
    });
    return { existing };
  }, { isolationLevel: 'ReadCommitted' });

  if ('response' in deletion) return deletion.response;
  const { existing } = deletion;

  const cleanupDeadline = Date.now() + 20_000;
  for (const image of existing.images) {
    if (Date.now() >= cleanupDeadline) break;
    try { await processImageObjectCleanup(image.id, cleanupDeadline); }
    catch { console.warn('[admin_listing_storage_delete] outcome=pending'); }
  }

  try {
    publishRealtimeEvent({
      type: 'ad_status_changed',
      payload: {
        listingId,
        sellerId: existing.sellerId,
        previousStatus: existing.status,
        status: 'deleted',
      },
      visibility: {
        includePublic: true,
        includeAdmins: true,
        userIds: [existing.sellerId],
      },
    });

    publishRealtimeEvent({
      type: 'ad_deleted',
      payload: {
        listingId,
        sellerId: existing.sellerId,
      },
      visibility: {
        includePublic: true,
        includeAdmins: true,
        userIds: [existing.sellerId],
      },
    });
  } catch {
    // Admin delete must not fail due to realtime delivery.
  }

  return Response.json({ status: 'permanently_deleted' });
}
