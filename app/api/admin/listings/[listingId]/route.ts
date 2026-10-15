import { z } from 'zod';

import { createFollowNotificationsForListing } from '@/agent/marketplace/repository';
import { recordDatabaseFirstPublication } from '@/agent/marketplace/listing-publication';
import { deleteListingObject } from '@/agent/marketplace/object-storage';
import { evaluateSaudiMarketplaceCompliance } from '@/agent/marketplace/policy';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notifySellerFollowersOfPublishedListing } from '@/lib/push/follow-notifications';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const maxAdminListingUpdateRequestBytes = 64 * 1024;

const adminListingUpdateSchema = z.object({
  category: z.string().min(2).max(80).optional(),
  title: z.string().min(2).max(140).optional(),
  description: z.string().min(2).max(4000).optional(),
  price: z.number().nonnegative().nullable().optional(),
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

async function notifyFollowersForAdminPublishedListing(listing: {
  id: string;
  sellerId: string;
  title: string | null;
  city: string | null;
}) {
  const followers = await prisma.sellerFollow.findMany({
    where: { sellerId: listing.sellerId },
    select: { followerId: true },
  });
  const followerIds = followers.map((follow) => follow.followerId);

  if (followerIds.length === 0) {
    return;
  }

  await createFollowNotificationsForListing(listing, followerIds);

  publishRealtimeEvent({
    type: 'follow_listing_published',
    payload: {
      listingId: listing.id,
      sellerId: listing.sellerId,
      status: 'published',
    },
    visibility: {
      userIds: followerIds,
    },
  });

  await notifySellerFollowersOfPublishedListing({ listing, followerIds });
}

async function deleteStoredListingImagesBestEffort(
  images: Array<{
    id: string;
    originalUrl: string;
    displayUrl: string;
    thumbnailUrl: string;
  }>,
) {
  await Promise.all(
    images.map(async (image) => {
      try {
        await deleteListingObject({
          imageId: image.id,
          urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl],
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`[admin_listing_storage_delete] failure=${errorName}`);
      }
    }),
  );
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

  const oversizedRequestResponse = rejectOversizedRequest(
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
  const existing = await prisma.listing.findUnique({ where: { id: listingId } });

  if (!existing) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  const nextListing = {
    category: parsed.data.category ?? existing.category,
    title: parsed.data.title ?? existing.title,
    description: parsed.data.description ?? existing.description,
    city: 'city' in parsed.data ? parsed.data.city : existing.city,
    condition:
      'condition' in parsed.data ? parsed.data.condition : existing.condition,
    attributes: existing.attributes,
  };
  const contentChanged = ['category', 'title', 'description', 'city', 'condition'].some(
    (key) => key in parsed.data,
  );
  const compliance = contentChanged
    ? evaluateSaudiMarketplaceCompliance(
        [
          nextListing.category,
          nextListing.title,
          nextListing.description,
          nextListing.city,
          nextListing.condition,
        ]
          .filter(Boolean)
          .join(' '),
      )
    : null;
  const priceMode =
    'priceMode' in parsed.data ? parsed.data.priceMode : existing.priceMode;
  const price =
    'price' in parsed.data
      ? priceMode
        ? null
        : parsed.data.price
      : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.status) {
      await recordDatabaseFirstPublication(tx, listingId, parsed.data.status);
    }
    const listing = await tx.listing.update({
      where: { id: listingId },
      data: {
        category: parsed.data.category,
        title: parsed.data.title,
        description: parsed.data.description,
        city: 'city' in parsed.data ? parsed.data.city : undefined,
        condition:
          'condition' in parsed.data ? parsed.data.condition ?? null : undefined,
        price,
        priceMode,
        status: parsed.data.status,
        searchText: contentChanged ? buildSearchText(nextListing) : undefined,
        compliance: compliance ?? undefined,
      },
    });

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

    return listing;
  });

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

    if (existing.status !== 'published' && updated.status === 'published') {
      await notifyFollowersForAdminPublishedListing(updated);
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
  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      images: true,
    },
  });

  if (!existing) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  if (existing.status !== 'deleted') {
    return Response.json(
      { error: 'listing_must_be_deleted_first' },
      { status: 409 },
    );
  }

  // Permanent delete: cascades to images, conversations, favorites, reports
  // and commissions attached to the listing.
  await prisma.$transaction([
    prisma.listing.delete({ where: { id: listingId } }),
    prisma.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'delete_listing',
        targetType: 'listing',
        targetId: listingId,
        metadata: { operation: 'admin_listing_delete', mode: 'permanent' },
      },
    }),
  ]);

  await deleteStoredListingImagesBestEffort(existing.images);

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
