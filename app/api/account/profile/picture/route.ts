import { randomUUID } from 'node:crypto';

import { createPersistentProfileImageUrl } from '@/agent/marketplace/profile-image-storage';
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

function shouldPersistUserProfile() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
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
    picture = await createPersistentProfileImageUrl({
      data: new Uint8Array(await file.arrayBuffer()),
      mediaType: file.type,
      imageId: randomUUID(),
      fileName: file.name,
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

  const existingUserByEmail = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
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
