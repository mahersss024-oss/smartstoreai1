import { NextResponse } from 'next/server';
import { hasProtectedUserEvidence, lockUserEvidenceEntities, withEvidenceProtection } from '@/agent/marketplace/evidence';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';
import { getRegistrationIdentityEmail, selfAccountDeletionOperation } from '@/lib/auth/registration';
import {
  clearSessionCookie,
  getAuthSession,
  getConfiguredRoleForEmail,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const maxProfileRequestBytes = 5 * 1024;

function normalizeProfileDisplayName(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const name = value.replace(/\s+/g, ' ').trim();

  if (!name) {
    return null;
  }

  if (name.length > 80) {
    return { error: 'Display name must be 80 characters or less.' } as const;
  }

  return name;
}

function normalizeProfilePictureUrl(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const picture = value.trim();

  if (!picture) {
    return null;
  }

  if (picture.length > 2048) {
    return { error: 'Profile picture URL is too long.' } as const;
  }

  try {
    const url = new URL(picture);

    if (url.protocol !== 'https:') {
      return { error: 'Profile picture URL must start with https.' } as const;
    }

    return url.toString();
  } catch {
    return { error: 'Profile picture URL is invalid.' } as const;
  }
}

function shouldPersistUserProfile() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export async function PATCH(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return NextResponse.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to update account data.',
      },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'account_profile_update',
    actorId: session.user.id,
    maxRequests: 20,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversized = rejectOversizedRequest(
    request,
    maxProfileRequestBytes,
    'Account profile request body is too large.',
  );

  if (oversized) {
    return oversized;
  }

  const body = (await request.json().catch(() => null)) as {
    displayName?: unknown;
    phoneNumber?: unknown;
    picture?: unknown;
  } | null;
  const phoneValidation = normalizeContactPhoneNumber(body?.phoneNumber);
  const displayName = normalizeProfileDisplayName(body?.displayName);
  const picture = normalizeProfilePictureUrl(body?.picture);

  if (!phoneValidation.ok) {
    return NextResponse.json(
      {
        error: 'invalid_phone_number',
        message: phoneValidation.message,
      },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (displayName && typeof displayName === 'object') {
    return NextResponse.json(
      {
        error: 'invalid_display_name',
        message: displayName.error,
      },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (picture && typeof picture === 'object') {
    return NextResponse.json(
      {
        error: 'invalid_profile_picture',
        message: picture.error,
      },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (!shouldPersistUserProfile()) {
    return NextResponse.json(
      {
        error: 'profile_storage_unavailable',
        message: 'Account profile storage is not configured.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const now = new Date();
  const profileData = {
    phoneNumber: phoneValidation.phoneNumber,
    phoneUpdatedAt: phoneValidation.phoneNumber ? now : null,
    ...(displayName !== undefined ? { name: displayName } : {}),
    ...(picture !== undefined ? { picture } : {}),
  };
  const existingUserByEmail = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  const user =
    existingUserByEmail && existingUserByEmail.id !== session.user.id
      ? await prisma.user.update({
          where: { email: session.user.email },
          data: profileData,
        })
      : await prisma.user.upsert({
          where: { id: session.user.id },
          create: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            picture: session.user.picture,
            role:
              session.user.role ??
              getConfiguredRoleForEmail(session.user.email),
            ...profileData,
          },
          update: profileData,
        });

  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        picture: user.picture ?? undefined,
        role: user.role,
        phoneNumber: user.phoneNumber ?? undefined,
      },
    },
    { headers: noStoreHeaders },
  );
}

export async function DELETE(request: Request) {
  return withEvidenceProtection(deleteProfile)(request);
}

async function deleteProfile(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return NextResponse.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to delete account data.',
      },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'account_profile_delete',
    actorId: session.user.id,
    maxRequests: 5,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!shouldPersistUserProfile()) {
    return NextResponse.json(
      {
        error: 'profile_storage_unavailable',
        message: 'Account profile storage is not configured.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ id: session.user.id }, { email: session.user.email }],
    },
    select: { id: true },
  });

  if (user) {
    await prisma.$transaction(async tx => {
      await lockUserEvidenceEntities(tx, user.id);
      await tx.$executeRaw`SELECT 1 FROM "User" WHERE id = ${user.id} FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.deletedAt) return;
      const email = await getRegistrationIdentityEmail(tx, current);
      const deletedAt = new Date();
      const retained = await hasProtectedUserEvidence(user.id, tx);
      await tx.adminAuditLog.create({ data: {
        adminId: null, action: 'delete_user', targetType: 'user', targetId: user.id,
        metadata: {
          operation: selfAccountDeletionOperation, actorId: session.user.id,
          email, deletedAt: deletedAt.toISOString(), mode: retained ? 'retained' : 'permanent',
        },
      } });
      if (retained) {
        await tx.user.update({ where: { id: user.id }, data: { deletedAt } });
        await tx.listing.updateMany({ where: { sellerId: user.id, status: { not: 'deleted' } }, data: { status: 'deleted' } });
        await tx.conversation.updateMany({ where: { OR: [{ sellerId: user.id }, { buyerId: user.id }] }, data: { status: 'closed' } });
        await tx.pushSubscription.deleteMany({ where: { userId: user.id } });
        await tx.mobilePushToken.deleteMany({ where: { userId: user.id } });
      } else {
        await tx.user.delete({ where: { id: user.id } });
      }
    });
  }

  const response = NextResponse.json(
    { status: 'deleted' },
    { headers: noStoreHeaders },
  );
  response.headers.append('Set-Cookie', clearSessionCookie());

  return response;
}
