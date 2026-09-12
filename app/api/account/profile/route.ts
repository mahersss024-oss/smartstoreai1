import { NextResponse } from 'next/server';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { normalizeContactPhoneNumber } from '@/lib/auth/contact-profile';
import {
  clearSessionCookie,
  getAuthSession,
  getConfiguredRoleForEmail,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const maxProfileRequestBytes = 2 * 1024;

function shouldPersistUserProfile() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export async function PATCH(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return NextResponse.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to update account data.',
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
    phoneNumber?: unknown;
  } | null;
  const phoneValidation = normalizeContactPhoneNumber(body?.phoneNumber);

  if (!phoneValidation.ok) {
    return NextResponse.json(
      {
        error: 'invalid_phone_number',
        message: phoneValidation.message,
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
  const session = getAuthSession(request);

  if (!session) {
    return NextResponse.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to delete account data.',
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
    await prisma.user.delete({
      where: { id: user.id },
    });
  }

  const response = NextResponse.json(
    { status: 'deleted' },
    { headers: noStoreHeaders },
  );
  response.headers.append('Set-Cookie', clearSessionCookie());

  return response;
}
