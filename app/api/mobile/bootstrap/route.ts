import { scheduleNotificationDelivery } from '@/lib/push/delivery-jobs';
import { getMaxListingImagesPerListing } from '@/agent/marketplace/listing-image-limits';
import { getDirectImageUploadCapability } from '@/agent/marketplace/direct-image-objects';
import { getMaxListingsPerSeller } from '@/agent/marketplace/listing-limits';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { isAppleNativeAuthConfigured } from '@/lib/auth/apple-native';
import { getGoogleNativeClientId } from '@/lib/auth/google';
import {
  commissionPolicyVersion,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
} from '@/lib/auth/session';
import { marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOptionLabel, marketplaceCategoryOptionAttribute, marketplaceCategoryOptionGroups } from '@/lib/marketplace/category-options';
import { marketplaceCarModelAttribute, marketplaceCarModelsByBrand } from '@/lib/marketplace/car-models';
import { saudiMarketplaceCities } from '@/lib/marketplace/cities';
import { platformPolicies } from '@/lib/platform/policies';
import { getActiveSiteMessage } from '@/lib/site-message';
import { schedulePendingImageObjectCleanup } from '@/agent/marketplace/image-object-cleanup';

export const dynamic = 'force-dynamic';

/** Public native UI configuration, from the same catalog and policies as the website. */
export async function GET(request: Request) {
  const limited = await enforceApiRateLimit(request, {
    namespace: 'mobile_bootstrap', maxRequests: 120, windowMs: 60_000,
  });
  if (limited) return limited;
  schedulePendingImageObjectCleanup();
  scheduleNotificationDelivery();

  return Response.json({
    categories: marketplaceCategoryDefinitions.map(category => ({
      ...category,
      options: marketplaceCategoryOptionGroups[category.id].options,
      optionKind: marketplaceCategoryOptionGroups[category.id].kind,
      optionLabel: getMarketplaceCategoryOptionLabel(category.id),
      ...(category.id === 'cars' ? { carModels: marketplaceCarModelsByBrand } : {}),
    })),
    attributes: { categoryOption: marketplaceCategoryOptionAttribute, carModel: marketplaceCarModelAttribute },
    cities: saudiMarketplaceCities,
    policies: platformPolicies,
    policyVersions: { platformAgreementVersion, termsVersion, privacyPolicyVersion, listingPolicyVersion, commissionPolicyVersion },
    commissionRatePercent: 1,
    limits: {
      maxListingImages: getMaxListingImagesPerListing(),
      maxImageBytes: 12 * 1024 * 1024,
      maxProfileImageBytes: 4 * 1024 * 1024,
      maxListingsPerSeller: getMaxListingsPerSeller(),
    },
    auth: { google: Boolean(getGoogleNativeClientId()), apple: isAppleNativeAuthConfigured() },
    assistant: { capabilities: ['listing_drafts', 'platform_help'], requiresSignIn: true },
    imageUploads: getDirectImageUploadCapability(),
    siteMessage: await getActiveSiteMessage(),
  }, { headers: noStoreHeaders });
}
