import { z } from 'zod';

import { evaluateSaudiMarketplaceCompliance } from '@/agent/marketplace/policy';
import { normalizeMarketplaceSearchText } from '@/agent/marketplace/search';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const adminListingUpdateSchema = z.object({
  category: z.string().min(2).optional(),
  title: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  price: z.number().nonnegative().nullable().optional(),
  priceMode: z.enum(['bid', 'negotiable']).nullable().optional(),
  city: z.string().min(2).nullable().optional(),
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

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
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
          parsed.data.status === 'deleted' ? 'delete_listing' : 'approve_listing',
        targetType: 'listing',
        targetId: listingId,
        metadata: {
          operation: 'admin_listing_update',
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

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const { listingId } = await context.params;
  const existing = await prisma.listing.findUnique({ where: { id: listingId } });

  if (!existing) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  await prisma.$transaction([
    prisma.listing.update({
      where: { id: listingId },
      data: { status: 'deleted' },
    }),
    prisma.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'delete_listing',
        targetType: 'listing',
        targetId: listingId,
        metadata: { operation: 'admin_listing_delete' },
      },
    }),
  ]);

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

  return Response.json({ status: 'deleted' });
}
