import { parseMarketplaceSearchQuery } from './search';
import { isMarketplaceCategory } from '@/lib/marketplace/categories';

export function resolveListingCategory(
  input: { category: string; autoCategory?: boolean; title?: string; description?: string },
  infer = (text: string) => parseMarketplaceSearchQuery(text).category,
) {
  if (!input.autoCategory) return input.category;
  try {
    const category = infer(input.title ?? '') ?? infer(input.description ?? '');
    return category && isMarketplaceCategory(category) ? category : 'other';
  } catch {
    return input.category;
  }
}
