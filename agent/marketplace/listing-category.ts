import { parseMarketplaceSearchQuery } from './search';

const selectableCategories = new Set([
  'cars', 'auto_parts', 'mobile_phones', 'computers', 'real_estate', 'furniture',
  'fashion', 'women_supplies', 'men_supplies', 'kids', 'home_garden', 'sports',
  'gaming_hobbies', 'books_education', 'tools_equipment', 'watches_accessories', 'beauty', 'other',
]);

export function resolveListingCategory(
  input: { category: string; autoCategory?: boolean; title?: string; description?: string },
  infer = (text: string) => parseMarketplaceSearchQuery(text).category,
) {
  if (!input.autoCategory) return input.category;
  try {
    const category = infer(input.title ?? '') ?? infer(input.description ?? '');
    return category && selectableCategories.has(category) ? category : 'other';
  } catch {
    return input.category;
  }
}
