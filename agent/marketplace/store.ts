import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { evaluateConversationMessageSafety } from './message-safety';
import { evaluateSaudiMarketplaceCompliance } from './policy';
import {
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from './search';
import type {
  ComplianceDecision,
  CommissionRecord,
  CommissionStatus,
  Conversation,
  ConversationMessage,
  FavoriteRecord,
  ListingDraft,
  ListingImage,
  ListingStatus,
  ReportRecord,
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
const commissions = new Map<string, CommissionRecord>();
let storeLoaded = false;
const storeFilePath = join(process.cwd(), '.data', 'marketplace-store.json');

type PersistedMarketplaceStore = {
  listings: ListingRecord[];
  conversations: Conversation[];
  favorites?: FavoriteRecord[];
  reports?: ReportRecord[];
  commissions?: CommissionRecord[];
};

export type MarketplaceListingFilters = {
  query?: string;
  page?: number;
  limit?: number;
};

const searchStopWords = new Set([
  'ابحث',
  'أبحث',
  'بحث',
  'اريد',
  'أريد',
  'ابي',
  'أبي',
  'احتاج',
  'منتج',
  'منتجات',
  'مساعد',
  'مساعدة',
  'الذكاء',
  'الاصطناعي',
  'بمساعدة',
  'في',
  'عن',
  'من',
  'الى',
  'إلى',
  'على',
  'لي',
  'للبيع',
  'اعلان',
  'إعلان',
]);

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
  const limit = Math.min(Math.max(Math.floor(filters.limit ?? 24), 1), 80);
  const page = Math.max(Math.floor(filters.page ?? 1), 1);

  return {
    limit,
    skip: (page - 1) * limit,
  };
}

function paginateListings<T>(listings: T[], filters: MarketplaceListingFilters) {
  const pagination = getListingPagination(filters);

  return listings.slice(pagination.skip, pagination.skip + pagination.limit);
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
          messages: conversation.messages ?? [],
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

function getSearchTokens(query: string) {
  return parseMarketplaceSearchQuery(query).terms.filter(
    (token) => !searchStopWords.has(token),
  );
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

export function createListingDraft(input: CreateListingDraftInput): ListingRecord {
  loadStore();

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

  const isFirstApprovedImage = !listing.images.some(
    (existingImage) => existingImage.status === 'approved',
  );
  const nextImage = {
    ...image,
    listingId,
    isPrimary: image.isPrimary || isFirstApprovedImage,
  };

  listing.images = [...listing.images, nextImage].slice(0, 10);
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

  if (!filters.query?.trim()) {
    return paginateListings(publishedListings, filters);
  }

  const parsedQuery = parseMarketplaceSearchQuery(filters.query);
  const filteredListings = publishedListings.filter((listing) => {
    if (parsedQuery.category && listing.category !== parsedQuery.category) {
      return false;
    }

    if (
      parsedQuery.city &&
      !normalizeSearchText(listing.city ?? '').includes(
        normalizeSearchText(parsedQuery.city),
      )
    ) {
      return false;
    }

    if (
      parsedQuery.minPrice !== undefined ||
      parsedQuery.maxPrice !== undefined
    ) {
      if (typeof listing.price !== 'number') {
        return false;
      }

      if (
        parsedQuery.minPrice !== undefined &&
        listing.price < parsedQuery.minPrice
      ) {
        return false;
      }

      if (
        parsedQuery.maxPrice !== undefined &&
        listing.price > parsedQuery.maxPrice
      ) {
        return false;
      }
    }

    return true;
  });
  const tokens = getSearchTokens(filters.query);

  if (tokens.length === 0) {
    return paginateListings(filteredListings, filters);
  }

  const scoredListings = filteredListings
    .map((listing) => ({
      listing,
      score: scoreListingForQuery(listing, tokens),
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
      messages: conversation.messages ?? [],
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
    messages: conversation.messages ?? [],
    listing: listings.get(conversation.listingId) ?? null,
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
      conversation: existing,
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

  const trimmedBody = body.trim();
  const safety = evaluateConversationMessageSafety(trimmedBody);
  const timestamp = nowIso();
  const message: ConversationMessage = {
    id: randomUUID(),
    conversationId,
    senderId,
    body: trimmedBody,
    status: safety.decision === 'allow' ? 'sent' : 'blocked',
    reasons: safety.reasons,
    createdAt: timestamp,
  };

  conversation.messages = [...(conversation.messages ?? []), message];
  conversation.updatedAt = timestamp;
  conversations.set(conversation.id, conversation);
  persistStore();

  if (message.status === 'blocked') {
    return {
      status: 'message_blocked' as const,
      message,
      conversation,
    };
  }

  return {
    status: 'sent' as const,
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
  };
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
