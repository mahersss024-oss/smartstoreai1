import { prisma } from '@/lib/db/prisma';
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

function isDifferentPrimaryTarget(
  current: MarketplaceSearchState | null,
  next: StructuredSearchIntent,
) {
  if (!current) {
    return false;
  }

  if (next.category && current.category && next.category !== current.category) {
    return true;
  }

  if (next.model && current.model && next.model !== current.model) {
    return true;
  }

  return false;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function mergeSearchState(
  current: MarketplaceSearchState | null,
  next: StructuredSearchIntent,
): MarketplaceSearchState {
  const base = isDifferentPrimaryTarget(current, next) ? null : current;
  const updatedAt = new Date().toISOString();

  return {
    intent: 'search_listing',
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
