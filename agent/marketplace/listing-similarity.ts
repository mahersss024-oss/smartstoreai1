import { normalizeMarketplaceSearchText } from './search';
import { marketplaceCategoryOptionGroups, getMarketplaceCategoryOptions, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';

import { marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';

export const strongListingSimilarityThreshold = 85;

type SimilarityListing = {
  id: string;
  category: string;
  title?: string | null;
  attributes: Record<string, unknown>;
};

const genericWords = new Set([
  'للبيع', 'بيع', 'اعلان', 'عرض', 'جديد', 'جديدة', 'مستعمل', 'مستعملة',
  'نظيف', 'نظيفة', 'ممتاز', 'ممتازة', 'جدا', 'للجادين', 'فرصة', 'السوم',
  'سوم', 'سعر', 'ريال', 'قابل', 'للتفاوض', 'فقط', 'مع', 'في', 'من', 'على',
  'for', 'sale', 'new', 'used', 'excellent', 'condition', 'only', 'and', 'with',
].map(normalizeMarketplaceSearchText));
const modelQualifiers = new Set(['pro', 'max', 'mini', 'plus', 'ultra', 'برو', 'ماكس', 'ميني', 'بلس', 'الترا']);

function value(input: unknown) {
  return typeof input === 'string' || typeof input === 'number'
    ? normalizeMarketplaceSearchText(String(input)) : '';
}

function meaningful(input: unknown) {
  const normalized = value(input);
  return normalized && !['other', 'custom', 'unknown'].includes(normalized) ? normalized : '';
}

function titleTerms(title?: string | null) {
  return new Set(normalizeMarketplaceSearchText(title ?? '').split(/[^\p{L}\p{N}]+/u)
    .filter(term => term && !genericWords.has(term)));
}

function canonicalBrand(listing: SimilarityListing, branch: string) {
  const group = marketplaceCategoryOptionGroups[listing.category as keyof typeof marketplaceCategoryOptionGroups];
  if (group?.kind === 'brand' && branch) return branch;
  const brand = meaningful(listing.attributes.brand);
  return getMarketplaceCategoryOptions(listing.category)
    .find(option => value(option.id) === brand || value(option.label) === brand)?.id ?? brand;
}

function prepareListingIdentity(listing: SimilarityListing) {
  const branch = meaningful(listing.attributes[marketplaceCategoryOptionAttribute]);
  const car = meaningful(listing.attributes[marketplaceCarModelAttribute]);
  return {
    id: listing.id,
    category: listing.category,
    branch,
    brand: canonicalBrand(listing, branch),
    car,
    model: car || meaningful(listing.attributes.model),
    configuration: meaningful(listing.attributes.configuration),
    offerKind: meaningful(listing.attributes.offerKind),
  };
}

function prepareListingTitle(title?: string | null) {
  const terms = titleTerms(title);
  return {
    terms,
    wanted: terms.has('\u0645\u0637\u0644\u0648\u0628') || terms.has('wanted'),
    qualifiers: [...terms].filter(term => modelQualifiers.has(term)),
    titleWeight: [...terms].reduce((sum, term) => sum + (/\d/.test(term) ? 2 : 1), 0),
  };
}

type PreparedListingIdentity = ReturnType<typeof prepareListingIdentity>;
type PreparedListingSimilarity = PreparedListingIdentity & ReturnType<typeof prepareListingTitle>;

function preparedListingSimilarityScore(left: PreparedListingSimilarity, right: PreparedListingIdentity, candidate: SimilarityListing) {
  if (left.branch && right.branch && left.branch !== right.branch) return 0;
  if (left.brand && right.brand && left.brand !== right.brand) return 0;
  if (left.car && right.car && left.car !== right.car) return 0;
  if (left.model && right.model && left.model !== right.model) return 0;
  for (const key of ['configuration', 'offerKind'] as const) {
    if (left[key] && right[key] && left[key] !== right[key]) return 0;
  }
  // Reject conflicting identities before normalizing candidate title tokens.
  const rightTitle = prepareListingTitle(candidate.title);
  // A request to buy must not be treated as a sale solely because names match.
  if (left.wanted !== rightTitle.wanted) return 0;
  if (left.qualifiers.some(term => !rightTitle.qualifiers.includes(term)) || rightTitle.qualifiers.some(term => !left.qualifiers.includes(term))) return 0;
  const total = left.titleWeight + rightTitle.titleWeight;
  let common = 0;
  for (const term of left.terms) {
    if (rightTitle.terms.has(term)) common += /\d/.test(term) ? 2 : 1;
  }
  const titleScore = total ? 200 * common / total : 0;
  const exactModel = Boolean(left.model && left.model === right.model && left.brand && left.brand === right.brand);
  if (exactModel) return Math.round(95 + titleScore * 0.05);
  const group = marketplaceCategoryOptionGroups[left.category as keyof typeof marketplaceCategoryOptionGroups];
  const preciseType = Boolean(group?.kind === 'type' && left.branch && left.branch === right.branch);
  // Preserve the existing match threshold: type branches still require at
  // least 75% title overlap; title-only matches retain the original rounding.
  // A brand alone never relaxes title eligibility.
  // Score bands put verified structured identity above title-only matches.
  const roundedTitleScore = Math.round(titleScore);
  const sameBrand = Boolean(left.brand && left.brand === right.brand);
  if ((preciseType && titleScore >= 75) || (sameBrand && roundedTitleScore >= strongListingSimilarityThreshold)) {
    const minimumTitleScore = preciseType ? 75 : strongListingSimilarityThreshold;
    return Math.min(94, Math.round(90 + (titleScore - minimumTitleScore) * 4 / (100 - minimumTitleScore)));
  }
  return roundedTitleScore >= strongListingSimilarityThreshold
    ? Math.min(89, Math.round(strongListingSimilarityThreshold + (titleScore - strongListingSimilarityThreshold) * 4 / 15))
    : 0;
}

/** Prepare one reference once; all state lives only for this comparison pass. */
export function createListingSimilarityScorer(left: SimilarityListing) {
  const preparedLeft = { ...prepareListingIdentity(left), ...prepareListingTitle(left.title) };
  return (right: SimilarityListing) => {
    if (preparedLeft.id === right.id || preparedLeft.category !== right.category) return 0;
    return preparedListingSimilarityScore(preparedLeft, prepareListingIdentity(right), right);
  };
}

/** Conservative deterministic identity match; no model, aliases or description expansion. */
export function getListingSimilarityScore(left: SimilarityListing, right: SimilarityListing) {
  if (left.id === right.id || left.category !== right.category) return 0;
  return createListingSimilarityScorer(left)(right);
}
