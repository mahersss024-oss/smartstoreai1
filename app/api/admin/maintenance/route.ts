import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { deleteListingObject } from '@/agent/marketplace/object-storage';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const maxMaintenanceCleanupRequestBytes = 4 * 1024;
const searchStateCleanupMaxAgeMs = 24 * 60 * 60 * 1000;

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

async function runCleanup(
  scope: z.infer<typeof cleanupSchema>['scope'],
  database: Prisma.TransactionClient,
) {
  if (scope === 'closed_reports') {
    const result = await database.report.deleteMany({
      where: { status: { in: ['reviewed', 'dismissed'] } },
    });
    return { deleted: { closedReports: result.count }, images: [] };
  }

  if (scope === 'closed_user_reports') {
    const result = await database.userReport.deleteMany({
      where: { status: { in: ['reviewed', 'dismissed'] } },
    });
    return { deleted: { closedUserReports: result.count }, images: [] };
  }

  if (scope === 'search_state') {
    const searchStates = await database.marketplaceSearchState.deleteMany({
      where: {
        updatedAt: {
          lt: new Date(Date.now() - searchStateCleanupMaxAgeMs),
        },
      },
    });

    return {
      deleted: {
        searchStates: searchStates.count,
        idempotencyKeys: 0,
      },
      images: [],
    };
  }

  if (scope === 'purge_deleted_listings') {
    const deletedListings = await database.listing.findMany({
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
    const result = await database.listing.deleteMany({
      where: { status: 'deleted' },
    });

    return {
      deleted: { listings: result.count },
      images: deletedListings.flatMap((listing) => listing.images),
    };
  }

  throw new Error('unsupported_cleanup_scope');
}

async function requireAdmin(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return { response: Response.json({ error: 'auth_required' }, { status: 401 }) };
  }

  if (!(await hasVerifiedAdminAccess(session))) {
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

  const cleanup = await prisma.$transaction(async (tx) => {
    const result = await runCleanup(parsed.data.scope, tx);
    await tx.adminAuditLog.create({
      data: {
        adminId: admin.session.user.id,
        action: 'maintenance_cleanup',
        targetType: 'maintenance',
        targetId: parsed.data.scope,
        metadata: {
          operation: 'admin_cleanup',
          deleted: result.deleted,
        },
      },
    });
    return result;
  });

  await deleteStoredListingImagesBestEffort(cleanup.images);

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
    deleted: cleanup.deleted,
    counts: await getMaintenanceCounts(),
  });
}
