import type { UploadedListingImage } from './listing-image-storage';
import { aggregateImageComplianceDecisions, checkImageMarketplaceCompliance } from './vision-compliance';
import type { ListingImage, ImageContentReviewStatus } from './types';
import { modelReviewImageFingerprint, recordModelReview } from '@/lib/admin/model-review';
import { getDeepseekModelName } from '@/agent/deepseek-provider';

type ImageAssessment = Awaited<ReturnType<typeof checkImageMarketplaceCompliance>> | null;
const cache = new Map<string, { expiresAt: number; value: ImageAssessment }>();
const pending = new Map<string, Promise<ImageAssessment>>();

export function resetImageContentReviewCacheForTests() { cache.clear(); }

async function inspectImage(image: UploadedListingImage): Promise<ImageAssessment> {
  const key = `content-v3:${getDeepseekModelName('vision')}:${image.mediaType}:${modelReviewImageFingerprint([image.data])}`;
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value;
  if (pending.has(key)) return pending.get(key)!;
  if (pending.size >= 32) return null;
  const task = (async () => {
    let value: ImageAssessment = null;
    try {
      value = await checkImageMarketplaceCompliance({
        messages: [{ role: 'user', content: [{ type: 'file' as const, mediaType: image.mediaType, data: image.data }] }],
        userRequest: 'Describe the actual product and assess content policy. Quality and category matching never restrict acceptance.',
        language: 'ar', reviewMode: 'all_images', prohibitedOnly: false,
      });
    } catch (error) {
      console.warn(`[listing_image_content] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
    }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expiresAt: Date.now() + (value && !value.inspectionUnavailable ? 600_000 : 10_000) });
    return value;
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

async function inspectImages(images: UploadedListingImage[]): Promise<ImageAssessment> {
  const decisions: NonNullable<ImageAssessment>[] = [];
  for (const image of images) {
    const decision = await inspectImage(image);
    if (!decision || decision.inspectionUnavailable) return null;
    decisions.push(decision);
  }
  return {
    ...aggregateImageComplianceDecisions(decisions),
    imageProducts: decisions.map((decision, imageIndex) => ({ imageIndex, detectedProduct: decision.detectedProduct, detectedCategory: decision.detectedCategory })),
  };
}

export async function reviewListingImageContent(images: UploadedListingImage[], existingImages: ListingImage[] = [], context?: { listingId: string; userId: string }) {
  const unchecked: ImageContentReviewStatus[] = images.map(() => 'not_checked');
  void existingImages;
  const compliance = await inspectImages(images);
  if (context) await recordModelReview({ subject: 'image', subjectId: `${context.listingId}:${modelReviewImageFingerprint(images.map(image => image.data))}`, listingId: context.listingId, userId: context.userId,
    text: compliance?.detectedProduct ?? 'صورة مرفوعة للإعلان', assessment: { decision: compliance?.decision ?? 'needs_review', reasons: compliance?.reasons ?? ['image_inspection_unavailable'], unavailable: !compliance || Boolean(compliance.inspectionUnavailable) } });
  return {
    status: !compliance || compliance.inspectionUnavailable ? 'unavailable' as const : 'allowed' as const,
    message: undefined,
    compliance,
    imageReviewStatuses: unchecked.map(() => !compliance || compliance.inspectionUnavailable ? 'unavailable' as const : compliance.decision === 'allow' ? 'clear' as const : 'unclear' as const),
  };
}
