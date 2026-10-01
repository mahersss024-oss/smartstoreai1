import { randomUUID } from 'node:crypto';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { createListingImageDeliveryUrls } from '@/agent/marketplace/listing-image-delivery';
import {
  getMaxListingImagesPerListing,
  hasReachedListingImageLimit,
} from '@/agent/marketplace/listing-image-limits';
import { createPersistentListingImageUrl } from '@/agent/marketplace/listing-image-storage';
import {
  createListingImageVariants,
  createSanitizedListingImageOriginal,
  ListingImageSecurityError,
} from '@/agent/marketplace/listing-image-variants';
import {
  checkImageMarketplaceCompliance,
  type ImageComplianceDecision,
} from '@/agent/marketplace/vision-compliance';
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
  'image/gif',
]);
const maxImageBytes = 12 * 1024 * 1024;
const maxImageUploadRequestBytes = maxImageBytes + 1024 * 1024;

function createTrustedSecondaryImageComplianceDecision(
  expectedCategory?: string,
): ImageComplianceDecision {
  return {
    decision: 'allow',
    confidence: 1,
    reasons: [
      'secondary_image_trusted_after_approved_primary_image',
      'technical_upload_checks_only',
    ],
    expectedCategory,
    categoryMatch: expectedCategory ? 'match' : 'unclear',
    shariaSensitive: false,
  };
}

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

    return Response.json(responseBody, { status });
  }

  const listingText = [
    existingListing.title,
    existingListing.description,
    existingListing.city,
    existingListing.condition,
  ]
    .filter(Boolean)
    .join(' ');
  let imageCompliance: Awaited<
    ReturnType<typeof checkImageMarketplaceCompliance>
  >;
  const hasApprovedPrimaryImage = existingListing.images.some(
    (image) => image.status === 'approved',
  );

  if (hasApprovedPrimaryImage) {
    imageCompliance = createTrustedSecondaryImageComplianceDecision(
      existingListing.category,
    );
  } else {
    try {
      imageCompliance = await checkImageMarketplaceCompliance({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Listing category: ${existingListing.category}. Listing text: ${listingText}`,
              },
              {
                type: 'file',
                mediaType: sanitizedOriginal.mediaType,
                data: sanitizedOriginal.data,
              },
            ],
          },
        ],
        userRequest: listingText,
        language: 'ar',
        expectedCategory: existingListing.category,
        listingText,
        reviewMode: 'primary_only',
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[listing_image_compliance] failure=${errorName}`);

      const responseBody = {
        error: 'image_compliance_unavailable',
        message:
          'Image compliance review is unavailable. The image was not accepted.',
      };

      await idempotency?.abandon();
      incrementRuntimeCounter('listing.image_upload.failed', {
        reason: 'compliance_unavailable',
      });
      return Response.json(responseBody, { status: 503 });
    }
  }

  if (imageCompliance.decision === 'block') {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'policy_blocked',
    });
    const responseBody = {
      error: 'image_policy_blocked',
      message:
        'Image appears to show a product prohibited by Saudi marketplace or Islamic compliance policy.',
      compliance: imageCompliance,
    };

    return idempotency
      ? idempotency.complete(responseBody, 422)
      : Response.json(responseBody, { status: 422 });
  }

  const imageId = randomUUID();
  let imageUrl: string | null;

  try {
    imageUrl = await createPersistentListingImageUrl({
      data: sanitizedOriginal.data,
      mediaType: sanitizedOriginal.mediaType,
      imageId,
      fileName: sanitizedOriginal.fileName,
      variant: 'original',
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

  if (!imageUrl) {
    incrementRuntimeCounter('listing.image_upload.rejected', {
      reason: 'unsupported_type',
    });
    const responseBody = { error: 'unsupported_image_type' };

    return idempotency
      ? idempotency.complete(responseBody, 415)
      : Response.json(responseBody, { status: 415 });
  }

  let displayUrl = imageUrl;
  let thumbnailUrl = imageUrl;
  try {
    // The server is the canonical image processor. Browser encoders vary widely
    // and can produce deceptively large files despite a .webp extension.
    if (generatedVariants) {
      displayUrl =
        (await createPersistentListingImageUrl({
          ...generatedVariants.display,
          imageId,
          variant: 'display',
        })) ?? imageUrl;
      thumbnailUrl =
        (await createPersistentListingImageUrl({
          ...generatedVariants.thumbnail,
          imageId,
          variant: 'thumbnail',
        })) ?? displayUrl;
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[listing_image_variant_generation] failure=${errorName}`);
  }

  const quality = analyzeImageQuality({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    hasDetectedPhoneNumber:
      formData.get('hasDetectedPhoneNumber') === 'true' || undefined,
    hasDetectedSensitiveInfo:
      formData.get('hasDetectedSensitiveInfo') === 'true' || undefined,
    isRelevantToListing:
      formData.get('isRelevantToListing') === 'false' ? false : undefined,
  });
  const imageUrls = createListingImageDeliveryUrls(imageUrl, {
    displayUrl,
    thumbnailUrl,
  });
  const image: ListingImage = {
    id: imageId,
    listingId,
    ...imageUrls,
    isPrimary: false,
    qualityScore: quality.qualityScore,
    status:
      imageCompliance.decision === 'needs_review'
        ? 'pending_review'
        : quality.listingImageStatus,
    enhancements: quality.enhancements,
  };

  const listing = await addListingImageForSeller(listingId, session.user.id, image);

  const responseBody = {
    image,
    quality,
    compliance: imageCompliance,
    listing,
  };
  const responseStatus = image.status === 'pending_review' ? 202 : 201;
  incrementRuntimeCounter('listing.image_upload.saved', {
    status: image.status,
  });
  recordRuntimeDurationMs('listing.image_upload.duration_ms', Date.now() - startedAt, {
    status: responseStatus,
  });

  return idempotency
    ? idempotency.complete(responseBody, responseStatus)
    : Response.json(responseBody, { status: responseStatus });
}
