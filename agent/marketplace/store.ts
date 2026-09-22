import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { normalizePagination } from '@/lib/pagination';

import { evaluateConversationMessageSafety } from './message-safety';
import {
  ListingLimitReachedError,
  hasReachedSellerListingLimit,
} from './listing-limits';
import {
  getMaxListingImagesPerListing,
  hasReachedListingImageLimit,
} from './listing-image-limits';
import { evaluateSaudiMarketplaceCompliance } from './policy';
import {
  getMarketplaceSearchTermVariants,
  getMarketplaceCitySearchVariants,
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from './search';
import type {
  ComplianceDecision,
  CommissionRecord,
  CommissionStatus,
  Conversation,
  ConversationBlockStatus,
  ConversationMessage,
    FavoriteRecord,
  ListingDraft,
  ListingImage,
  ListingStatus,
  ReportRecord,
  UserBlockRecord,
  UserReportRecord,
  UserReportResolution,
  UserReportStatus,
} from './types';

export type CreateListingDraftInput = {
  id?: string;
  sellerId: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  condition?: ListingDraft['condition'];
  attributes?: Record<string, unknown>;
  images?: ListingImage[];
};

export type ListingRecord = ListingDraft & {
  createdAt: string;
  updatedAt: string;
  views: number;
  messageCount: number;
  favoriteCount: number;
  compliance: ComplianceDecision;
};

const listings = new Map<string, ListingRecord>();
const conversations = new Map<string, Conversation>();
const favorites = new Map<string, FavoriteRecord>();
const reports = new Map<string, ReportRecord>();
const userReports = new Map<string, UserReportRecord>();
const userBlocks = new Map<string, UserBlockRecord>();
const commissions = new Map<string, CommissionRecord>();
let storeLoaded = false;

/**
 * Directory that holds the file-based marketplace store. Defaults to the
 * project-local `.data` folder used in development, but can be overridden
 * with `SMARTSTORE_DATA_DIR` so isolated processes (e.g. parallel test
 * runners) never race on a shared file.
 */
function resolveDataDirectory() {
  const configured = process.env.SMARTSTORE_DATA_DIR?.trim();

  return configured ? configured : join(process.cwd(), '.data');
}

const storeFilePath = join(resolveDataDirectory(), 'marketplace-store.json');

type PersistedMarketplaceStore = {
  listings: ListingRecord[];
  conversations: Conversation[];
  favorites?: FavoriteRecord[];
  reports?: ReportRecord[];
  userReports?: UserReportRecord[];
  userBlocks?: UserBlockRecord[];
  commissions?: CommissionRecord[];
};

export type MarketplaceListingFilters = {
  query?: string;
  category?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: ListingDraft['condition'];
  yearMin?: number;
  yearMax?: number;
  terms?: string[];
  termGroups?: string[][];
  excludedTerms?: string[];
  page?: number;
  limit?: number;
};

function shouldPersistStore() {
  return (
    process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' &&
    process.env.npm_lifecycle_event !== 'test'
  );
}

function nowIso() {
  return new Date().toISOString();
}

function getListingPagination(filters: MarketplaceListingFilters) {
  const pagination = normalizePagination(filters);

  return {
    limit: pagination.limit,
    skip: pagination.skip,
  };
}

function paginateListings<T>(listings: T[], filters: MarketplaceListingFilters) {
  const pagination = getListingPagination(filters);

  return listings.slice(pagination.skip, pagination.skip + pagination.limit);
}

function normalizeConversationMessages(
  messages: Conversation['messages'] = [],
) {
  return messages.map((message) => ({
    ...message,
    type: message.type ?? 'text',
    metadata: message.metadata ?? {},
  }));
}

function persistStore() {
  if (!shouldPersistStore()) {
    return;
  }

  mkdirSync(dirname(storeFilePath), { recursive: true });
  writeFileSync(
    storeFilePath,
    JSON.stringify(
      {
        listings: [...listings.values()],
        conversations: [...conversations.values()],
        favorites: [...favorites.values()],
        reports: [...reports.values()],
        userReports: [...userReports.values()],
        userBlocks: [...userBlocks.values()],
        commissions: [...commissions.values()],
      } satisfies PersistedMarketplaceStore,
      null,
      2,
    ),
  );
}

function loadStore() {
  if (storeLoaded) {
    return;
  }

  storeLoaded = true;

  if (!shouldPersistStore()) {
    return;
  }

  if (!existsSync(storeFilePath)) {
    return;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(storeFilePath, 'utf8'),
    ) as Partial<PersistedMarketplaceStore>;

    for (const listing of parsed.listings ?? []) {
      if (listing.id) {
        listings.set(listing.id, listing);
      }
    }

    for (const conversation of parsed.conversations ?? []) {
      if (conversation.id) {
        conversations.set(conversation.id, {
          ...conversation,
          messages: normalizeConversationMessages(conversation.messages),
        });
      }
    }

    for (const favorite of parsed.favorites ?? []) {
      if (favorite.id) {
        favorites.set(favorite.id, favorite);
      }
    }

    for (const report of parsed.reports ?? []) {
      if (report.id) {
        reports.set(report.id, report);
      }
    }

    for (const report of parsed.userReports ?? []) {
      if (report.id) {
        userReports.set(report.id, report);
      }
    }

    for (const block of parsed.userBlocks ?? []) {
      if (block.id) {
        userBlocks.set(block.id, block);
      }
    }

    for (const commission of parsed.commissions ?? []) {
      if (commission.id) {
        commissions.set(commission.id, commission);
      }
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[marketplace_store] load_failed=${errorName}`);
  }
}

function toSearchText(input: CreateListingDraftInput) {
  return [
    input.category,
    input.title,
    input.description,
    input.city,
    Object.values(input.attributes ?? {}).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeSearchText(value: string) {
  return normalizeMarketplaceSearchText(value);
}

function matchesCityFilter(listingCity: string | undefined, requestedCity: string) {
  const normalizedListingCity = normalizeSearchText(listingCity ?? '');

  return getMarketplaceCitySearchVariants(requestedCity).some((cityVariant) =>
    normalizedListingCity.includes(normalizeSearchText(cityVariant)),
  );
}

function getFilterTermGroups(filters: MarketplaceListingFilters) {
  if (filters.termGroups) {
    return filters.termGroups;
  }

  const parsedQuery = parseMarketplaceSearchQuery(filters.query);
  const terms = filters.terms?.length ? filters.terms : parsedQuery.terms;

  return terms.map(getMarketplaceSearchTermVariants);
}

function toListingSearchText(listing: ListingRecord) {
  return normalizeSearchText(
    [
      listing.category,
      listing.title,
      listing.description,
      listing.city,
      listing.condition,
      Object.values(listing.attributes).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function scoreListingForQuery(listing: ListingRecord, tokens: string[]) {
  const text = toListingSearchText(listing);

  return tokens.reduce((score, token) => {
    if (!text.includes(token)) {
      return score;
    }

    const titleMatch = normalizeSearchText(listing.title ?? '').includes(token);
    const cityMatch = normalizeSearchText(listing.city ?? '').includes(token);
    const categoryMatch = normalizeSearchText(listing.category).includes(token);

    return score + 1 + (titleMatch ? 3 : 0) + (cityMatch ? 2 : 0) + (categoryMatch ? 2 : 0);
  }, 0);
}

function chooseInitialStatus(compliance: ComplianceDecision): ListingStatus {
  if (compliance.decision === 'block') {
    return 'rejected';
  }

  if (compliance.decision === 'needs_review') {
    return 'pending';
  }

  return 'draft';
}

function hasApprovedImage(listing: Pick<ListingRecord, 'images'>) {
  return listing.images.some((image) => image.status === 'approved');
}

function calculateCommissionAmount(productValue: number) {
  return Math.round(productValue * 0.01 * 100) / 100;
}

function ensureCommissionForSoldListing(listing: ListingRecord) {
  const existing = [...commissions.values()].find(
    (commission) => commission.listingId === listing.id,
  );

  if (existing) {
    return existing;
  }

  const timestamp = nowIso();
  const productValue = typeof listing.price === 'number' ? listing.price : null;
  const commission: CommissionRecord = {
    id: randomUUID(),
    listingId: listing.id,
    sellerId: listing.sellerId,
    productValue,
    commissionRatePercent: 1,
    commissionAmount:
      typeof productValue === 'number'
        ? calculateCommissionAmount(productValue)
        : null,
    status: typeof productValue === 'number' ? 'due' : 'pending_amount',
    source: 'site_sale',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  commissions.set(commission.id, commission);
  return commission;
}

function seedListings() {
  loadStore();
}

/**
 * Higher scores surface first in the moderation queue: open reports outrank
 * resolved ones, and accounts that accumulate several reports (or reports that
 * keep several open reports on the same target) rise above single reports.
 */
function getUserReportPriority(report: UserReportRecord) {
  const openReportsOnTarget = [...userReports.values()].filter(
    (candidate) =>
      candidate.targetUserId === report.targetUserId &&
      candidate.status === 'open',
  ).length;

  return (report.status === 'open' ? 1000 : 0) + openReportsOnTarget;
}

export function createListingDraft(input: CreateListingDraftInput): ListingRecord {
  loadStore();

  const sellerListingCount = [...listings.values()].filter(
    (listing) =>
      listing.sellerId === input.sellerId && listing.status !== 'deleted',
  ).length;

  if (hasReachedSellerListingLimit(sellerListingCount)) {
    throw new ListingLimitReachedError();
  }

  const compliance = evaluateSaudiMarketplaceCompliance(toSearchText(input));
  const timestamp = nowIso();
  const listing: ListingRecord = {
    id: input.id ?? randomUUID(),
    sellerId: input.sellerId,
    category: input.category,
    title: input.title,
    description: input.description,
    price: input.price,
    city: input.city,
    condition: input.condition,
    images: input.images ?? [],
    attributes: input.attributes ?? {},
    status: chooseInitialStatus(compliance),
    createdAt: timestamp,
    updatedAt: timestamp,
    views: 0,
    messageCount: 0,
    favoriteCount: 0,
    compliance,
  };

  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function resetMarketplaceStoreForTests() {
  listings.clear();
  conversations.clear();
  favorites.clear();
  reports.clear();
  userReports.clear();
  userBlocks.clear();
  commissions.clear();
  storeLoaded = true;
}

export function publishListing(listingId: string) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing) {
    return null;
  }

  if (listing.compliance.decision !== 'allow') {
    listing.status = listing.compliance.decision === 'block' ? 'rejected' : 'pending';
  } else {
    listing.status = 'published';
  }

  listing.updatedAt = nowIso();
  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function updateListingForSeller(
  listingId: string,
  sellerId: string,
  updates: Partial<
    Pick<
      ListingRecord,
      'title' | 'description' | 'price' | 'city' | 'condition' | 'category'
    >
  > & {
    attributes?: Record<string, unknown>;
  },
) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing || listing.sellerId !== sellerId) {
    return null;
  }

  const compliance = evaluateSaudiMarketplaceCompliance(
    [
      updates.category ?? listing.category,
      updates.title ?? listing.title,
      updates.description ?? listing.description,
      updates.city ?? listing.city,
      Object.values({ ...listing.attributes, ...updates.attributes }).join(' '),
    ]
      .filter(Boolean)
      .join(' '),
  );

  const nextListing: ListingRecord = {
    ...listing,
    ...updates,
    attributes: {
      ...listing.attributes,
      ...(updates.attributes ?? {}),
    },
    compliance,
    status:
      compliance.decision === 'block'
        ? 'rejected'
        : compliance.decision === 'needs_review'
          ? 'pending'
          : listing.status,
    updatedAt: nowIso(),
  };

  listings.set(nextListing.id, nextListing);
  persistStore();
  return nextListing;
}

export function setListingStatusForSeller(
  listingId: string,
  sellerId: string,
  status: Extract<ListingStatus, 'published' | 'paused' | 'sold' | 'deleted'>,
) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing || listing.sellerId !== sellerId) {
    return null;
  }

  if (status === 'published' && listing.compliance.decision !== 'allow') {
    listing.status =
      listing.compliance.decision === 'block' ? 'rejected' : 'pending';
  } else if (status === 'published' && !hasApprovedImage(listing)) {
    listing.status = 'pending';
  } else {
    listing.status = status;
  }

  listing.updatedAt = nowIso();
  if (listing.status === 'sold') {
    ensureCommissionForSoldListing(listing);
  }
  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function addListingImageForSeller(
  listingId: string,
  sellerId: string,
  image: ListingImage,
) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing || listing.sellerId !== sellerId) {
    return null;
  }

  if (hasReachedListingImageLimit(listing.images)) {
    return listing;
  }

  const isFirstApprovedImage = !listing.images.some(
    (existingImage) => existingImage.status === 'approved',
  );
  const nextImage = {
    ...image,
    listingId,
    isPrimary: image.isPrimary || isFirstApprovedImage,
  };

  listing.images = [...listing.images, nextImage].slice(
    0,
    getMaxListingImagesPerListing(),
  );
  listing.updatedAt = nowIso();
  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function deleteListingImageForSeller(
  listingId: string,
  sellerId: string,
  imageId: string,
) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing || listing.sellerId !== sellerId) {
    return null;
  }

  const imageToDelete = listing.images.find((image) => image.id === imageId);

  if (!imageToDelete) {
    return null;
  }

  const remainingImages = listing.images.filter((image) => image.id !== imageId);

  if (
    imageToDelete.isPrimary &&
    !remainingImages.some((image) => image.isPrimary)
  ) {
    const nextPrimaryImage = remainingImages.find(
      (image) => image.status === 'approved',
    );

    if (nextPrimaryImage) {
      nextPrimaryImage.isPrimary = true;
    }
  }

  listing.images = remainingImages;
  listing.updatedAt = nowIso();
  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function setPrimaryListingImageForSeller(
  listingId: string,
  sellerId: string,
  imageId: string,
) {
  loadStore();

  const listing = listings.get(listingId);

  if (!listing || listing.sellerId !== sellerId) {
    return null;
  }

  const selectedImage = listing.images.find((image) => image.id === imageId);

  if (!selectedImage) {
    return null;
  }

  listing.images = listing.images.map((image) => ({
    ...image,
    isPrimary: image.id === imageId,
  }));
  listing.updatedAt = nowIso();
  listings.set(listing.id, listing);
  persistStore();
  return listing;
}

export function listMarketplaceListings(filters: MarketplaceListingFilters = {}) {
  seedListings();
  const publishedListings = [...listings.values()]
    .filter((listing) => listing.status === 'published')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (
    !filters.query?.trim() &&
    !filters.category &&
    !filters.city &&
    filters.minPrice === undefined &&
    filters.maxPrice === undefined &&
    !filters.condition &&
    filters.yearMin === undefined &&
    filters.yearMax === undefined &&
    !filters.terms?.length &&
    !filters.termGroups?.length &&
    !filters.excludedTerms?.length
  ) {
    return paginateListings(publishedListings, filters);
  }

  const parsedQuery = parseMarketplaceSearchQuery(filters.query);
  const category = filters.category ?? parsedQuery.category;
  const city = filters.city ?? parsedQuery.city;
  const minPrice = filters.minPrice ?? parsedQuery.minPrice;
  const maxPrice = filters.maxPrice ?? parsedQuery.maxPrice;
  const yearMin = filters.yearMin ?? parsedQuery.yearMin;
  const yearMax = filters.yearMax ?? parsedQuery.yearMax;
  const filteredListings = publishedListings.filter((listing) => {
    if (category && listing.category !== category) {
      return false;
    }

    if (city && !matchesCityFilter(listing.city, city)) {
      return false;
    }

    if (filters.condition && listing.condition !== filters.condition) {
      return false;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
      if (typeof listing.price !== 'number') {
        return false;
      }

      if (
        minPrice !== undefined &&
        listing.price < minPrice
      ) {
        return false;
      }

      if (
        maxPrice !== undefined &&
        listing.price > maxPrice
      ) {
        return false;
      }
    }

    if (yearMin !== undefined || yearMax !== undefined) {
      const text = toListingSearchText(listing);
      const years = Array.from(text.matchAll(/(?:19|20)\d{2}/g)).map((match) =>
        Number.parseInt(match[0], 10),
      );

      if (
        years.length > 0 &&
        !years.some(
          (year) =>
            (yearMin === undefined || year >= yearMin) &&
            (yearMax === undefined || year <= yearMax),
        )
      ) {
        return false;
      }
    }

    for (const excludedTerm of filters.excludedTerms ?? []) {
      if (toListingSearchText(listing).includes(normalizeSearchText(excludedTerm))) {
        return false;
      }
    }

    return true;
  });
  const termGroups = getFilterTermGroups(filters);

  if (termGroups.length === 0) {
    return paginateListings(filteredListings, filters);
  }

  const scoredListings = filteredListings
    .map((listing) => ({
      listing,
      score: termGroups.reduce(
        (score, termGroup) =>
          score +
          Math.max(
            ...termGroup.map((term) => scoreListingForQuery(listing, [term])),
          ),
        0,
      ),
    }))
    .filter((result) => result.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.listing.updatedAt.localeCompare(left.listing.updatedAt);
    })
    .map((result) => result.listing);

  return paginateListings(scoredListings, filters);
}

export function listSellerListings(sellerId: string) {
  seedListings();
  return [...listings.values()]
    .filter(
      (listing) => listing.sellerId === sellerId && listing.status !== 'deleted',
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function resetIncompleteSellerDrafts(sellerId: string) {
  seedListings();

  const timestamp = nowIso();
  const deletedDrafts: ListingRecord[] = [];

  for (const listing of listings.values()) {
    const hasListingDetails = Boolean(
      listing.title?.trim() ||
        listing.description?.trim() ||
        listing.city?.trim() ||
        listing.images.length > 0,
    );

    if (
      listing.sellerId !== sellerId ||
      listing.status !== 'draft' ||
      hasListingDetails
    ) {
      continue;
    }

    const deletedListing: ListingRecord = {
      ...listing,
      status: 'deleted',
      updatedAt: timestamp,
    };

    listings.set(deletedListing.id, deletedListing);
    deletedDrafts.push(deletedListing);
  }

  if (deletedDrafts.length) {
    persistStore();
  }

  return deletedDrafts;
}

export function getListing(listingId: string) {
  seedListings();
  return listings.get(listingId) ?? null;
}

export function listUserConversations(userId: string) {
  seedListings();

  return [...conversations.values()]
    .filter(
      (conversation) =>
        conversation.buyerId === userId || conversation.sellerId === userId,
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((conversation) => ({
      ...conversation,
      messages: normalizeConversationMessages(conversation.messages),
      listing: listings.get(conversation.listingId) ?? null,
    }));
}

export function getConversationForUser(conversationId: string, userId: string) {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (
    !conversation ||
    (conversation.buyerId !== userId && conversation.sellerId !== userId)
  ) {
    return null;
  }

  return {
    ...conversation,
    messages: normalizeConversationMessages(conversation.messages),
    listing: listings.get(conversation.listingId) ?? null,
  };
}

function getOtherConversationUser(conversation: Conversation, userId: string) {
  if (conversation.buyerId === userId) {
    return conversation.sellerId;
  }

  if (conversation.sellerId === userId) {
    return conversation.buyerId;
  }

  return null;
}

export function getConversationBlockStatus(
  conversationId: string,
  userId: string,
): ConversationBlockStatus | null {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return null;
  }

  const otherUserId = getOtherConversationUser(conversation, userId);

  if (!otherUserId) {
    return null;
  }

  const block = [...userBlocks.values()].find(
    (candidate) =>
      (candidate.blockerId === userId && candidate.blockedId === otherUserId) ||
      (candidate.blockerId === otherUserId && candidate.blockedId === userId),
  );

  if (!block) {
    return { blocked: false, blockedByMe: false };
  }

  return {
    blocked: true,
    blockedByMe: block.blockerId === userId,
    blockerId: block.blockerId,
    blockedUserId: block.blockedId,
  };
}

export function reportConversationUser(
  conversationId: string,
  reporterId: string,
  input: { reason: string; details?: string },
) {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return {
      status: 'not_found' as const,
      report: null,
      conversation: null,
    };
    }

  const targetUserId = getOtherConversationUser(conversation, reporterId);

  if (!targetUserId) {
    return {
      status: 'not_found' as const,
      report: null,
      conversation: null,
    };
  }

  const existingOpenReport = [...userReports.values()].find(
    (candidate) =>
      candidate.reporterId === reporterId &&
      candidate.targetUserId === targetUserId &&
      candidate.conversationId === conversationId &&
      candidate.status === 'open',
  );

  if (existingOpenReport) {
    return {
      status: 'already_reported' as const,
      report: existingOpenReport,
      conversation,
    };
  }

  const timestamp = nowIso();
  const report: UserReportRecord = {
    id: randomUUID(),
    reporterId,
    targetUserId,
    conversationId,
    reason: input.reason,
    details: input.details,
    status: 'open',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  userReports.set(report.id, report);
  persistStore();

  return {
    status: 'reported' as const,
    report,
    conversation,
  };
}

export function blockConversationUser(
  conversationId: string,
  blockerId: string,
  reason?: string,
) {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return {
      status: 'not_found' as const,
      block: null,
      conversation: null,
    };
  }

  const blockedId = getOtherConversationUser(conversation, blockerId);

  if (!blockedId) {
    return {
      status: 'not_found' as const,
      block: null,
      conversation: null,
    };
  }

  const existingBlock = [...userBlocks.values()].find(
    (block) => block.blockerId === blockerId && block.blockedId === blockedId,
  );

  if (existingBlock) {
    return {
      status: 'blocked' as const,
      block: existingBlock,
      conversation,
    };
  }

  const block: UserBlockRecord = {
    id: randomUUID(),
    blockerId,
    blockedId,
    conversationId,
    reason,
    createdAt: nowIso(),
  };

  userBlocks.set(block.id, block);
  persistStore();

  return {
    status: 'blocked' as const,
    block,
    conversation,
  };
}

export function listUserFavorites(userId: string) {
  seedListings();

  return [...favorites.values()]
    .filter((favorite) => favorite.userId === userId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .map((favorite) => ({
      ...favorite,
      listing: listings.get(favorite.listingId) ?? null,
    }));
}

export function getListingFavoriteState(listingId: string, userId: string) {
  const listing = getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return {
      status: 'not_found' as const,
      isFavorite: false,
      canFavorite: false,
      listing: null,
    };
  }

  if (listing.sellerId === userId) {
    return {
      status: 'ok' as const,
      isFavorite: false,
      canFavorite: false,
      listing,
    };
  }

  return {
    status: 'ok' as const,
    isFavorite: [...favorites.values()].some(
      (favorite) =>
        favorite.listingId === listingId && favorite.userId === userId,
    ),
    canFavorite: true,
    listing,
  };
}

export function createConversationForListing(listingId: string, buyerId: string) {
  const listing = getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return {
      status: 'not_found' as const,
      conversation: null,
    };
  }

  if (listing.sellerId === buyerId) {
    return {
      status: 'self_contact_blocked' as const,
      conversation: null,
    };
  }

  const existing = [...conversations.values()].find(
    (conversation) =>
      conversation.listingId === listingId &&
      conversation.sellerId === listing.sellerId &&
      conversation.buyerId === buyerId,
  );

  if (existing) {
    return {
      status: 'existing' as const,
      conversation: {
        ...existing,
        messages: normalizeConversationMessages(existing.messages),
      },
    };
  }

  const timestamp = nowIso();
  const conversation: Conversation = {
    id: randomUUID(),
    listingId,
    sellerId: listing.sellerId,
    buyerId,
    status: 'open',
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  conversations.set(conversation.id, conversation);
  listing.messageCount += 1;
  listing.updatedAt = timestamp;
  listings.set(listing.id, listing);
  persistStore();

  return {
    status: 'created' as const,
    conversation,
  };
}

export function addConversationMessage(
  conversationId: string,
  senderId: string,
  body: string,
) {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (
    !conversation ||
    (conversation.buyerId !== senderId && conversation.sellerId !== senderId)
  ) {
    return {
      status: 'not_found' as const,
      message: null,
      conversation: null,
    };
  }

  if (conversation.status !== 'open') {
    return {
      status: 'conversation_closed' as const,
      message: null,
      conversation,
    };
  }

  const blockStatus = getConversationBlockStatus(conversationId, senderId);

  if (blockStatus?.blocked) {
    return {
      status: 'conversation_blocked' as const,
      message: null,
      conversation,
      blockStatus,
    };
  }

  const trimmedBody = body.trim();
  const safety = evaluateConversationMessageSafety(trimmedBody);

  if (safety.decision !== 'allow') {
    return {
      status: 'message_blocked' as const,
      message: null,
      conversation,
      reasons: safety.reasons,
    };
  }

  const timestamp = nowIso();
  const message: ConversationMessage = {
    id: randomUUID(),
    conversationId,
    senderId,
    body: trimmedBody,
    status: 'sent',
    type: 'text',
    reasons: safety.reasons,
    metadata: {},
    createdAt: timestamp,
  };

  conversation.messages = [...(conversation.messages ?? []), message];
  conversation.updatedAt = timestamp;
  conversations.set(conversation.id, conversation);
  persistStore();

  return {
    status: 'sent' as const,
    message,
    conversation,
  };
}

export function shareSellerContact(
  conversationId: string,
  sellerId: string,
  phoneNumber?: string | null,
) {
  seedListings();
  const conversation = conversations.get(conversationId);

  if (!conversation) {
    return {
      status: 'not_found' as const,
      message: null,
      conversation: null,
    };
  }

  if (conversation.buyerId !== sellerId && conversation.sellerId !== sellerId) {
    return {
      status: 'not_found' as const,
      message: null,
      conversation: null,
    };
  }

  if (conversation.sellerId !== sellerId) {
    return {
      status: 'not_seller' as const,
      message: null,
      conversation,
    };
  }

  if (conversation.status !== 'open') {
    return {
      status: 'conversation_closed' as const,
      message: null,
      conversation,
    };
  }

  const blockStatus = getConversationBlockStatus(conversationId, sellerId);

  if (blockStatus?.blocked) {
    return {
      status: 'conversation_blocked' as const,
      message: null,
      conversation,
      blockStatus,
    };
  }

  if (!phoneNumber) {
    return {
      status: 'missing_phone' as const,
      message: null,
      conversation,
    };
  }

  const timestamp = nowIso();
  const message: ConversationMessage = {
    id: randomUUID(),
    conversationId,
    senderId: sellerId,
    body: 'official_contact_share',
    status: 'sent',
    type: 'contact_share',
    reasons: ['official_contact_share'],
    metadata: { phoneNumber },
    createdAt: timestamp,
  };

  conversation.messages = [...(conversation.messages ?? []), message];
  conversation.updatedAt = timestamp;
  conversations.set(conversation.id, conversation);
  persistStore();

  return {
    status: 'shared' as const,
    message,
    conversation,
  };
}

export function toggleFavoriteListing(listingId: string, userId: string) {
  const listing = getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return {
      status: 'not_found' as const,
      favorite: null,
      listing: null,
    };
  }

  if (listing.sellerId === userId) {
    return {
      status: 'self_favorite_blocked' as const,
      favorite: null,
      listing,
    };
  }

  const existing = [...favorites.values()].find(
    (favorite) =>
      favorite.listingId === listingId && favorite.userId === userId,
  );

  if (existing) {
    favorites.delete(existing.id);
    listing.favoriteCount = Math.max(0, listing.favoriteCount - 1);
    listing.updatedAt = nowIso();
    listings.set(listing.id, listing);
    persistStore();

    return {
      status: 'removed' as const,
      favorite: null,
      listing,
    };
  }

  const favorite: FavoriteRecord = {
    id: randomUUID(),
    listingId,
    userId,
    createdAt: nowIso(),
  };

  favorites.set(favorite.id, favorite);
  listing.favoriteCount += 1;
  listing.updatedAt = favorite.createdAt;
  listings.set(listing.id, listing);
  persistStore();

  return {
    status: 'saved' as const,
    favorite,
    listing,
  };
}

export function reportListing(
  listingId: string,
  reporterId: string,
  reason: string,
  details?: string,
) {
  const listing = getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return {
      status: 'not_found' as const,
      report: null,
      listing: null,
    };
  }

  const report: ReportRecord = {
    id: randomUUID(),
    listingId,
    reporterId,
    reason,
    details,
    status: 'open',
    createdAt: nowIso(),
  };

  reports.set(report.id, report);
  persistStore();

  return {
    status: 'reported' as const,
    report,
    listing,
  };
}

export function listModerationQueue() {
  seedListings();

  return {
    listings: [...listings.values()]
      .filter(
        (listing) =>
          listing.status === 'pending' || listing.status === 'rejected',
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    reports: [...reports.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map((report) => ({
        ...report,
        listing: listings.get(report.listingId) ?? null,
      })),
    userReports: [...userReports.values()]
      .sort((left, right) => {
        const priorityDiff =
          getUserReportPriority(right) - getUserReportPriority(left);

        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        return right.createdAt.localeCompare(left.createdAt);
      })
      .map((report) => ({
        ...report,
        conversation: report.conversationId
          ? conversations.get(report.conversationId) ?? null
          : null,
      })),
  };
}

export function setUserReportModerationStatus(
  reportId: string,
  resolution: UserReportResolution,
  adminId?: string,
) {
  seedListings();
  const report = userReports.get(reportId);

  if (!report) {
    return { status: 'not_found' as const, report: null };
  }
  if (report.status !== 'open') {
    return { status: 'already_resolved' as const, report };
  }

  const status: UserReportStatus =
    resolution === 'review'
      ? 'open'
      : resolution === 'dismiss'
        ? 'dismissed'
        : 'reviewed';

  report.status = status;
  report.resolution = resolution;
  report.resolvedBy = adminId ?? report.resolvedBy;
  report.resolvedAt = resolution === 'review' ? undefined : nowIso();
  report.updatedAt = nowIso();
  userReports.set(report.id, report);

  const shouldCloseConversation =
    resolution === 'close_conversation' || resolution === 'restrict';

  if (shouldCloseConversation && report.conversationId) {
    const conversation = conversations.get(report.conversationId);
    if (conversation) {
      conversation.status = 'closed';
      conversation.updatedAt = nowIso();
      conversations.set(conversation.id, conversation);
    }

    const block: UserBlockRecord = {
      id: randomUUID(),
      blockerId: report.reporterId,
      blockedId: report.targetUserId,
      conversationId: report.conversationId,
      reason: 'admin_moderation',
      createdAt: nowIso(),
    };
    userBlocks.set(`${block.blockerId}:${block.blockedId}`, block);
  }

  persistStore();
  return { status: report.status, report };
}

export function setListingModerationStatus(
  listingId: string,
  status: Extract<ListingStatus, 'published' | 'rejected' | 'deleted'>,
) {
  const listing = getListing(listingId);

  if (!listing) {
    return {
      status: 'not_found' as const,
      listing: null,
    };
  }

  if (status === 'published' && listing.compliance.decision === 'block') {
    return {
      status: 'blocked_by_policy' as const,
      listing,
    };
  }

  listing.status = status;
  listing.updatedAt = nowIso();
  listings.set(listing.id, listing);
  persistStore();

  return {
    status: listing.status,
    listing,
  };
}

export function setReportModerationStatus(
  reportId: string,
  status: Extract<ReportRecord['status'], 'reviewed' | 'dismissed'>,
) {
  seedListings();
  const report = reports.get(reportId);

  if (!report) {
    return {
      status: 'not_found' as const,
      report: null,
    };
  }

  report.status = status;
  reports.set(report.id, report);
  persistStore();

  return {
    status: report.status,
    report,
  };
}

export function listSellerCommissions(sellerId: string) {
  seedListings();

  return [...commissions.values()]
    .filter((commission) => commission.sellerId === sellerId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((commission) => ({
      ...commission,
      listing: listings.get(commission.listingId) ?? null,
    }));
}

export function listAdminCommissions() {
  seedListings();

  return [...commissions.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((commission) => ({
      ...commission,
      listing: listings.get(commission.listingId) ?? null,
    }));
}

export function updateCommissionSaleAmountForSeller(
  commissionId: string,
  sellerId: string,
  productValue: number,
) {
  seedListings();
  const commission = commissions.get(commissionId);

  if (!commission || commission.sellerId !== sellerId) {
    return {
      status: 'not_found' as const,
      commission: null,
    };
  }

  if (commission.status === 'paid' || commission.status === 'waived') {
    return {
      status: 'locked' as const,
      commission,
    };
  }

  commission.productValue = productValue;
  commission.commissionAmount = calculateCommissionAmount(productValue);
  commission.status = 'due';
  commission.updatedAt = nowIso();
  commissions.set(commission.id, commission);
  persistStore();

  return {
    status: 'updated' as const,
    commission,
  };
}

export function setCommissionStatusForAdmin(
  commissionId: string,
  status: Extract<CommissionStatus, 'due' | 'paid' | 'waived' | 'disputed'>,
) {
  seedListings();
  const commission = commissions.get(commissionId);

  if (!commission) {
    return {
      status: 'not_found' as const,
      commission: null,
    };
  }

  commission.status = status;
  commission.paidAt = status === 'paid' ? nowIso() : commission.paidAt;
  commission.updatedAt = nowIso();
  commissions.set(commission.id, commission);
  persistStore();

  return {
    status: commission.status,
    commission,
  };
}
