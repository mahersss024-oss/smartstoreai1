import { z } from 'zod';

import {
  rankingPreferenceSchema,
  sortPreferenceSchema,
} from './structured-search-intent';

export const marketplaceSearchUnderstandingSchema = z.object({
  category: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(80).optional(),
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
