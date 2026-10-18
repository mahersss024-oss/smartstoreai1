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
  assessmentStatus: 'not_measured';
  resolution?: { width: number; height: number };
  sharpness: 'unknown';
  lighting: 'unknown';
  productVisibility: 'unknown';
  hasSensitiveInfo: boolean | null;
  hasPhoneNumber: boolean | null;
  isRelevantToListing: boolean | null;
  recommendedAction: 'approve' | 'enhance' | 'blur_sensitive_info' | 'request_retake' | 'reject';
  listingImageStatus: ListingImageStatus;
  enhancements: ImageEnhancementAction[];
  notes: string[];
};

const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function analyzeImageQuality(input: ImageQualityInput): ImageQualityResult {
  const unsupported = Boolean(input.mimeType && !supportedMimeTypes.has(input.mimeType));
  const hasSensitiveInfo = Boolean(input.hasDetectedPhoneNumber || input.hasDetectedSensitiveInfo);
  // Zero is the legacy storage sentinel, not a measured visual-quality score.
  // Visual claims require pixels and cannot be established from file metadata.
  return {
    qualityScore: 0,
    assessmentStatus: 'not_measured',
    resolution: input.width && input.height ? { width: input.width, height: input.height } : undefined,
    sharpness: 'unknown',
    lighting: 'unknown',
    productVisibility: 'unknown',
    hasSensitiveInfo: input.hasDetectedPhoneNumber === undefined && input.hasDetectedSensitiveInfo === undefined ? null : hasSensitiveInfo,
    hasPhoneNumber: input.hasDetectedPhoneNumber ?? null,
    isRelevantToListing: input.isRelevantToListing ?? null,
    recommendedAction: unsupported ? 'reject' : hasSensitiveInfo ? 'blur_sensitive_info' : 'approve',
    listingImageStatus: unsupported ? 'rejected' : 'approved',
    enhancements: unsupported ? [] : ['compress', 'create_thumbnail', ...(hasSensitiveInfo ? ['blur_sensitive_info' as const] : [])],
    notes: unsupported ? ['unsupported_image_type'] : ['visual_quality_not_measured'],
  };
}
