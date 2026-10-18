import type { ImageEnhancementAction, ListingImageStatus } from './types';

export type ImageQualityInput = {
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  hasDetectedPhoneNumber?: boolean;
  hasDetectedSensitiveInfo?: boolean;
  isRelevantToListing?: boolean;
};

export type ImageQualityResult = {
  qualityScore: number;
  resolution?: {
    width: number;
    height: number;
  };
  sharpness: 'unknown' | 'low' | 'medium' | 'high';
  lighting: 'unknown' | 'poor' | 'acceptable' | 'good';
  productVisibility: 'unknown' | 'poor' | 'partial' | 'clear';
  hasSensitiveInfo: boolean;
  hasPhoneNumber: boolean;
  isRelevantToListing: boolean;
  recommendedAction:
    | 'approve'
    | 'enhance'
    | 'blur_sensitive_info'
    | 'request_retake'
    | 'reject';
  listingImageStatus: ListingImageStatus;
  enhancements: ImageEnhancementAction[];
  notes: string[];
};

const supportedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const maxImageBytes = 12 * 1024 * 1024;
const minimumUsefulPixels = 720 * 720;

export function analyzeImageQuality(input: ImageQualityInput): ImageQualityResult {
  const notes: string[] = [];
  const enhancements: ImageEnhancementAction[] = ['compress', 'create_thumbnail'];
  const hasPhoneNumber = Boolean(input.hasDetectedPhoneNumber);
  const hasSensitiveInfo =
    hasPhoneNumber || Boolean(input.hasDetectedSensitiveInfo);
  const isRelevantToListing = input.isRelevantToListing !== false;
  const hasResolution =
    typeof input.width === 'number' && typeof input.height === 'number';
  const pixelCount = hasResolution ? input.width! * input.height! : undefined;
  let qualityScore = 84;

  if (input.mimeType && !supportedMimeTypes.has(input.mimeType)) {
    return {
      qualityScore: 0,
      sharpness: 'unknown',
      lighting: 'unknown',
      productVisibility: 'unknown',
      hasSensitiveInfo,
      hasPhoneNumber,
      isRelevantToListing,
      recommendedAction: 'reject',
      listingImageStatus: 'rejected',
      enhancements: [],
      notes: ['unsupported_image_type'],
    };
  }

  if (typeof input.sizeBytes === 'number' && input.sizeBytes > maxImageBytes) {
    qualityScore -= 35;
    notes.push('image_file_too_large');
  }

  if (hasResolution && pixelCount! < minimumUsefulPixels) {
    qualityScore -= 40;
    notes.push('resolution_too_low');
  }

  if (!hasResolution) {
    qualityScore -= 8;
    notes.push('resolution_unknown');
  }

  if (!isRelevantToListing) {
    return {
      qualityScore: 0,
      resolution: hasResolution
        ? { width: input.width!, height: input.height! }
        : undefined,
      sharpness: 'unknown',
      lighting: 'unknown',
      productVisibility: 'poor',
      hasSensitiveInfo,
      hasPhoneNumber,
      isRelevantToListing,
      recommendedAction: 'reject',
      listingImageStatus: 'rejected',
      enhancements: [],
      notes: ['image_not_relevant_to_listing'],
    };
  }

  if (hasSensitiveInfo) {
    enhancements.push('blur_sensitive_info');
    notes.push('sensitive_info_should_be_blurred');
  }

  if (qualityScore < 75 || hasSensitiveInfo) {
    enhancements.push('improve_lighting', 'sharpen', 'auto_crop');

    return {
      qualityScore,
      resolution: hasResolution
        ? { width: input.width!, height: input.height! }
        : undefined,
      sharpness: qualityScore < 75 ? 'medium' : 'high',
      lighting: qualityScore < 75 ? 'acceptable' : 'good',
      productVisibility: 'clear',
      hasSensitiveInfo,
      hasPhoneNumber,
      isRelevantToListing,
      recommendedAction: hasSensitiveInfo ? 'blur_sensitive_info' : 'enhance',
      listingImageStatus: 'approved',
      enhancements,
      notes,
    };
  }

  return {
    qualityScore,
    resolution: hasResolution ? { width: input.width!, height: input.height! } : undefined,
    sharpness: 'high',
    lighting: 'good',
    productVisibility: 'clear',
    hasSensitiveInfo,
    hasPhoneNumber,
    isRelevantToListing,
    recommendedAction: 'approve',
    listingImageStatus: 'approved',
    enhancements,
    notes,
  };
}
