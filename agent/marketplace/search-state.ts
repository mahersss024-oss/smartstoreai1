import { prisma } from '@/lib/db/prisma';
import { getMarketplaceTitleTerms } from '@/lib/marketplace/title-search';
import type { Prisma } from '@prisma/client';

import {
  type StructuredSearchIntent,
  structuredSearchIntentSchema,
} from './structured-search-intent';

export type MarketplaceSearchState = StructuredSearchIntent & {
  revision: number;
  updatedAt: string;
};

const memorySearchStates = new Map<string, MarketplaceSearchState>();

function shouldUseDatabaseStore() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

function toJsonObject(state: MarketplaceSearchState) {
  return state as unknown as Prisma.InputJsonObject;
}

function fromStoredState(value: unknown): MarketplaceSearchState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<MarketplaceSearchState>;
  const parsed = structuredSearchIntentSchema.safeParse(candidate);

  if (!parsed.success) {
    return null;
  }

  return {
    ...parsed.data,
    revision:
      typeof candidate.revision === 'number' && Number.isFinite(candidate.revision)
        ? candidate.revision
        : 0,
    updatedAt:
      typeof candidate.updatedAt === 'string'
        ? candidate.updatedAt
        : new Date().toISOString(),
  };
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mergeSearchState(
  current: MarketplaceSearchState | null,
  next: StructuredSearchIntent,
): MarketplaceSearchState {
  // Retain prior filters only for an explicitly requested continuation.
  const base = next.searchMode === 'refine'
    ? current && { ...current } : null;
  if (base) {
    const structuredTerms = getMarketplaceTitleTerms([base.brand, base.model, base.color, ...base.requiredFeatures].filter(Boolean).join(' '));
    base.terms = base.terms.filter(term => !structuredTerms.includes(term));
    for (const field of next.clearFilters ?? []) delete (base as Partial<MarketplaceSearchState>)[field];
    if (next.locationPreference === 'anywhere' && !next.city) delete base.city;
  }
  const updatedAt = new Date().toISOString();
  const searchMode = base ? 'refine' : 'new_search';

  return {
    intent: 'search_listing',
    searchMode,
    category: next.category ?? base?.category,
    brand: next.brand ?? base?.brand,
    model: next.model ?? base?.model,
    city: next.city ?? base?.city,
    minPrice: next.minPrice ?? base?.minPrice,
    maxPrice: next.maxPrice ?? base?.maxPrice,
    yearMin: next.yearMin ?? base?.yearMin,
    yearMax: next.yearMax ?? base?.yearMax,
    condition: next.condition ?? base?.condition,
    mileageMin: next.mileageMin ?? base?.mileageMin,
    mileageMax: next.mileageMax ?? base?.mileageMax,
    color: next.color ?? base?.color,
    requiredFeatures: uniqueStrings([
      ...(base?.requiredFeatures ?? []),
      ...next.requiredFeatures,
    ]),
    excludedFeatures: uniqueStrings([
      ...(base?.excludedFeatures ?? []),
      ...next.excludedFeatures,
    ]),
    excludedColors: uniqueStrings([
      ...(base?.excludedColors ?? []),
      ...next.excludedColors,
    ]),
    rankingPreferences: uniqueStrings([
      ...(base?.rankingPreferences ?? []),
      ...next.rankingPreferences,
    ]) as MarketplaceSearchState['rankingPreferences'],
    sortPreference: next.sortPreference ?? base?.sortPreference,
    locationPreference: next.locationPreference ?? base?.locationPreference,
    terms: uniqueStrings([...(base?.terms ?? []), ...next.terms]),
    termAliases: [...new Map([...(base?.termAliases ?? []), ...(next.termAliases ?? [])].map(entry => [entry.term, entry])).values()].slice(-40),
    rawQuery: next.rawQuery || base?.rawQuery,
    revision: (base?.revision ?? 0) + 1,
    updatedAt,
  };
}

export async function getMarketplaceSearchState(ownerKey: string) {
  if (!shouldUseDatabaseStore()) {
    return memorySearchStates.get(ownerKey) ?? null;
  }

  const record = await prisma.marketplaceSearchState.findUnique({
    where: { ownerKey },
  });

  return fromStoredState(record?.state);
}

export async function updateMarketplaceSearchState(
  ownerKey: string,
  intent: StructuredSearchIntent,
) {
  const current = await getMarketplaceSearchState(ownerKey);
  const next = mergeSearchState(current, intent);

  if (!shouldUseDatabaseStore()) {
    memorySearchStates.set(ownerKey, next);
    return next;
  }

  await prisma.marketplaceSearchState.upsert({
    where: { ownerKey },
    create: {
      ownerKey,
      state: toJsonObject(next),
    },
    update: {
      state: toJsonObject(next),
    },
  });

  return next;
}

export async function resetMarketplaceSearchState(ownerKey: string) {
  if (!shouldUseDatabaseStore()) {
    memorySearchStates.delete(ownerKey);
    return;
  }

  await prisma.marketplaceSearchState.deleteMany({
    where: { ownerKey },
  });
}
