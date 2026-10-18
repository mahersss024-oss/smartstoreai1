import { z } from 'zod';
import { withEvidenceProtection } from '@/agent/marketplace/evidence';

import { deleteListingObject } from '@/agent/marketplace/object-storage';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import {
  hasVerifiedAdminAccess,
} from '@/lib/auth/authorization';
import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';
import { getRegistrationIdentityEmail } from '@/lib/auth/registration';
import { getAuthSession, isConfiguredAdminEmail } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const maxAdminUserUpdateBytes = 2 * 1024;
const adminUserUpdateSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']).optional(),
  phoneNumber: z.unknown().optional(),
  accountStatus: z.literal('active').optional(),
});

type StoredUserImage = {
  id: string;
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

async function deleteUserImagesBestEffort(
  userId: string,
  profilePicture: string | null,
  listingImages: StoredUserImage[],
) {
  const objects = [
    ...(profilePicture
      ? [{ imageId: `profile:${userId}`, urls: [profilePicture] }]
      : []),
    ...listingImages.map((image) => ({
      imageId: image.id,
      urls: [image.originalUrl, image.displayUrl, image.thumbnailUrl],
    })),
  ];

  await Promise.all(
    objects.map(async (object) => {
      try {
        await deleteListingObject(object);
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`[admin_user_image_storage_delete] failure=${errorName}`);
      }
    }),
  );
}

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

async function enforceAdminMutationRateLimit(
  request: Request,
  adminId: string,
) {
  return enforceApiRateLimit(request, {
    namespace: 'admin_user_mutation',
    actorId: adminId,
    maxRequests: 40,
    windowMs: 60_000,
  });
}

function mapUpdatedUser(user: {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  phoneNumber: string | null;
  phoneUpdatedAt: Date | null;
  role: string;
  deletedAt: Date | null;
  commissionAgreementVersion: string | null;
  commissionAgreementAccepted: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    listings: number;
    buyerConversations: number;
    sellerConversations: number;
    messages: number;
    favorites: number;
    reports: number;
    userReportsReceived: number;
    commissions: number;
    pushSubscriptions: number;
  };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    picture: user.picture ?? undefined,
        phoneNumber: user.phoneNumber ?? undefined,
    phoneUpdatedAt: user.phoneUpdatedAt?.toISOString() ?? undefined,
    role: isConfiguredAdminEmail(user.email) ? 'owner' : user.role,
    deletedAt: user.deletedAt?.toISOString() ?? undefined,
    commissionAgreementVersion: user.commissionAgreementVersion ?? undefined,
    commissionAgreementAccepted:
      user.commissionAgreementAccepted?.toISOString() ?? undefined,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    counts: {
      listings: user._count.listings,
      conversations:
        user._count.buyerConversations + user._count.sellerConversations,
      messages: user._count.messages,
      favorites: user._count.favorites,
      reports: user._count.reports,
      userReportsReceived: user._count.userReportsReceived,
      commissions: user._count.commissions,
      pushSubscriptions: user._count.pushSubscriptions,
    },
  };
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversized = rejectOversizedRequest(
    request,
    maxAdminUserUpdateBytes,
    'Admin user update request body is too large.',
  );

  if (oversized) {
    return oversized;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = adminUserUpdateSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (
    parsed.data.role === undefined &&
    !Object.hasOwn(parsed.data, 'phoneNumber') &&
    parsed.data.accountStatus === undefined
  ) {
    return Response.json({ error: 'empty_update' }, { status: 400 });
  }

  const { userId } = await context.params;
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (!existing) {
    return Response.json(
      { error: 'user_not_found' },
      { status: 404, headers: noStoreHeaders },
    );
  }

  const hasOwnerLevelAdminAccess = await hasVerifiedAdminAccess(session);

  if (parsed.data.role !== undefined && !hasOwnerLevelAdminAccess) {
    return Response.json(
      {
        error: 'owner_required',
        message: 'Only the platform owner can change user roles.',
      },
      { status: 403, headers: noStoreHeaders },
    );
  }

  if (parsed.data.accountStatus !== undefined && !hasOwnerLevelAdminAccess) {
    return Response.json(
      {
        error: 'owner_required',
        message: 'Only the platform owner can reactivate accounts.',
      },
      { status: 403, headers: noStoreHeaders },
    );
  }

  const identityEmail = await getRegistrationIdentityEmail(prisma, existing);
  if (isConfiguredAdminEmail(identityEmail)) {
    return Response.json(
      {
        error: 'owner_account_protected',
        message: 'The platform owner account cannot be modified.',
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  if (
    existing.id === session.user.id &&
    parsed.data.role !== undefined &&
    parsed.data.role !== 'admin'
  ) {
    return Response.json(
      {
        error: 'cannot_downgrade_self',
        message: 'The active admin cannot remove their own admin role.',
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const phoneValidation = Object.hasOwn(parsed.data, 'phoneNumber')
    ? normalizeContactPhoneNumber(parsed.data.phoneNumber)
    : null;

  if (phoneValidation && !phoneValidation.ok) {
    return Response.json(
      {
        error: 'invalid_phone_number',
        message: phoneValidation.message,
      },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        role: parsed.data.role,
        phoneNumber: phoneValidation?.phoneNumber,
        phoneUpdatedAt: phoneValidation
          ? phoneValidation.phoneNumber
            ? now
            : null
          : undefined,
        deletedAt:
          parsed.data.accountStatus === 'active' ? null : undefined,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'update_user',
        targetType: 'user',
        targetId: userId,
        metadata: {
          operation: 'admin_user_update',
          previous: {
            role: existing.role,
            phoneNumber: existing.phoneNumber,
          },
          updates: {
            role: parsed.data.role,
            phoneNumber: phoneValidation?.phoneNumber,
            accountStatus: parsed.data.accountStatus,
          },
        },
      },
    });

    return tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        phoneNumber: true,
        phoneUpdatedAt: true,
        role: true,
        deletedAt: true,
        commissionAgreementVersion: true,
        commissionAgreementAccepted: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            listings: true,
            buyerConversations: true,
            sellerConversations: true,
            messages: true,
            favorites: true,
            reports: true,
            userReportsReceived: true,
            commissions: true,
            pushSubscriptions: true,
          },
        },
      },
    });
  });

  return Response.json({ user: mapUpdatedUser(updated) }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withEvidenceProtection(deleteUser)(request, context);
}

async function deleteUser(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedAdminAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const rateLimitResponse = await enforceAdminMutationRateLimit(
    request,
    session.user.id,
  );

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

    const { userId } = await context.params;

  if (userId === session.user.id) {
    return Response.json(
      {
        error: 'cannot_delete_self',
        message: 'The active admin cannot delete their own account.',
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const requestedMode = new URL(request.url).searchParams.get('mode') ?? 'soft';

  if (requestedMode !== 'soft' && requestedMode !== 'permanent') {
    return Response.json(
      { error: 'invalid_delete_mode' },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      picture: true,
      role: true,
      phoneNumber: true,
      deletedAt: true,
      listings: {
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
      },
    },
  });

  if (!existing) {
    return Response.json(
      { error: 'user_not_found' },
      { status: 404, headers: noStoreHeaders },
    );
  }

  const identityEmail = await getRegistrationIdentityEmail(prisma, existing);
  if (isConfiguredAdminEmail(identityEmail)) {
    return Response.json(
      {
        error: 'owner_account_protected',
        message: 'The platform owner account cannot be deleted.',
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const hasOwnerLevelAdminAccess = await hasVerifiedAdminAccess(session);

  if (requestedMode === 'permanent' && !hasOwnerLevelAdminAccess) {
    return Response.json(
      {
        error: 'owner_required',
        message: 'Only the platform owner can permanently delete accounts.',
      },
      { status: 403, headers: noStoreHeaders },
    );
  }

  if (requestedMode === 'permanent' && !existing.deletedAt) {
    return Response.json(
      {
        error: 'account_must_be_disabled_first',
        message: 'The account must be disabled before permanent deletion.',
      },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const deleteMode = requestedMode;
  const storedListingImages = existing.listings.flatMap(
    (listing) => listing.images,
  );

  await prisma.$transaction(async (tx) => {
    await tx.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'delete_user',
        targetType: 'user',
        targetId: existing.id,
        metadata: {
          operation: 'admin_user_delete',
          mode: deleteMode,
          email: identityEmail,
          role: existing.role,
          hadPhoneNumber: Boolean(existing.phoneNumber),
        },
      },
    });

    if (deleteMode === 'permanent') {
      await tx.user.delete({
        where: { id: existing.id },
      });
      return;
    }

    await tx.user.update({
      where: { id: existing.id },
      data: { deletedAt: existing.deletedAt ?? new Date() },
    });
  });

  if (deleteMode === 'permanent') {
    await deleteUserImagesBestEffort(
      existing.id,
      existing.picture,
      storedListingImages,
    );
  }

  return Response.json(
    {
      status: deleteMode === 'permanent' ? 'deleted' : 'soft_deleted',
      mode: deleteMode,
      userId: existing.id,
    },
    { headers: noStoreHeaders },
  );
}
