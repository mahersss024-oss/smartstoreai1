import { z } from 'zod';
import { parseMarketplaceSearchQuery } from './search';
import { marketplaceTextAnalyzer } from './text-understanding';

export const rankingPreferenceSchema = z.enum(['relevance', 'price', 'location', 'condition', 'mileage', 'year', 'listing_quality', 'freshness', 'engagement']);
export const sortPreferenceSchema = z.enum(['best_match', 'cheapest', 'newest', 'closest', 'best_condition', 'lowest_mileage']);
export const searchModeSchema = z.enum(['new_search', 'refine']);
export const clearableSearchFilterSchema = z.enum(['category', 'brand', 'model', 'city', 'minPrice', 'maxPrice', 'yearMin', 'yearMax', 'condition', 'mileageMin', 'mileageMax', 'color', 'requiredFeatures', 'excludedFeatures', 'excludedColors', 'sortPreference', 'locationPreference', 'terms']);
export const structuredSearchIntentSchema = z.object({
  intent: z.literal('search_listing').default('search_listing'), searchMode: searchModeSchema.optional(),
  category: z.string().min(1).optional(), brand: z.string().min(1).optional(), model: z.string().min(1).optional(), city: z.string().min(1).optional(),
  minPrice: z.number().nonnegative().optional(), maxPrice: z.number().nonnegative().optional(),
  yearMin: z.number().int().min(1900).max(2099).optional(), yearMax: z.number().int().min(1900).max(2099).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  mileageMin: z.number().int().nonnegative().optional(), mileageMax: z.number().int().nonnegative().optional(),
  color: z.string().min(1).optional(), requiredFeatures: z.array(z.string().min(1)).default([]), excludedFeatures: z.array(z.string().min(1)).default([]),
  excludedColors: z.array(z.string().min(1)).default([]), rankingPreferences: z.array(rankingPreferenceSchema).default([]),
  sortPreference: sortPreferenceSchema.optional(), locationPreference: z.enum(['same_city', 'nearby', 'anywhere']).optional(),
  terms: z.array(z.string()).default([]), rawQuery: z.string().optional(),
  clearFilters: z.array(clearableSearchFilterSchema).optional(),
  termAliases: z.array(z.object({ term: z.string().min(1).max(160), variants: z.array(z.string().min(1).max(160)).max(12) })).max(40).optional(),
});
export type StructuredSearchIntent = z.infer<typeof structuredSearchIntentSchema>;
export type MarketplaceSearchState = StructuredSearchIntent & {
  revision: number;
  updatedAt: string;
};
export type RankingPreference = z.infer<typeof rankingPreferenceSchema>;
export type SortPreference = z.infer<typeof sortPreferenceSchema>;
export type SearchMode = z.infer<typeof searchModeSchema>;

export function parseStructuredSearchIntent(query: string | null | undefined): StructuredSearchIntent {
  const rawQuery = query?.trim() ?? '';
  const analysis = marketplaceTextAnalyzer.peek(rawQuery);
  const parsed = parseMarketplaceSearchQuery(rawQuery);
  return structuredSearchIntentSchema.parse({ ...parsed, ...analysis?.search,
    terms: analysis?.search.descriptiveTerms ?? parsed.terms,
    brand: analysis?.brand, model: analysis?.model, rawQuery, termAliases: analysis?.aliases });
}
