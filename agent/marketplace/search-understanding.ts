import type { AppLanguage } from '@/app/i18n';
import { marketplaceTextAnalyzer } from './text-understanding';
import { marketplaceSearchUnderstandingSchema, type MarketplaceSearchUnderstandingInput } from './search-understanding-schema';

export function parseMarketplaceSearchUnderstanding(text: string): MarketplaceSearchUnderstandingInput {
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const aliases: Record<string, string> = {
    minPrice: 'min_price', maxPrice: 'max_price', yearMin: 'year_min', yearMax: 'year_max',
    mileageMin: 'mileage_min', mileageMax: 'mileage_max', requiredFeatures: 'required_features',
    excludedFeatures: 'excluded_features', excludedColors: 'excluded_colors', rankingPreferences: 'ranking_preferences',
    sortPreference: 'sort_preference', locationPreference: 'location_preference', descriptiveTerms: 'descriptive_terms', searchMode: 'search_mode',
  };
  for (const [field, alias] of Object.entries(aliases)) {
    if (parsed[field] === undefined && parsed[alias] !== undefined) parsed[field] = parsed[alias];
  }
  return marketplaceSearchUnderstandingSchema.parse(parsed);
}

export async function resolveMarketplaceSearchUnderstanding({ query, preliminaryUnderstanding }: {
  query?: string; language?: AppLanguage; preliminaryUnderstanding?: MarketplaceSearchUnderstandingInput;
}) {
  if (!query?.trim()) return preliminaryUnderstanding;
  const analysis = await marketplaceTextAnalyzer.analyze(query);
  if (!analysis) return preliminaryUnderstanding;
  return marketplaceSearchUnderstandingSchema.parse({ ...analysis.search,
    category: analysis.confidence >= 0.8 ? analysis.category ?? undefined : undefined,
    brand: analysis.brand, model: analysis.model,
    ...preliminaryUnderstanding });
}
