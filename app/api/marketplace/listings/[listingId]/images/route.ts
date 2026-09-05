import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { analyzeImageQuality } from '@/agent/marketplace/image-quality';
import { checkImageMarketplaceCompliance } from '@/agent/marketplace/vision-compliance';
import {
  addListingImageForSeller,
  getListing,
} from '@/agent/marketplace/repository';
import type { ListingImage } from '@/agent/marketplace/types';
import { getAuthSession } from '@/lib/auth/session';

const supportedMimeTypes = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);
const maxImageBytes = 12 * 1024 * 1024;

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

function getSafeExtension(file: File) {
  return supportedMimeTypes.get(file.type) ?? extname(file.name).toLowerCase();
}

function getPublicUploadUrl(listingId: string, imageId: string, extension: string) {
  return `/uploads/listings/${encodeURIComponent(listingId)}/${imageId}${extension}`;
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to upload listing images.',
      },
      { status: 401 },
    );
  }

  const { listingId } = await context.params;
  const existingListing = await getListing(listingId);

  if (!existingListing || existingListing.sellerId !== session.user.id) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('image');

  if (!(file instanceof File)) {
    return Response.json({ error: 'missing_image' }, { status: 400 });
  }

  if (!supportedMimeTypes.has(file.type)) {
    return Response.json({ error: 'unsupported_image_type' }, { status: 415 });
  }

  if (file.size > maxImageBytes) {
    return Response.json({ error: 'image_too_large' }, { status: 413 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
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
              mediaType: file.type,
              data: new Uint8Array(fileBuffer),
            },
          ],
        },
      ],
      userRequest: listingText,
      language: 'ar',
      expectedCategory: existingListing.category,
      listingText,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[listing_image_compliance] failure=${errorName}`);

    return Response.json(
      {
        error: 'image_compliance_unavailable',
        message:
          'Image compliance review is unavailable. The image was not accepted.',
      },
      { status: 503 },
    );
  }

  if (imageCompliance.decision === 'block') {
    return Response.json(
      {
        error: 'image_policy_blocked',
        message:
          'Image appears to show a product prohibited by Saudi marketplace or Islamic compliance policy.',
        compliance: imageCompliance,
      },
      { status: 422 },
    );
  }

  const extension = getSafeExtension(file);
  const imageId = randomUUID();
  const safeListingPathSegment = listingId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const uploadDirectory = join(
    process.cwd(),
    'public',
    'uploads',
    'listings',
    safeListingPathSegment,
  );
  const uploadPath = join(uploadDirectory, `${imageId}${extension}`);
  const uploadUrl = getPublicUploadUrl(safeListingPathSegment, imageId, extension);
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
  const image: ListingImage = {
    id: imageId,
    listingId,
    originalUrl: uploadUrl,
    displayUrl: uploadUrl,
    thumbnailUrl: uploadUrl,
    isPrimary: false,
    qualityScore: quality.qualityScore,
    status:
      imageCompliance.decision === 'needs_review'
        ? 'pending_review'
        : quality.listingImageStatus,
    enhancements: quality.enhancements,
  };

  await mkdir(uploadDirectory, { recursive: true });
  await writeFile(uploadPath, fileBuffer);

  const listing = await addListingImageForSeller(listingId, session.user.id, image);

  return Response.json(
    {
      image,
      quality,
      compliance: imageCompliance,
      listing,
    },
    { status: image.status === 'pending_review' ? 202 : 201 },
  );
}
