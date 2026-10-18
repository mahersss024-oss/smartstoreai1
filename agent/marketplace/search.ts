import { marketplaceTextAnalyzer } from './text-understanding';

export type ParsedMarketplaceSearchQuery = {
  category?: string; city?: string; minPrice?: number; maxPrice?: number;
  yearMin?: number; yearMax?: number; terms: string[]; termGroups: string[][];
};

export function normalizeMarketplaceSearchText(value: string) {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u200c\u200e\u200f]/g, ' ')
    .replace(/[\u0625\u0623\u0622\u0671]/g, '\u0627')
    .replace(/\u0624/g, '\u0648').replace(/\u0626/g, '\u064a')
    .replace(/\u0629/g, '\u0647').replace(/\u0649/g, '\u064a')
    .replace(/\u06a9/g, '\u0643').replace(/\u06cc/g, '\u064a')
    .replace(/\s+/g, ' ').trim();
}

export function getMarketplaceSearchTermVariants(term: string, context = term, knownAliases?: Array<{ term: string; variants: string[] }>) {
  const analysis = marketplaceTextAnalyzer.peek(context);
  const normalized = normalizeMarketplaceSearchText(term);
  const entry = (knownAliases ?? analysis?.aliases)?.find(item =>
    [item.term, ...item.variants].some(value => normalizeMarketplaceSearchText(value) === normalized));
  return [...new Set([term, ...(entry?.variants ?? [])].flatMap(value => [value, normalizeMarketplaceSearchText(value)]).filter(Boolean))];
}

export function getMarketplaceCitySearchVariants(city?: string, context = city) {
  return city ? getMarketplaceSearchTermVariants(city, context) : [];
}

export function parseMarketplaceSearchQuery(query: string | null | undefined): ParsedMarketplaceSearchQuery {
  const text = query?.trim() ?? '';
  const analysis = marketplaceTextAnalyzer.peek(text);
  const terms = analysis
    ? [...(analysis.brand ? [analysis.brand] : []), ...(analysis.model ? [analysis.model] : []),
      ...(analysis.search.color ? [analysis.search.color] : []), ...analysis.search.requiredFeatures, ...analysis.search.descriptiveTerms]
    : normalizeMarketplaceSearchText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return {
    category: analysis && analysis.confidence >= 0.8 ? analysis.category ?? undefined : undefined,
    city: analysis?.search.city, minPrice: analysis?.search.minPrice, maxPrice: analysis?.search.maxPrice,
    yearMin: analysis?.search.yearMin, yearMax: analysis?.search.yearMax,
    terms, termGroups: terms.map(term => getMarketplaceSearchTermVariants(term, text)),
  };
}
