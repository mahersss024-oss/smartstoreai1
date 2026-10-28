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

function canonicalBrand(listing: SimilarityListing) {
  const branch = meaningful(listing.attributes[marketplaceCategoryOptionAttribute]);
  const group = marketplaceCategoryOptionGroups[listing.category as keyof typeof marketplaceCategoryOptionGroups];
  if (group?.kind === 'brand' && branch) return branch;
  const brand = meaningful(listing.attributes.brand);
  return getMarketplaceCategoryOptions(listing.category)
    .find(option => value(option.id) === brand || value(option.label) === brand)?.id ?? brand;
}

/** Conservative deterministic identity match; no model, aliases or description expansion. */
export function getListingSimilarityScore(left: SimilarityListing, right: SimilarityListing) {
  if (left.id === right.id || left.category !== right.category) return 0;
  const branchLeft = meaningful(left.attributes[marketplaceCategoryOptionAttribute]);
  const branchRight = meaningful(right.attributes[marketplaceCategoryOptionAttribute]);
  if (branchLeft && branchRight && branchLeft !== branchRight) return 0;
  const brandLeft = canonicalBrand(left);
  const brandRight = canonicalBrand(right);
  if (brandLeft && brandRight && brandLeft !== brandRight) return 0;
  const carLeft = meaningful(left.attributes[marketplaceCarModelAttribute]);
  const carRight = meaningful(right.attributes[marketplaceCarModelAttribute]);
  if (carLeft && carRight && carLeft !== carRight) return 0;
  const modelLeft = carLeft || meaningful(left.attributes.model);
  const modelRight = carRight || meaningful(right.attributes.model);
  if (modelLeft && modelRight && modelLeft !== modelRight) return 0;
  for (const key of ['configuration', 'offerKind']) {
    const a = meaningful(left.attributes[key]);
    const b = meaningful(right.attributes[key]);
    if (a && b && a !== b) return 0;
  }
  const a = titleTerms(left.title);
  const b = titleTerms(right.title);
  // A request to buy must not be treated as a sale solely because names match.
  const wanted = (terms: Set<string>) => terms.has('مطلوب') || terms.has('wanted');
  if (wanted(a) !== wanted(b)) return 0;
  const qualifiersA = [...a].filter(term => modelQualifiers.has(term));
  const qualifiersB = [...b].filter(term => modelQualifiers.has(term));
  if (qualifiersA.some(term => !qualifiersB.includes(term)) || qualifiersB.some(term => !qualifiersA.includes(term))) return 0;
  const weight = (term: string) => /\d/.test(term) ? 2 : 1;
  const total = [...a, ...b].reduce((sum, term) => sum + weight(term), 0);
  const common = [...a].filter(term => b.has(term)).reduce((sum, term) => sum + weight(term), 0);
  const titleScore = total ? 200 * common / total : 0;
  const exactModel = Boolean(modelLeft && modelLeft === modelRight && brandLeft && brandLeft === brandRight);
  if (exactModel) return Math.round(95 + titleScore * 0.05);
  const group = marketplaceCategoryOptionGroups[left.category as keyof typeof marketplaceCategoryOptionGroups];
  const preciseType = Boolean(group?.kind === 'type' && branchLeft && branchLeft === branchRight);
  const score = Math.min(100, Math.round(titleScore + (preciseType && titleScore >= 75 ? 10 : 0)));
  return score >= strongListingSimilarityThreshold ? score : 0;
}
