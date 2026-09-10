import { z } from 'zod';

import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';

const cleanupSchema = z.object({
  scope: z.enum([
    'commissions',
    'conversations',
    'reports',
    'analytics',
    'search_state',
    'marketplace_without_users',
  ]),
  confirmation: z.string(),
});

async function getMaintenanceCounts() {
  const [
    users,
    listings,
    images,
    conversations,
    messages,
    favorites,
    reports,
    commissions,
    analyticsDays,
    analyticsVisitors,
    searchStates,
    idempotencyKeys,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.listing.count(),
    prisma.listingImage.count(),
    prisma.conversation.count(),
    prisma.conversationMessage.count(),
    prisma.favorite.count(),
    prisma.report.count(),
    prisma.commission.count(),
    prisma.siteVisitDaily.count(),
    prisma.siteVisitUnique.count(),
    prisma.marketplaceSearchState.count(),
    prisma.apiIdempotencyKey.count(),
  ]);

  return {
    users,
    listings,
    images,
    conversations,
    messages,
    favorites,
    reports,
    commissions,
    analyticsDays,
    analyticsVisitors,
    searchStates,
    idempotencyKeys,
  };
}

async function runCleanup(scope: z.infer<typeof cleanupSchema>['scope']) {
  if (scope === 'commissions') {
    const result = await prisma.commission.deleteMany();
    return { commissions: result.count };
  }

  if (scope === 'conversations') {
    const result = await prisma.conversation.deleteMany();
    return { conversations: result.count };
  }

  if (scope === 'reports') {
    const result = await prisma.report.deleteMany();
    return { reports: result.count };
  }

  if (scope === 'analytics') {
    const [visitors, days] = await prisma.$transaction([
      prisma.siteVisitUnique.deleteMany(),
      prisma.siteVisitDaily.deleteMany(),
    ]);

    return {
      analyticsVisitors: visitors.count,
      analyticsDays: days.count,
    };
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

  const [listings, searchStates, idempotencyKeys] = await prisma.$transaction([
    prisma.listing.deleteMany(),
    prisma.marketplaceSearchState.deleteMany(),
    prisma.apiIdempotencyKey.deleteMany(),
  ]);

  return {
    listings: listings.count,
    searchStates: searchStates.count,
    idempotencyKeys: idempotencyKeys.count,
  };
}

function requireAdmin(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return { response: Response.json({ error: 'auth_required' }, { status: 401 }) };
  }

  if (!isAdminSession(session)) {
    return { response: Response.json({ error: 'admin_required' }, { status: 403 }) };
  }

  return { session };
}

export async function GET(request: Request) {
  const admin = requireAdmin(request);

  if ('response' in admin) {
    return admin.response;
  }

  return Response.json({ counts: await getMaintenanceCounts() });
}

export async function POST(request: Request) {
  const admin = requireAdmin(request);

  if ('response' in admin) {
    return admin.response;
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
