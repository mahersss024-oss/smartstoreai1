import { z } from 'zod';

import { noStoreHeaders } from '@/lib/api/no-store';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';
import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const maxAdminUserUpdateBytes = 2 * 1024;
const adminUserUpdateSchema = z.object({
  role: z.enum(['user', 'moderator', 'admin']).optional(),
  phoneNumber: z.unknown().optional(),
});

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

function mapUpdatedUser(user: {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  phoneNumber: string | null;
  phoneUpdatedAt: Date | null;
  role: string;
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
    role: user.role,
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

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
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
    !Object.hasOwn(parsed.data, 'phoneNumber')
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
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
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

  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      phoneNumber: true,
    },
  });

  if (!existing) {
    return Response.json(
      { error: 'user_not_found' },
      { status: 404, headers: noStoreHeaders },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminAuditLog.create({
      data: {
        adminId: session.user.id,
        action: 'delete_user',
        targetType: 'user',
        targetId: existing.id,
        metadata: {
          operation: 'admin_user_delete',
          email: existing.email,
          role: existing.role,
          hadPhoneNumber: Boolean(existing.phoneNumber),
        },
      },
    });

    await tx.user.delete({
      where: { id: existing.id },
    });
  });

  return Response.json(
    {
      status: 'deleted',
      userId: existing.id,
    },
    { headers: noStoreHeaders },
  );
}
