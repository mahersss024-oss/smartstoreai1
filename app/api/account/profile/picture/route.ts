import { randomUUID } from 'node:crypto';

import { deleteListingObject } from '@/agent/marketplace/object-storage';
import {
  canUseProfileImageDataUrlFallback,
  createPersistentProfileImageUrl,
} from '@/agent/marketplace/profile-image-storage';
import { createListingImageVariants } from '@/agent/marketplace/listing-image-variants';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import {
  getAuthSession,
  getConfiguredRoleForEmail,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const maxProfileImageBytes = 4 * 1024 * 1024;
const maxProfileImageRequestBytes = maxProfileImageBytes + 256 * 1024;
const profileImageDeliveryTimeoutMs = 5_000;

function shouldPersistUserProfile() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

async function deletePreviousProfilePictureBestEffort(
  userId: string,
  picture: string | null | undefined,
) {
  if (!picture) {
    return;
  }

  try {
    await deleteListingObject({
      imageId: `profile:${userId}`,
      urls: [picture],
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[profile_picture_storage_delete] failure=${errorName}`);
  }
}

async function verifyProfilePictureDelivery(picture: string) {
  if (picture.startsWith('data:')) {
    return canUseProfileImageDataUrlFallback();
  }

  try {
    const response = await fetch(picture, {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(profileImageDeliveryTimeoutMs),
    });

    return response.ok && response.headers.get('content-type')?.startsWith('image/');
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to update account picture.',
      },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'account_profile_picture_upload',
    actorId: session.user.id,
    maxRequests: 10,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversized = rejectOversizedRequest(
    request,
    maxProfileImageRequestBytes,
    'Profile picture upload request body is too large.',
  );

  if (oversized) {
    return oversized;
  }

  if (!shouldPersistUserProfile()) {
    return Response.json(
      {
        error: 'profile_storage_unavailable',
        message: 'Account profile storage is not configured.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: 'invalid_multipart_form_data' },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const file = formData.get('image');

  if (!(file instanceof File)) {
    return Response.json(
      { error: 'missing_image' },
      { status: 400, headers: noStoreHeaders },
    );
  }

  if (!supportedMimeTypes.has(file.type)) {
    return Response.json(
      { error: 'unsupported_image_type' },
      { status: 415, headers: noStoreHeaders },
    );
  }

  if (file.size > maxProfileImageBytes) {
    return Response.json(
      { error: 'image_too_large' },
      { status: 413, headers: noStoreHeaders },
    );
  }

  let picture: string | null;

  try {
    const originalData = new Uint8Array(await file.arrayBuffer());
    const variants = await createListingImageVariants({
      data: originalData,
      mediaType: file.type,
      fileName: file.name,
    });
    const profileData = variants?.thumbnail.data ?? originalData;
    const profileMediaType = variants?.thumbnail.mediaType ?? file.type;
    const profileFileName = variants?.thumbnail.fileName ?? file.name;
    picture = await createPersistentProfileImageUrl({
      data: profileData,
      mediaType: profileMediaType,
      imageId: randomUUID(),
      fileName: profileFileName,
    });
  } catch {
    return Response.json(
      {
        error: 'image_storage_unavailable',
        message: 'Profile picture storage is unavailable.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  if (!picture) {
    return Response.json(
      { error: 'unsupported_image_type' },
      { status: 415, headers: noStoreHeaders },
    );
  }

  if (!(await verifyProfilePictureDelivery(picture))) {
    await deletePreviousProfilePictureBestEffort(session.user.id, picture);

    return Response.json(
      {
        error: 'profile_picture_delivery_unavailable',
        message: 'Profile picture storage is not reachable from the public image domain.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const existingUserByEmail = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  const previousPicture = existingUserByEmail?.picture;
  const user =
    existingUserByEmail && existingUserByEmail.id !== session.user.id
      ? await prisma.user.update({
          where: { email: session.user.email },
          data: { picture },
        })
      : await prisma.user.upsert({
          where: { id: session.user.id },
          create: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name,
            picture,
            role:
              session.user.role ??
              getConfiguredRoleForEmail(session.user.email),
          },
          update: { picture },
        });

  if (previousPicture && previousPicture !== picture) {
    await deletePreviousProfilePictureBestEffort(user.id, previousPicture);
  }

  return Response.json(
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
    { status: 201, headers: noStoreHeaders },
  );
}

export async function DELETE(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to remove account picture.',
      },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'account_profile_picture_delete',
    actorId: session.user.id,
    maxRequests: 10,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!shouldPersistUserProfile()) {
    return Response.json(
      {
        error: 'profile_storage_unavailable',
        message: 'Account profile storage is not configured.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ id: session.user.id }, { email: session.user.email }],
    },
  });

  if (!existingUser) {
    return Response.json(
      { error: 'account_not_found' },
      { status: 404, headers: noStoreHeaders },
    );
  }

  const previousPicture = existingUser.picture;
  const user = await prisma.user.update({
    where: { id: existingUser.id },
    data: { picture: null },
  });

  await deletePreviousProfilePictureBestEffort(user.id, previousPicture);

  return Response.json(
    {
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? undefined,
        picture: undefined,
        role: user.role,
        phoneNumber: user.phoneNumber ?? undefined,
      },
    },
    { headers: noStoreHeaders },
  );
}
