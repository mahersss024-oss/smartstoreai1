import { randomUUID } from 'node:crypto';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { reviewListingImageContent } from '@/agent/marketplace/listing-image-content';
import {
  getMaxListingImagesPerListing,
  hasReachedListingImageLimit,
} from '@/agent/marketplace/listing-image-limits';
import { discardUnattachedListingImage, storeListingImageDelivery } from '@/agent/marketplace/listing-image-storage';
import {
  createListingImageVariants,
  createSanitizedListingImageOriginal,
  ListingImageSecurityError,
} from '@/agent/marketplace/listing-image-variants';
import {
  addListingImageForSeller,
  getListing,
} from '@/agent/marketplace/repository';
import type { ListingImage } from '@/agent/marketplace/types';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';
import {
  incrementRuntimeCounter,
  recordRuntimeDurationMs,
} from '@/lib/observability/runtime-metrics';

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maxImageBytes = 12 * 1024 * 1024;
const maxImageUploadRequestBytes = maxImageBytes + 1024 * 1024;

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const startedAt = Date.now();
  incrementRuntimeCounter('listing.image_upload.attempt');
  const session = getAuthSession(request);

  if (!session) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'auth_required',
    });
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to upload listing images.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'image_upload',
    actorId: session.user.id,
    maxRequests: 10,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'rate_limit',
    });
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxImageUploadRequestBytes,
    'Image upload request body is too large.',
  );

  if (oversizedRequestResponse) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'request_too_large',
    });
    return oversizedRequestResponse;
  }

  const { listingId } = await context.params;
  const existingListing = await getListing(listingId);

  if (!existingListing || existingListing.sellerId !== session.user.id) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'listing_not_found',
    });
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  const maxImages = getMaxListingImagesPerListing();

  if (hasReachedListingImageLimit(existingListing.images)) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'image_limit',
    });
    return Response.json(
      {
        error: 'listing_image_limit_reached',
        message: `وصل الإعلان إلى الحد الأقصى (${maxImages}) من الصور. احذف صورة قديمة قبل رفع صورة جديدة.`,
        maxImages,
      },
      { status: 409 },
    );
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'invalid_multipart',
    });
    return Response.json({ error: 'invalid_multipart_form_data' }, { status: 400 });
  }

  const file = formData.get('image');

  if (!(file instanceof File)) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'missing_image',
    });
    return Response.json({ error: 'missing_image' }, { status: 400 });
  }

  if (!supportedMimeTypes.has(file.type)) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'unsupported_type',
    });
    return Response.json({ error: 'unsupported_image_type' }, { status: 415 });
  }

  if (file.size > maxImageBytes) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'image_too_large',
    });
    return Response.json({ error: 'image_too_large' }, { status: 413 });
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'image_upload',
    actorKey: `${session.user.id}:${listingId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    let sanitizedOriginal: Awaited<
      ReturnType<typeof createSanitizedListingImageOriginal>
    >;
    let generatedVariants: Awaited<ReturnType<typeof createListingImageVariants>>;

    try {
      sanitizedOriginal = await createSanitizedListingImageOriginal({
        data: new Uint8Array(fileBuffer),
        mediaType: file.type,
        fileName: file.name,
      });
      generatedVariants = await createListingImageVariants({
        data: new Uint8Array(fileBuffer),
        mediaType: file.type,
        fileName: file.name,
      });
    } catch (error) {
      incrementRuntimeCounter('listing.image_upload.rejected', {
        reason:
          error instanceof ListingImageSecurityError
            ? error.code
            : 'image_decode_failed',
      });
      const responseBody = {
        error:
          error instanceof ListingImageSecurityError
            ? error.code
            : 'image_decode_failed',
        message: 'Image could not be accepted after server security checks.',
      };
      const status =
        error instanceof ListingImageSecurityError &&
        ['unsupported_image_type', 'image_type_mismatch'].includes(error.code)
          ? 415
          : 422;

      return idempotency ? await idempotency.complete(responseBody, status) : Response.json(responseBody, { status });
    }

    const contentReview = await reviewListingImageContent([sanitizedOriginal], existingListing.images);
    if (contentReview.status === 'blocked') {
      const responseBody = {
        error: 'image_policy_blocked',
        compliance: contentReview.compliance,
      };
      incrementRuntimeCounter('listing.image_upload.rejected', { reason: responseBody.error });
      return idempotency
        ? await idempotency.complete(responseBody, 422)
        : Response.json(responseBody, { status: 422 });
    }

    const imageId = randomUUID();
    let imageUrls: Awaited<ReturnType<typeof storeListingImageDelivery>>;

    try {
      imageUrls = await storeListingImageDelivery({
        imageId,
        original: sanitizedOriginal,
        variants: generatedVariants,
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const errorMessage =
        error instanceof Error
          ? error.message.replace(/\s+/g, ' ').slice(0, 240)
          : 'Unknown image storage error';
      console.warn(
        `[listing_image_storage] failure=${errorName} message="${errorMessage}"`,
      );

      const responseBody = {
        error: 'image_storage_unavailable',
        message:
          'Image storage is unavailable. The image was not saved.',
      };

      await idempotency?.abandon();
      incrementRuntimeCounter('listing.image_upload.failed', {
        reason: 'storage_unavailable',
      });
      return Response.json(responseBody, { status: 503 });
    }

    if (!imageUrls) {
      incrementRuntimeCounter('listing.image_upload.rejected', {
        reason: 'unsupported_type',
      });
      const responseBody = { error: 'unsupported_image_type' };

      return idempotency
        ? await idempotency.complete(responseBody, 415)
        : Response.json(responseBody, { status: 415 });
    }

    const quality = analyzeImageQuality({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    });
    const image: ListingImage = {
      contentReviewStatus: contentReview.imageReviewStatuses[0],
      id: imageId,
      listingId,
      ...imageUrls,
      isPrimary: false,
      qualityScore: quality.qualityScore,
      status: 'approved',
      enhancements: quality.enhancements,
    };

    const listing = await addListingImageForSeller(listingId, session.user.id, image).catch(async (error: unknown) => {
      await discardUnattachedListingImage(image);
      throw error;
    });
    if (!listing?.images.some(saved => saved.id === image.id)) {
      await discardUnattachedListingImage(image);
      const status = listing ? 409 : 404;
      const body = { error: listing ? 'listing_image_limit_reached' : 'listing_not_found' };
      return idempotency ? await idempotency.complete(body, status) : Response.json(body, { status });
    }

    const responseBody = {
      image,
      quality,
      compliance: contentReview.compliance,
      contentCheck: contentReview.status,
      listing,
    };
    const responseStatus = 201;
    incrementRuntimeCounter('listing.image_upload.saved', {
      status: image.status,
    });
    recordRuntimeDurationMs('listing.image_upload.duration_ms', Date.now() - startedAt, {
      status: responseStatus,
    });

    return idempotency
      ? await idempotency.complete(responseBody, responseStatus)
      : Response.json(responseBody, { status: responseStatus });
  } catch (error) {
    await idempotency?.abandon();
    throw error;
  }
}
