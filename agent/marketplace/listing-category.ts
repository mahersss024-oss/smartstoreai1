import { isMarketplaceCategory } from '@/lib/marketplace/categories';

export type ListingCategoryInput = {
  category: string;
  autoCategory?: boolean;
  title?: string;
  description?: string;
};

// Storage accepts the supplied category; model inference runs on the server.
export function resolveListingCategory(input: ListingCategoryInput) {
  if (!input.autoCategory) return input.category;
  return isMarketplaceCategory(input.category) ? input.category : 'other';
}
