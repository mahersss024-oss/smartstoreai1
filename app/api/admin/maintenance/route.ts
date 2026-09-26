import { z } from 'zod';

import { deleteListingObject } from '@/agent/marketplace/object-storage';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasPlatformOwnerAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const maxMaintenanceCleanupRequestBytes = 4 * 1024;

const cleanupSchema = z.object({
  scope: z.enum([
    'closed_reports',
    'closed_user_reports',
    'search_state',
    'purge_deleted_listings',
  ]),
  confirmation: z.string(),
});

type StoredListingImage = {
  id: string;
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

async function deleteStoredListingImagesBestEffort(images: StoredListingImage[]) {
  await Promise.all(
    images.map(async (image) => {
      try {
        await deleteListingObject({
          imageId: image.id,
          urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl],
        });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`[admin_maintenance_listing_storage_delete] failure=${errorName}`);
      }
    }),
  );
}

async function getMaintenanceCounts() {
  const [
    deletedListings,
    deletedListingImages,
    closedReports,
    closedUserReports,
    searchStates,
    idempotencyKeys,
  ] = await Promise.all([
    prisma.listing.count({ where: { status: 'deleted' } }),
    prisma.listingImage.count({
      where: { listing: { status: 'deleted' } },
    }),
    prisma.report.count({ where: { status: { in: ['reviewed', 'dismissed'] } } }),
    prisma.userReport.count({ where: { status: { in: ['reviewed', 'dismissed'] } } }),
    prisma.marketplaceSearchState.count(),
    prisma.apiIdempotencyKey.count(),
  ]);

  return {
    deletedListings,
    deletedListingImages,
    closedReports,
    closedUserReports,
    searchStates,
    idempotencyKeys,
  };
}

async function runCleanup(scope: z.infer<typeof cleanupSchema>['scope']) {
  if (scope === 'closed_reports') {
    const result = await prisma.report.deleteMany({
      where: { status: { in: ['reviewed', 'dismissed'] } },
    });
    return { closedReports: result.count };
  }

  if (scope === 'closed_user_reports') {
    const result = await prisma.userReport.deleteMany({
      where: { status: { in: ['reviewed', 'dismissed'] } },
    });
    return { closedUserReports: result.count };
  }

  if (scope === 'search_state') {
    const [searchStates, idempotencyKeys] = await prisma.$transaction([
      prisma.marketplaceSearchState.deleteMany(),
      prisma.apiIdempotencyKey.deleteMany(),
    ]);

    return {
      searchStates: searchStates.count,
      idempotencyKeys: idempotencyKeys.count,
    };
  }

  if (scope === 'purge_deleted_listings') {
    const deletedListings = await prisma.listing.findMany({
      where: { status: 'deleted' },
      select: {
        images: {
          select: {
            id: true,
            originalUrl: true,
            displayUrl: true,
            thumbnailUrl: true,
          },
        },
      },
    });
    const result = await prisma.listing.deleteMany({
      where: { status: 'deleted' },
    });

    await deleteStoredListingImagesBestEffort(
      deletedListings.flatMap((listing) => listing.images),
    );

    return { listings: result.count };
  }

  throw new Error('unsupported_cleanup_scope');
}

async function requireAdmin(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return { response: Response.json({ error: 'auth_required' }, { status: 401 }) };
  }

    if (!(await hasPlatformOwnerAccess(session))) {
    return {
      response: Response.json({ error: 'owner_required' }, { status: 403 }),
    };
  }

  return { session };
}

function isDestructiveMaintenanceEnabled() {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP === '1'
  );
}

export async function GET(request: Request) {
  const admin = await requireAdmin(request);

  if ('response' in admin) {
    return admin.response;
  }

  return Response.json({ counts: await getMaintenanceCounts() });
}

export async function POST(request: Request) {
  const admin = await requireAdmin(request);

  if ('response' in admin) {
    return admin.response;
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'admin_maintenance_cleanup',
    actorId: admin.session.user.id,
    maxRequests: 12,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!isDestructiveMaintenanceEnabled()) {
    return Response.json(
      {
        error: 'maintenance_cleanup_disabled',
        message:
          'Destructive maintenance cleanup is disabled in production.',
      },
      { status: 403 },
    );
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxMaintenanceCleanupRequestBytes,
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

  const parsed = cleanupSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.confirmation.trim() !== 'تنظيف') {
    return Response.json({ error: 'confirmation_required' }, { status: 400 });
  }

  const deleted = await runCleanup(parsed.data.scope);

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.session.user.id,
      action: 'delete_listing',
      targetType: 'maintenance',
      targetId: parsed.data.scope,
      metadata: {
        operation: 'admin_cleanup',
        deleted,
      },
    },
  });

  try {
    publishRealtimeEvent({
      type: 'maintenance_cleanup',
      payload: {
        scope: parsed.data.scope,
      },
      visibility: {
        includePublic: true,
        includeAdmins: true,
      },
    });
  } catch {
    // Cleanup completion should not fail due to realtime publish.
  }

  return Response.json({
    status: 'completed',
    deleted,
    counts: await getMaintenanceCounts(),
  });
}
