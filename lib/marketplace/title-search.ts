import { Prisma } from '@prisma/client';

// Orthographic normalization only, not product synonyms or category inference.
const sourceCharacters = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u06f0\u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9\u0625\u0623\u0622\u0671\u0624\u0626\u0629\u0649\u06a9\u06cc\u200c\u200e\u200f';
const targetCharacters = '01234567890123456789\u0627\u0627\u0627\u0627\u0648\u064a\u0647\u064a\u0643\u064a   ';
const characterMap = new Map([...sourceCharacters].map((character, index) => [character, targetCharacters[index]]));
const ignoredCharacters = '[\u064b-\u065f\u0670\u0640]';

export type PublicMarketplaceListingFilters = {
  query?: string;
  city?: string;
  category?: string;
  categories?: string[];
  minPrice?: number;
  maxPrice?: number;
  condition?: 'new' | 'used' | 'like_new' | 'damaged';
  yearMin?: number;
  yearMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  excludedTerms?: string[];
  sort?: 'best_match' | 'cheapest' | 'newest' | 'closest' | 'best_condition' | 'lowest_mileage';
  page?: number;
  limit?: number;
  take?: number;
};

export function normalizeMarketplaceTitle(value: string) {
  return [...value.normalize('NFKC').toLowerCase()]
    .map(character => characterMap.get(character) ?? character).join('')
    .replace(new RegExp(ignoredCharacters, 'g'), '').replace(/\s+/g, ' ').trim();
}

export function getMarketplaceListingIdLookup(query = ''): string | null {
  let candidate = query.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  let explicit = false;
  if (/^(?:https?:\/\/|\/listings\/)/i.test(candidate)) {
    try {
      const url = new URL(candidate, 'https://marketplace.invalid');
      const match = url.pathname.match(/^\/listings\/([^/]+)\/?$/i);
      if (!match) return null;
      candidate = decodeURIComponent(match[1]);
      explicit = true;
    } catch {
      return null;
    }
  } else {
    const labeled = candidate.match(/^(?:listing(?:\s+id)?|ad(?:\s+id)?|advertisement|\u0631\u0642\u0645\s+(?:\u0627\u0644\u0625\u0639\u0644\u0627\u0646|\u0627\u0644\u0627\u0639\u0644\u0627\u0646))(?:\s*[:#]\s*|\s+)([a-z0-9_-]+)$/i);
    if (labeled) { candidate = labeled[1]; explicit = true; }
  }
  if (!/^[a-z0-9_-]{1,300}$/i.test(candidate)) return null;
  const canonical = /^(?:c[a-z0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|chat-draft-[a-z0-9_-]+)$/i.test(candidate);
  return canonical ? candidate.toLowerCase() : explicit ? candidate : null;
}

const numericAttributeKeys = {
  year: ['year', 'modelYear', '\u0633\u0646\u0629', '\u0645\u0648\u062f\u064a\u0644'],
  mileage: ['mileage', 'odometer', '\u0645\u0645\u0634\u0649', '\u0645\u0645\u0634\u0627\u0647\u0627', '\u0645\u0627\u0634\u064a\u0647'],
};

export function getTitleSearchNumber(listing: { title?: string; attributes: Record<string, unknown> }, field: 'year' | 'mileage') {
  for (const key of numericAttributeKeys[field]) {
    const value = listing.attributes[key];
    const text = typeof value === 'number' || typeof value === 'string' ? normalizeMarketplaceTitle(String(value)) : '';
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  }
  const year = field === 'year' ? normalizeMarketplaceTitle(listing.title ?? '').match(/(?:19|20)\d{2}/)?.[0] : undefined;
  return year ? Number(year) : null;
}

export function titleSearchNumberSql(field: 'year' | 'mileage') {
  const values = numericAttributeKeys[field].map(key => {
    const value = Prisma.sql`translate("attributes" ->> ${key}, ${sourceCharacters}, ${targetCharacters})`;
    return Prisma.sql`CASE WHEN ${value} ~ '^[0-9]+([.][0-9]+)?$' THEN (${value})::numeric END`;
  });
  if (field === 'year') values.push(Prisma.sql`substring(translate(coalesce("title", ''), ${sourceCharacters}, ${targetCharacters}) from '(?:19|20)[0-9]{2}')::numeric`);
  return Prisma.sql`coalesce(${Prisma.join(values)}, NULL::numeric)`;
}

export function matchesPublicListingFilters(listing: { title?: string; category: string; city?: string; price?: number | 'bid' | 'negotiable'; condition?: string; attributes: Record<string, unknown> }, filters: PublicMarketplaceListingFilters) {
  if (filters.city && listing.city !== filters.city) return false;
  if (filters.category && listing.category !== filters.category) return false;
  if (filters.categories?.length && !filters.categories.includes(listing.category)) return false;
  if (filters.condition && listing.condition !== filters.condition) return false;
  if (filters.minPrice !== undefined && (typeof listing.price !== 'number' || listing.price < filters.minPrice)) return false;
  if (filters.maxPrice !== undefined && (typeof listing.price !== 'number' || listing.price > filters.maxPrice)) return false;
  for (const field of ['year', 'mileage'] as const) {
    const min = filters[`${field}Min`];
    const max = filters[`${field}Max`];
    if (min === undefined && max === undefined) continue;
    const value = getTitleSearchNumber(listing, field);
    if (value === null || (min !== undefined && value < min) || (max !== undefined && value > max)) return false;
  }
  return !(filters.excludedTerms ?? []).some(term => {
    const terms = getMarketplaceTitleTerms(term);
    return terms.length > 0 && matchesMarketplaceTitle(listing.title, terms);
  });
}

export function titleSearchConditionScore(condition?: string) {
  return condition === 'new' ? 4 : condition === 'like_new' ? 3 : condition === 'used' ? 2 : condition === 'damaged' ? 1 : 0;
}

export function titleSearchConditionSql() {
  return Prisma.sql`CASE "condition" WHEN 'new' THEN 4 WHEN 'like_new' THEN 3 WHEN 'used' THEN 2 WHEN 'damaged' THEN 1 ELSE 0 END`;
}

export function publicListingFiltersSql(filters: PublicMarketplaceListingFilters) {
  const titlePredicate = marketplaceTitleSearchPredicate(getMarketplaceTitleTerms(filters.query));
  const listingId = getMarketplaceListingIdLookup(filters.query);
  const predicates: Prisma.Sql[] = [listingId
    ? Prisma.sql`"id" = ${listingId}`
    : Prisma.sql`${titlePredicate}`];
  if (filters.city) predicates.push(Prisma.sql`"city" = ${filters.city}`);
  if (filters.category) predicates.push(Prisma.sql`"category" = ${filters.category}`);
  if (filters.categories?.length) predicates.push(Prisma.sql`"category" IN (${Prisma.join(filters.categories)})`);
  if (filters.condition) predicates.push(Prisma.sql`"condition" = ${filters.condition}::"ListingCondition"`);
  if (filters.minPrice !== undefined) predicates.push(Prisma.sql`"price" >= ${filters.minPrice}`);
  if (filters.maxPrice !== undefined) predicates.push(Prisma.sql`"price" <= ${filters.maxPrice}`);
  for (const field of ['year', 'mileage'] as const) {
    const min = filters[`${field}Min`];
    const max = filters[`${field}Max`];
    if (min !== undefined) predicates.push(Prisma.sql`${titleSearchNumberSql(field)} >= ${min}`);
    if (max !== undefined) predicates.push(Prisma.sql`${titleSearchNumberSql(field)} <= ${max}`);
  }
  for (const term of filters.excludedTerms ?? []) {
    const terms = getMarketplaceTitleTerms(term);
    if (terms.length) predicates.push(Prisma.sql`NOT (${marketplaceTitleSearchPredicate(terms)})`);
  }
  return Prisma.join(predicates, ' AND ');
}

export function getMarketplaceTitleTerms(query = '') {
  return [...new Set(normalizeMarketplaceTitle(query).split(' ').filter(Boolean))];
}

export function matchesMarketplaceTitle(title: string | null | undefined, terms: string[]) {
  const normalizedTitle = normalizeMarketplaceTitle(title ?? '');
  return terms.every(term => normalizedTitle.includes(term));
}

export function marketplaceTitleSearchPredicate(terms: string[]) {
  const normalizedTitle = Prisma.sql`regexp_replace(
    translate(lower(normalize(coalesce("title", ''), NFKC)), ${sourceCharacters}, ${targetCharacters}),
    ${ignoredCharacters}, '', 'g'
  )`;
  return terms.length
    ? Prisma.join(terms.map(term => Prisma.sql`strpos(${normalizedTitle}, ${term}) > 0`), ' AND ')
    : Prisma.sql`TRUE`;
}
