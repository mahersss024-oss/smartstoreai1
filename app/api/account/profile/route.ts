import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { hasProtectedUserEvidence, lockUserEvidenceEntities, withEvidenceProtection } from '@/agent/marketplace/evidence';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';
import { lockActiveProfileUser } from '@/lib/auth/profile-account';
import { getRegistrationIdentityEmail, selfAccountDeletionOperation } from '@/lib/auth/registration';
import {
  clearSessionCookie,
  getAuthSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isConfiguredImageObjectUrl, isOwnedProfileImageUrl } from '@/agent/marketplace/object-storage';

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
  const result = await prisma.$transaction(async tx => {
    const current = await lockActiveProfileUser(tx, session.user.id);
    if (!current) return { error: 'auth_required' } as const;
    // Existing provider/legacy references may be retained. New first-party
    // references must belong to the authenticated account, never an email match.
    if (typeof picture === 'string' && picture !== current.picture &&
        isConfiguredImageObjectUrl(picture) && !isOwnedProfileImageUrl(current.id, picture)) {
      return { error: 'invalid_profile_picture' } as const;
    }
    return { user: await tx.user.update({ where: { id: current.id }, data: profileData }) };
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, {
      status: result.error === 'auth_required' ? 401 : 400,
      headers: noStoreHeaders,
    });
  }
  const { user } = result;

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

  // Retry serialization/deadlock conflicts with concurrent listing sales. The
  // transaction either preserves the ledger or commits the entire deletion.
  for (let attempt = 0; ; attempt++) {
    try {
      await prisma.$transaction(async tx => {
        const userId = session.user.id;
        await lockUserEvidenceEntities(tx, userId);
        // Sales lock Listing before their Commission insert checks the User FK.
        // Keep that order here, then re-read both account and ledger under lock.
        await tx.$executeRaw`SELECT id FROM "Listing" WHERE "sellerId" = ${userId} ORDER BY id FOR UPDATE`;
        const current = await lockActiveProfileUser(tx, userId);
        if (!current) return;
        const email = await getRegistrationIdentityEmail(tx, current);
        const deletedAt = new Date();
        const [protectedEvidence, financialRecord] = await Promise.all([
          hasProtectedUserEvidence(userId, tx),
          tx.commission.findFirst({ where: { sellerId: userId }, select: { id: true } }),
        ]);
        // Paid and waived records are financial history too. No self-service
        // deletion may cascade away an existing commission or its sold listing.
        const retained = protectedEvidence || Boolean(financialRecord);
        await tx.adminAuditLog.create({ data: {
          adminId: null, action: 'delete_user', targetType: 'user', targetId: userId,
          metadata: {
            operation: selfAccountDeletionOperation, actorId: session.user.id,
            email, deletedAt: deletedAt.toISOString(), mode: retained ? 'retained' : 'permanent',
            protectedEvidence, financialRecordsRetained: Boolean(financialRecord),
          },
        } });
        if (retained) {
          await tx.user.update({ where: { id: userId }, data: { deletedAt } });
          await tx.listing.updateMany({ where: { sellerId: userId, status: { not: 'deleted' } }, data: { status: 'deleted' } });
          await tx.conversation.updateMany({ where: { OR: [{ sellerId: userId }, { buyerId: userId }] }, data: { status: 'closed' } });
          await tx.pushSubscription.deleteMany({ where: { userId } });
          await tx.mobilePushToken.deleteMany({ where: { userId } });
        } else {
          await tx.user.delete({ where: { id: userId } });
        }
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      break;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const metadata = error && typeof error === 'object' && 'meta' in error ? error.meta : undefined;
      const sqlState = metadata && typeof metadata === 'object' && 'code' in metadata ? metadata.code : undefined;
      if (attempt < 2 && (code === 'P2034' ||
          (code === 'P2010' && (sqlState === '40P01' || sqlState === '40001')))) continue;
      throw error;
    }
  }

  const response = NextResponse.json(
    { status: 'deleted' },
    { headers: noStoreHeaders },
  );
  response.headers.append('Set-Cookie', clearSessionCookie());

  return response;
}
