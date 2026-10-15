import type { UploadedListingImage } from './listing-image-storage';
import { checkImageMarketplaceCompliance } from './vision-compliance';
import type { ListingImage, ImageContentReviewStatus } from './types';

export async function reviewListingImageContent(images: UploadedListingImage[], existingImages: ListingImage[] = []) {
  const unchecked: ImageContentReviewStatus[] = images.map(() => 'not_checked');
  const remaining = Math.max(0, 3 - existingImages.length);
  if (remaining === 0 || existingImages.some(image => image.contentReviewStatus === 'clear')) {
    return { status: 'skipped' as const, message: undefined, compliance: null, imageReviewStatuses: unchecked };
  }
  try {
    const compliance = await checkImageMarketplaceCompliance({
      messages: [{
        role: 'user',
        content: images.slice(0, remaining).map(image => ({ type: 'file' as const, mediaType: image.mediaType, data: image.data })),
      }],
      userRequest: 'Check uploaded images for prohibited content only.',
      language: 'ar',
      reviewMode: 'first_clear_max_three',
      prohibitedOnly: true,
    });
    return {
      status: compliance.inspectionUnavailable ? 'unavailable' as const : compliance.decision === 'block' ? 'blocked' as const : 'allowed' as const,
      message: compliance.decision === 'block' ? 'The image contains prohibited content and was not saved.' : undefined,
      compliance: compliance.inspectionUnavailable ? null : compliance,
      imageReviewStatuses: unchecked.map((status, index) => compliance.imageReviewStatuses?.[index] ?? status),
    };
  } catch (error) {
    console.warn(`[listing_image_content] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
    // Keep the outage explicit without blocking otherwise valid uploads.
    return {
      status: 'unavailable' as const,
      message: 'Content inspection is unavailable; the image has not been checked.',
      compliance: null,
      imageReviewStatuses: unchecked.map((status, index) => index === 0 ? 'unavailable' : status),
    };
  }
}
