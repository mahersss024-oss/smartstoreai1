import { randomUUID } from 'node:crypto';

import { enqueueImageObjectCleanup, processImageObjectCleanup, profileImageCleanupInput } from '@/agent/marketplace/image-object-cleanup';
import {
  canUseProfileImageDataUrlFallback,
  createPersistentProfileImageUrl,
} from '@/agent/marketplace/profile-image-storage';
import {
  createSanitizedListingImageOriginal,
  ListingImageSecurityError,
} from '@/agent/marketplace/listing-image-variants';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import {
  getAuthSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { lockActiveProfileUser } from '@/lib/auth/profile-account';

export const dynamic = 'force-dynamic';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
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
  const cleanup = profileImageCleanupInput(userId, picture);
  if (!cleanup) return;

  try {
    await enqueueImageObjectCleanup(prisma, cleanup);
    await processImageObjectCleanup(cleanup.imageId);
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
  const ownerId = session.user.id;
  const existingUser = await prisma.user.findUnique({ where: { id: ownerId } });
  if (!existingUser || existingUser.deletedAt) {
    return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  }

  try {
    const originalData = new Uint8Array(await file.arrayBuffer());
    const sanitizedProfileImage = await createSanitizedListingImageOriginal({
      data: originalData,
      mediaType: file.type,
      fileName: file.name,
    });
    picture = await createPersistentProfileImageUrl({
      data: sanitizedProfileImage.data,
      mediaType: sanitizedProfileImage.mediaType,
      imageId: randomUUID(),
      ownerId,
      fileName: sanitizedProfileImage.fileName,
    });
  } catch (error) {
    if (error instanceof ListingImageSecurityError) {
      const status =
        error.code === 'unsupported_image_type' ||
        error.code === 'image_type_mismatch'
          ? 415
          : 422;

      return Response.json(
        {
          error: error.code,
          message: 'Profile picture could not be accepted after server security checks.',
        },
        { status, headers: noStoreHeaders },
      );
    }

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
    await deletePreviousProfilePictureBestEffort(ownerId, picture);

    return Response.json(
      {
        error: 'profile_picture_delivery_unavailable',
        message: 'Profile picture storage is not reachable from the public image domain.',
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let previousPicture: string | null | undefined;
  let user;
  try {
    user = await prisma.$transaction(async tx => {
      const current = await lockActiveProfileUser(tx, ownerId);
      if (!current) return null;
      previousPicture = current.picture;
      const saved = await tx.user.update({ where: { id: ownerId }, data: { picture } });
      const cleanup = profileImageCleanupInput(saved.id, previousPicture);
      if (cleanup && previousPicture !== picture) await enqueueImageObjectCleanup(tx, cleanup);
      return saved;
    });
  } catch (error) {
    await deletePreviousProfilePictureBestEffort(ownerId, picture);
    throw error;
  }

  if (!user) {
    await deletePreviousProfilePictureBestEffort(ownerId, picture);
    return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  }

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

  let previousPicture: string | null | undefined;
  const user = await prisma.$transaction(async tx => {
    const current = await lockActiveProfileUser(tx, session.user.id);
    if (!current) return null;
    previousPicture = current.picture;
    const cleanup = profileImageCleanupInput(current.id, previousPicture);
    if (cleanup) await enqueueImageObjectCleanup(tx, cleanup);
    return tx.user.update({ where: { id: current.id }, data: { picture: null } });
  });
  if (!user) {
    return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  }

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
