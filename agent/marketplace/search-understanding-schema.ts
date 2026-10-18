import { z } from 'zod';
import { marketplaceCategoryIds } from '@/lib/marketplace/categories';

import {
  rankingPreferenceSchema,
  searchModeSchema,
  sortPreferenceSchema,
  clearableSearchFilterSchema,
} from './structured-search-intent';

export const marketplaceSearchUnderstandingSchema = z.object({
  clearFilters: z.array(clearableSearchFilterSchema).max(19).describe('Explicitly remove these previous constraints during refinement; omitted filters otherwise stay unchanged. Use city to search all cities, minPrice/maxPrice to remove a budget, or terms to replace old product descriptors.').optional(),
  searchMode: searchModeSchema
    .describe(
      'Use new_search for a fresh broad product/category request. Use refine only when the buyer clearly narrows existing results.',
    )
    .optional(),
  category: z.enum(marketplaceCategoryIds).optional(),
  brand: z.string().trim().min(1).max(80).describe('Literal brand spelling used by the customer, not a translated or inferred canonical identity.').optional(),
  model: z.string().trim().min(1).max(80).describe('Literal model spelling used by the customer, not a translated or inferred canonical identity.').optional(),
  city: z.string().trim().min(1).max(80).optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  yearMin: z.number().int().min(1900).max(2099).optional(),
  yearMax: z.number().int().min(1900).max(2099).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  mileageMin: z.number().int().nonnegative().optional(),
  mileageMax: z.number().int().nonnegative().optional(),
  color: z.string().trim().min(1).max(80).optional(),
  requiredFeatures: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  excludedFeatures: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
  excludedColors: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  rankingPreferences: z.array(rankingPreferenceSchema).max(8).optional(),
  sortPreference: sortPreferenceSchema.optional(),
  locationPreference: z.enum(['same_city', 'nearby', 'anywhere']).optional(),
  descriptiveTerms: z
    .array(z.string().trim().min(1).max(80))
    .max(8)
    .describe(
      'Concrete product descriptors that are not represented by structured fields. Never pass search intent words or the full user sentence.',
    )
    .optional(),
});

export type MarketplaceSearchUnderstandingInput = z.infer<
  typeof marketplaceSearchUnderstandingSchema
>;
