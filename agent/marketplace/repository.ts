import type { AuthSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import {
  type PaginationInput,
  normalizePagination,
  toPaginatedResponse,
} from '@/lib/pagination';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import type {
  PublishRealtimeEventInput,
  RealtimeEventVisibility,
} from '@/lib/realtime/events';
import { Prisma, type AdminAuditAction } from '@prisma/client';

import { evaluateSaudiMarketplaceCompliance } from './policy';
import {
  getMarketplaceSearchTermVariants,
  getMarketplaceCitySearchVariants,
  normalizeMarketplaceSearchText,
  parseMarketplaceSearchQuery,
} from './search';
import * as memoryStore from './store';
import type {
  ComplianceDecision,
  CommissionRecord,
  CommissionStatus,
  Conversation,
  ConversationBlockStatus,
  ConversationMessage,
  FavoriteRecord,
  ListingCondition,
    ListingImage,
  ListingStatus,
  ReportRecord,
  UserReportResolution,
  UserReportStatus,
} from './types';
import { evaluateConversationMessageSafety } from './message-safety';
import {
  ListingLimitReachedError,
  hasReachedSellerListingLimit,
} from './listing-limits';
import {
  getMaxListingImagesPerListing,
  hasReachedListingImageLimit,
} from './listing-image-limits';
import { normalizeListingImageDeliveryUrls } from './listing-image-delivery';
import { deleteListingObject } from './object-storage';

type DatabaseListingRecord = {
  id: string;
  sellerId: string;
  category: string;
  title: string | null;
  description: string | null;
  price: unknown;
  priceMode: string | null;
  city: string | null;
  condition: string | null;
  attributes: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  views: number;
  messageCount: number;
  favoriteCount: number;
  compliance: unknown;
  images?: Array<{
    id: string;
    listingId: string;
    originalUrl: string;
    displayUrl: string;
    thumbnailUrl: string;
    isPrimary: boolean;
    qualityScore: number;
    status: string;
    enhancements: string[];
  }>;
};

type Actor = AuthSessionUser | string;

type DatabaseConversationRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    conversationId: string;
    senderId: string;
    body: string;
    status: string;
    type?: string;
    reasons: string[];
    metadata?: unknown;
    createdAt: Date;
  }>;
  listing?: DatabaseListingRecord | null;
};

type DatabaseFavoriteRecord = {
  id: string;
  listingId: string;
  userId: string;
  createdAt: Date;
  listing?: DatabaseListingRecord | null;
};

type DatabaseReportRecord = {
  id: string;
  listingId: string;
  reporterId: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: Date;
  listing?: DatabaseListingRecord | null;
};

type DatabaseCommissionRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  productValue: unknown;
  commissionRatePercent: unknown;
  commissionAmount: unknown;
  status: string;
  source: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  listing?: DatabaseListingRecord | null;
};

export type MarketplaceListingFilters = {
  query?: string;
  category?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: ListingCondition;
  yearMin?: number;
  yearMax?: number;
  terms?: string[];
  termGroups?: string[][];
  excludedTerms?: string[];
  page?: number;
  limit?: number;
};

export type CreateListingInput = {
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  condition?: ListingCondition;
  attributes?: Record<string, unknown>;
};

function shouldUseDatabaseStore() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

function toSearchText(input: CreateListingInput) {
  return [
    input.category,
    input.title,
    input.description,
    input.city,
    input.condition,
    Object.values(input.attributes ?? {}).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
}

function toNormalizedListingSearchText(input: CreateListingInput) {
  return normalizeMarketplaceSearchText(toSearchText(input));
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

function hasApprovedImage(listing: { images: ListingImage[] }) {
  return listing.images.some((image) => image.status === 'approved');
}

function toPriceMode(price: CreateListingInput['price']) {
  return typeof price === 'number' ? null : price ?? null;
}

function toNumericPrice(price: CreateListingInput['price']) {
  return typeof price === 'number' ? price : null;
}

function toListingPrice(price: unknown, priceMode?: string | null) {
  if (priceMode === 'bid' || priceMode === 'negotiable') {
    return priceMode;
  }

  if (price && typeof price === 'object' && 'toNumber' in price) {
    return (price as { toNumber: () => number }).toNumber();
  }

  return typeof price === 'number' ? price : undefined;
}

function toNumber(value: unknown) {
  if (value && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber: () => number }).toNumber();
  }

  return typeof value === 'number' ? value : null;
}

function calculateCommissionAmount(productValue: number) {
  return Math.round(productValue * 0.01 * 100) / 100;
}

function safelyPublishRealtimeEvent(input: PublishRealtimeEventInput) {
  try {
    publishRealtimeEvent(input);
  } catch {
    // Realtime notifications must not break marketplace writes.
  }
}

function getListingRealtimeVisibility(
  sellerId: string,
  status: string,
): RealtimeEventVisibility {
  const isPublicListingState =
    status === 'published' ||
    status === 'paused' ||
    status === 'sold' ||
    status === 'deleted';

  return {
    includePublic: isPublicListingState,
    includeAdmins: true,
    userIds: [sellerId],
  };
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toPrismaJsonObject(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

function isPrismaKnownRequestError(error: unknown, code: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === code
  );
}

function isRetryablePrismaWriteConflict(error: unknown) {
  return (
    isPrismaKnownRequestError(error, 'P2002') ||
    isPrismaKnownRequestError(error, 'P2025') ||
    isPrismaKnownRequestError(error, 'P2034')
  );
}

function waitForSerializableRetry(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
}

function getActorId(actor: Actor) {
  return typeof actor === 'string' ? actor : actor.id;
}

function getPlaceholderEmail(userId: string) {
  return `${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}@smartstore.local`;
}

function getListingPagination(filters: MarketplaceListingFilters) {
  const pagination = normalizePagination(filters);

  return {
    limit: pagination.limit,
    page: pagination.page,
    skip: pagination.skip,
  };
}

function asCompliance(value: unknown): ComplianceDecision {
  if (value && typeof value === 'object' && 'decision' in value) {
    return value as ComplianceDecision;
  }

  return {
    decision: 'allow',
    reasons: [],
    jurisdiction: 'SA',
    shariaSensitive: false,
  };
}

function toListingRecord(listing: DatabaseListingRecord): memoryStore.ListingRecord {
  return {
    id: listing.id,
    sellerId: listing.sellerId,
    category: listing.category,
    title: listing.title ?? undefined,
    description: listing.description ?? undefined,
    price: toListingPrice(listing.price, listing.priceMode),
    city: listing.city ?? undefined,
    condition: listing.condition
      ? (listing.condition as ListingCondition)
      : undefined,
    images:
      listing.images?.map(
        (image) =>
          normalizeListingImageDeliveryUrls({
            id: image.id,
            listingId: image.listingId,
            originalUrl: image.originalUrl,
            displayUrl: image.displayUrl,
            thumbnailUrl: image.thumbnailUrl,
            isPrimary: image.isPrimary,
            qualityScore: image.qualityScore,
            status: image.status,
            enhancements: image.enhancements,
          }) as ListingImage,
      ) ?? [],
    attributes: asRecord(listing.attributes),
    status: listing.status as ListingStatus,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    views: listing.views,
    messageCount: listing.messageCount,
    favoriteCount: listing.favoriteCount,
    compliance: asCompliance(listing.compliance),
  };
}

async function ensureUser(user: AuthSessionUser) {
  return prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    update: {
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
  });
}

async function ensureActorUser(actor: Actor) {
  if (typeof actor !== 'string') {
    return ensureUser(actor);
  }

  return prisma.user.upsert({
    where: { id: actor },
    create: {
      id: actor,
      email: getPlaceholderEmail(actor),
    },
    update: {},
  });
}

async function getAdminAuditActorId(actor?: Actor) {
  if (!actor) {
    return null;
  }

  await ensureActorUser(actor);
  return getActorId(actor);
}

async function createAdminAuditLog(
  tx: Prisma.TransactionClient,
  input: {
    adminId: string | null;
    action: AdminAuditAction;
    targetType: string;
    targetId: string;
    metadata?: Record<string, unknown>;
  },
) {
  if (!input.adminId) {
    return;
  }

  await tx.adminAuditLog.create({
    data: {
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: toPrismaJsonObject(input.metadata ?? {}),
    },
  });
}

function toConversationRecord(
  conversation: DatabaseConversationRecord,
): Conversation & { listing: memoryStore.ListingRecord | null } {
  return {
    id: conversation.id,
    listingId: conversation.listingId,
    sellerId: conversation.sellerId,
    buyerId: conversation.buyerId,
    status: conversation.status as Conversation['status'],
    messages:
      conversation.messages?.map(
        (message) =>
          ({
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            body: message.body,
            status: message.status,
            type:
              message.type === 'contact_share'
                ? 'contact_share'
                : 'text',
            reasons: message.reasons,
            metadata: asRecord(message.metadata),
            createdAt: message.createdAt.toISOString(),
          }) as ConversationMessage,
      ) ?? [],
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    listing: conversation.listing ? toListingRecord(conversation.listing) : null,
  };
}

function toFavoriteRecord(
  favorite: DatabaseFavoriteRecord,
): FavoriteRecord & { listing: memoryStore.ListingRecord | null } {
  return {
    id: favorite.id,
    listingId: favorite.listingId,
    userId: favorite.userId,
    createdAt: favorite.createdAt.toISOString(),
    listing: favorite.listing ? toListingRecord(favorite.listing) : null,
  };
}

function toReportRecord(
  report: DatabaseReportRecord,
): ReportRecord & { listing: memoryStore.ListingRecord | null } {
  return {
    id: report.id,
    listingId: report.listingId,
    reporterId: report.reporterId,
    reason: report.reason,
    details: report.details ?? undefined,
    status: report.status as ReportRecord['status'],
    createdAt: report.createdAt.toISOString(),
    listing: report.listing ? toListingRecord(report.listing) : null,
  };
}

function toCommissionRecord(
  commission: DatabaseCommissionRecord,
): CommissionRecord & { listing: memoryStore.ListingRecord | null } {
  return {
    id: commission.id,
    listingId: commission.listingId,
    sellerId: commission.sellerId,
    productValue: toNumber(commission.productValue),
    commissionRatePercent: 1,
    commissionAmount: toNumber(commission.commissionAmount),
    status: commission.status as CommissionStatus,
    source: 'site_sale',
    paidAt: commission.paidAt?.toISOString(),
    createdAt: commission.createdAt.toISOString(),
    updatedAt: commission.updatedAt.toISOString(),
    listing: commission.listing ? toListingRecord(commission.listing) : null,
  };
}

export async function listMarketplaceListings(
  filters: MarketplaceListingFilters = {},
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listMarketplaceListings(filters);
  }

  const parsedQuery = parseMarketplaceSearchQuery(filters.query);
  const pagination = getListingPagination(filters);
  const searchConditions: Prisma.ListingWhereInput[] = [];
  const category = filters.category ?? parsedQuery.category;
  const city = filters.city ?? parsedQuery.city;
  const minPrice = filters.minPrice ?? parsedQuery.minPrice;
  const maxPrice = filters.maxPrice ?? parsedQuery.maxPrice;
  const yearMin = filters.yearMin ?? parsedQuery.yearMin;
  const yearMax = filters.yearMax ?? parsedQuery.yearMax;
  const termGroups =
    filters.termGroups ??
    (filters.terms?.length ? filters.terms : parsedQuery.terms).map(
      getMarketplaceSearchTermVariants,
    );

  if (category) {
    searchConditions.push({ category });
  }

  if (city) {
    const cityVariants = getMarketplaceCitySearchVariants(city);

    searchConditions.push({
      OR: cityVariants.map((cityVariant) => ({
        city: { contains: cityVariant, mode: 'insensitive' },
      })),
    });
  }

  if (filters.condition) {
    searchConditions.push({ condition: filters.condition });
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    searchConditions.push({
      price: {
        ...(minPrice !== undefined
          ? { gte: minPrice }
          : {}),
        ...(maxPrice !== undefined
          ? { lte: maxPrice }
          : {}),
      },
    });
  }

  if (yearMin !== undefined || yearMax !== undefined) {
    const currentYear = new Date().getFullYear() + 1;
    const lowerYear = yearMin ?? 1900;
    const upperYear = yearMax ?? currentYear;
    const years = Array.from(
      { length: Math.max(0, upperYear - lowerYear + 1) },
      (_, index) => String(lowerYear + index),
    ).slice(0, 80);

    if (years.length) {
      searchConditions.push({
        OR: years.flatMap((year) => [
          { title: { contains: year, mode: 'insensitive' } },
          { description: { contains: year, mode: 'insensitive' } },
          { searchText: { contains: year, mode: 'insensitive' } },
        ]),
      });
    }
  }

  for (const termGroup of termGroups) {
    searchConditions.push({
      OR: termGroup.flatMap((term) => [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
        { category: { contains: term, mode: 'insensitive' } },
        { searchText: { contains: term, mode: 'insensitive' } },
      ]),
    });
  }

  for (const excludedTerm of filters.excludedTerms ?? []) {
    searchConditions.push({
      NOT: {
        searchText: {
          contains: normalizeMarketplaceSearchText(excludedTerm),
          mode: 'insensitive',
        },
      },
    });
  }

  const listings = await prisma.listing.findMany({
    where: {
      status: 'published',
      ...(searchConditions.length ? { AND: searchConditions } : {}),
    },
    include: {
      images: {
        where: { status: 'approved' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: pagination.skip,
    take: pagination.limit,
  });

  return listings.map(toListingRecord);
}

export async function getListing(listingId: string) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.getListing(listingId);
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  return listing ? toListingRecord(listing) : null;
}

export async function listSellerListings(sellerId: string) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listSellerListings(sellerId);
  }

  const listings = await prisma.listing.findMany({
    where: {
      sellerId,
      status: { not: 'deleted' },
    },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return listings.map(toListingRecord);
}

export async function listSellerListingsPage(
  sellerId: string,
  filters: PaginationInput = {},
) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 24,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    return toPaginatedResponse(
      memoryStore
        .listSellerListings(sellerId)
        .slice(pagination.skip, pagination.skip + pagination.take),
      pagination,
    );
  }

  const listings = await prisma.listing.findMany({
    where: {
      sellerId,
      status: { not: 'deleted' },
    },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return toPaginatedResponse(listings.map(toListingRecord), pagination);
}

async function deleteListingObjectsBestEffort(listing: memoryStore.ListingRecord) {
  await Promise.all(
    listing.images.map(async (image) => {
      try {
        await deleteListingObject({ imageId: image.id });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.warn(`[listing_draft_storage_delete] failure=${errorName}`);
      }
    }),
  );
}

function publishDeletedListingEvents(listing: memoryStore.ListingRecord) {
  safelyPublishRealtimeEvent({
    type: 'ad_status_changed',
    payload: {
      listingId: listing.id,
      sellerId: listing.sellerId,
      previousStatus: 'draft',
      status: listing.status,
    },
    visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
  });

  safelyPublishRealtimeEvent({
    type: 'ad_deleted',
    payload: {
      listingId: listing.id,
      sellerId: listing.sellerId,
    },
    visibility: {
      includePublic: true,
      includeAdmins: true,
      userIds: [listing.sellerId],
    },
  });
}

export async function resetIncompleteSellerDrafts(sellerId: string) {
  if (!shouldUseDatabaseStore()) {
    const deletedDrafts = memoryStore.resetIncompleteSellerDrafts(sellerId);

    for (const listing of deletedDrafts) {
      publishDeletedListingEvents(listing);
    }

    return deletedDrafts.length;
  }

  const deletedDrafts = await prisma.$transaction(async (tx) => {
    const drafts = await tx.listing.findMany({
      where: {
        sellerId,
        status: 'draft',
        title: null,
        description: null,
        city: null,
        images: {
          none: {},
        },
      },
      include: {
        images: true,
      },
    });

    if (!drafts.length) {
      return [];
    }

    const updatedDrafts: DatabaseListingRecord[] = [];

    for (const draft of drafts) {
      const updatedDraft = await tx.listing.update({
        where: { id: draft.id },
        data: { status: 'deleted' },
        include: { images: true },
      });

      updatedDrafts.push(updatedDraft);
    }

    return updatedDrafts;
  });

  const mappedDrafts = deletedDrafts.map(toListingRecord);

  await Promise.all(mappedDrafts.map(deleteListingObjectsBestEffort));

  for (const listing of mappedDrafts) {
    publishDeletedListingEvents(listing);
  }

  return mappedDrafts.length;
}

export async function createListingDraft(
  user: AuthSessionUser,
  input: CreateListingInput,
) {
  if (!shouldUseDatabaseStore()) {
    const listing = memoryStore.createListingDraft({
      sellerId: user.id,
      ...input,
    });

    safelyPublishRealtimeEvent({
      type: 'ad_created',
      payload: {
        listingId: listing.id,
        sellerId: listing.sellerId,
        status: listing.status,
      },
      visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
    });

    return listing;
  }

  await ensureUser(user);

  const compliance = evaluateSaudiMarketplaceCompliance(toSearchText(input));
  let listing: DatabaseListingRecord | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      listing = await prisma.$transaction(
        async (tx) => {
          const sellerListingCount = await tx.listing.count({
            where: {
              sellerId: user.id,
              status: { not: 'deleted' },
            },
          });

          if (hasReachedSellerListingLimit(sellerListingCount)) {
            throw new ListingLimitReachedError();
          }

          return tx.listing.create({
            data: {
              sellerId: user.id,
              category: input.category,
              title: input.title,
              description: input.description,
              price: toNumericPrice(input.price),
              priceMode: toPriceMode(input.price),
              city: input.city,
              condition: input.condition,
              attributes: toPrismaJsonObject(input.attributes ?? {}),
              searchText: toNormalizedListingSearchText(input),
              compliance: toPrismaJsonObject(
                compliance as unknown as Record<string, unknown>,
              ),
              status: chooseInitialStatus(compliance),
            },
            include: { images: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      if (!isPrismaKnownRequestError(error, 'P2034') || attempt === 2) {
        throw error;
      }

      await waitForSerializableRetry(attempt);
    }
  }

  if (!listing) {
    throw new Error('Listing draft transaction did not return a listing.');
  }

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'ad_created',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      status: mappedListing.status,
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  return mappedListing;
}

export async function updateListingForSeller(
  listingId: string,
  sellerId: string,
  updates: Partial<CreateListingInput>,
) {
  if (!shouldUseDatabaseStore()) {
    const listing = memoryStore.updateListingForSeller(
      listingId,
      sellerId,
      updates,
    );

    if (listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          status: listing.status,
          reason: 'content',
        },
        visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
      });
    }

    return listing;
  }

  const existing = await getListing(listingId);

  if (!existing || existing.sellerId !== sellerId) {
    return null;
  }

  const nextInput: CreateListingInput = {
    category: updates.category ?? existing.category,
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    price: updates.price ?? existing.price,
    city: updates.city ?? existing.city,
    condition: updates.condition ?? existing.condition,
    attributes: {
      ...existing.attributes,
      ...(updates.attributes ?? {}),
    },
  };
  const compliance = evaluateSaudiMarketplaceCompliance(toSearchText(nextInput));
  const listing = await prisma.listing.update({
    where: { id: listingId },
    data: {
      category: updates.category,
      title: updates.title,
      description: updates.description,
      price:
        'price' in updates ? toNumericPrice(updates.price) : undefined,
      priceMode: 'price' in updates ? toPriceMode(updates.price) : undefined,
      city: updates.city,
      condition: updates.condition,
      attributes: toPrismaJsonObject(nextInput.attributes ?? {}),
      searchText: toNormalizedListingSearchText(nextInput),
      compliance: toPrismaJsonObject(
        compliance as unknown as Record<string, unknown>,
      ),
      status:
        compliance.decision === 'block'
          ? 'rejected'
          : compliance.decision === 'needs_review'
            ? 'pending'
            : undefined,
    },
    include: { images: true },
  });

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      status: mappedListing.status,
      reason: 'content',
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  return mappedListing;
}

export async function setListingStatusForSeller(
  listingId: string,
  sellerId: string,
  status: Extract<ListingStatus, 'published' | 'paused' | 'sold' | 'deleted'>,
) {
  if (!shouldUseDatabaseStore()) {
    const existingListing = memoryStore.getListing(listingId);
    const listing = memoryStore.setListingStatusForSeller(
      listingId,
      sellerId,
      status,
    );

    if (listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_status_changed',
        payload: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          previousStatus: existingListing?.status ?? listing.status,
          status: listing.status,
        },
        visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
      });

      if (listing.status === 'deleted') {
        safelyPublishRealtimeEvent({
          type: 'ad_deleted',
          payload: {
            listingId: listing.id,
            sellerId: listing.sellerId,
          },
          visibility: {
            includePublic: true,
            includeAdmins: true,
            userIds: [listing.sellerId],
          },
        });
      }
    }

    return listing;
  }

  const existing = await getListing(listingId);

  if (!existing || existing.sellerId !== sellerId) {
    return null;
  }

  const nextStatus =
    status === 'published' && existing.compliance.decision !== 'allow'
      ? existing.compliance.decision === 'block'
        ? 'rejected'
        : 'pending'
      : status === 'published' && !hasApprovedImage(existing)
        ? 'pending'
      : status;
  const listing = await prisma.$transaction(async (tx) => {
    const updatedListing = await tx.listing.update({
      where: { id: listingId },
      data: { status: nextStatus },
      include: { images: true },
    });

    if (updatedListing.status !== 'sold') {
      return updatedListing;
    }

    const productValue =
      updatedListing.price &&
      typeof updatedListing.price === 'object' &&
      'toNumber' in updatedListing.price
        ? updatedListing.price.toNumber()
        : null;

    await tx.commission.upsert({
      where: { listingId },
      create: {
        listingId,
        sellerId,
        productValue,
        commissionRatePercent: 1,
        commissionAmount:
          typeof productValue === 'number'
            ? Math.round(productValue * 0.01 * 100) / 100
            : null,
        status: typeof productValue === 'number' ? 'due' : 'pending_amount',
      },
      update: {},
    });

    return updatedListing;
  });

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'ad_status_changed',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      previousStatus: existing.status,
      status: mappedListing.status,
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  if (mappedListing.status === 'deleted') {
    safelyPublishRealtimeEvent({
      type: 'ad_deleted',
      payload: {
        listingId: mappedListing.id,
        sellerId: mappedListing.sellerId,
      },
      visibility: {
        includePublic: true,
        includeAdmins: true,
        userIds: [mappedListing.sellerId],
      },
    });
  }

  if (mappedListing.status === 'sold') {
    const commission = await prisma.commission.findUnique({
      where: { listingId: mappedListing.id },
      select: {
        id: true,
        status: true,
        sellerId: true,
      },
    });

    if (commission) {
      safelyPublishRealtimeEvent({
        type: 'commission_updated',
        payload: {
          commissionId: commission.id,
          listingId: mappedListing.id,
          sellerId: commission.sellerId,
          status: commission.status,
          reason: 'created',
        },
        visibility: {
          includeAdmins: true,
          userIds: [commission.sellerId],
        },
      });
    }
  }

  return mappedListing;
}

export async function addListingImageForSeller(
  listingId: string,
  sellerId: string,
  image: ListingImage,
) {
  if (!shouldUseDatabaseStore()) {
    const listing = memoryStore.addListingImageForSeller(
      listingId,
      sellerId,
      image,
    );

    if (listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          status: listing.status,
          reason: 'image_added',
        },
        visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
      });
    }

    return listing;
  }

  let listing: DatabaseListingRecord | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      listing = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.listing.findUnique({
            where: { id: listingId },
            include: { images: true },
          });

          if (!existing || existing.sellerId !== sellerId) {
            return null;
          }

          if (hasReachedListingImageLimit(existing.images)) {
            return existing;
          }

          const isFirstApprovedImage = !existing.images.some(
            (currentImage) => currentImage.status === 'approved',
          );

          await tx.listingImage.create({
            data: {
              id: image.id,
              listingId,
              originalUrl: image.originalUrl,
              displayUrl: image.displayUrl,
              thumbnailUrl: image.thumbnailUrl,
              isPrimary: image.isPrimary || isFirstApprovedImage,
              qualityScore: image.qualityScore,
              status: image.status,
              enhancements: image.enhancements,
            },
          });

          return tx.listing.findUnique({
            where: { id: listingId },
            include: {
              images: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      if (!isPrismaKnownRequestError(error, 'P2034') || attempt === 2) {
        throw error;
      }

      await waitForSerializableRetry(attempt);
    }
  }

  const mappedListing = listing ? toListingRecord(listing) : null;

  if (mappedListing) {
    safelyPublishRealtimeEvent({
      type: 'ad_updated',
      payload: {
        listingId: mappedListing.id,
        sellerId: mappedListing.sellerId,
        status: mappedListing.status,
        reason: 'image_added',
      },
      visibility: getListingRealtimeVisibility(
        mappedListing.sellerId,
        mappedListing.status,
      ),
    });
  }

  return mappedListing;
}

export async function deleteListingImageForSeller(
  listingId: string,
  sellerId: string,
  imageId: string,
) {
  if (!shouldUseDatabaseStore()) {
    const listing = memoryStore.deleteListingImageForSeller(
      listingId,
      sellerId,
      imageId,
    );

    if (listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          status: listing.status,
          reason: 'image_deleted',
        },
        visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
      });
    }

    return listing;
  }

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { images: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] } },
  });

  if (!existing || existing.sellerId !== sellerId) {
    return null;
  }

  const imageToDelete = existing.images.find((image) => image.id === imageId);

  if (!imageToDelete) {
    return null;
  }

  const listing = await prisma.$transaction(async (tx) => {
    await tx.listingImage.delete({
      where: { id: imageId },
    });

    if (imageToDelete.isPrimary) {
      const nextPrimaryImage = await tx.listingImage.findFirst({
        where: {
          listingId,
          status: 'approved',
        },
        orderBy: { createdAt: 'asc' },
      });

      if (nextPrimaryImage) {
        await tx.listingImage.update({
          where: { id: nextPrimaryImage.id },
          data: { isPrimary: true },
        });
      }
    }

    return tx.listing.update({
      where: { id: listingId },
      data: { updatedAt: new Date() },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: getMaxListingImagesPerListing(),
        },
      },
    });
  });

  try {
    await deleteListingObject({ imageId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[listing_image_storage_delete] failure=${errorName}`);
  }

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      status: mappedListing.status,
      reason: 'image_deleted',
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  return mappedListing;
}

export async function setPrimaryListingImageForSeller(
  listingId: string,
  sellerId: string,
  imageId: string,
) {
  if (!shouldUseDatabaseStore()) {
    const listing = memoryStore.setPrimaryListingImageForSeller(
      listingId,
      sellerId,
      imageId,
    );

    if (listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: listing.id,
          sellerId: listing.sellerId,
          status: listing.status,
          reason: 'primary_image',
        },
        visibility: getListingRealtimeVisibility(listing.sellerId, listing.status),
      });
    }

    return listing;
  }

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { images: true },
  });

  if (
    !existing ||
    existing.sellerId !== sellerId ||
    !existing.images.some((image) => image.id === imageId)
  ) {
    return null;
  }

  const listing = await prisma.$transaction(async (tx) => {
    await tx.listingImage.updateMany({
      where: { listingId },
      data: { isPrimary: false },
    });
    await tx.listingImage.update({
      where: { id: imageId },
      data: { isPrimary: true },
    });

    return tx.listing.update({
      where: { id: listingId },
      data: { updatedAt: new Date() },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: getMaxListingImagesPerListing(),
        },
      },
    });
  });

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      status: mappedListing.status,
      reason: 'primary_image',
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  return mappedListing;
}

export async function listUserConversations(userId: string) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listUserConversations(userId);
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return conversations.map(toConversationRecord);
}

export async function listUserConversationsPage(
  userId: string,
  filters: PaginationInput = {},
) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 20,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    return toPaginatedResponse(
      memoryStore
        .listUserConversations(userId)
        .slice(pagination.skip, pagination.skip + pagination.take),
      pagination,
    );
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      OR: [{ buyerId: userId }, { sellerId: userId }],
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 10 },
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 4,
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return toPaginatedResponse(conversations.map(toConversationRecord), pagination);
}

export async function getConversationForUser(
  conversationId: string,
  userId: string,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.getConversationForUser(conversationId, userId);
  }

  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      OR: [{ buyerId: userId }, { sellerId: userId }],
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  return conversation ? toConversationRecord(conversation) : null;
}

function getOtherConversationUserId(conversation: Conversation, userId: string) {
  if (conversation.buyerId === userId) {
    return conversation.sellerId;
  }

  if (conversation.sellerId === userId) {
    return conversation.buyerId;
  }

  return null;
}

export async function getConversationBlockStatus(
  conversationId: string,
  userId: string,
): Promise<ConversationBlockStatus | null> {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.getConversationBlockStatus(conversationId, userId);
  }

  const conversation = await getConversationForUser(conversationId, userId);

  if (!conversation) {
    return null;
  }

  const otherUserId = getOtherConversationUserId(conversation, userId);

  if (!otherUserId) {
    return null;
  }

  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userId, blockedId: otherUserId },
        { blockerId: otherUserId, blockedId: userId },
      ],
    },
  });

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

export async function createConversationForListing(
  listingId: string,
  buyer: Actor,
) {
  const buyerId = getActorId(buyer);

  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.createConversationForListing(listingId, buyerId);

    if (result.status === 'created' && result.conversation) {
      safelyPublishRealtimeEvent({
        type: 'conversation_updated',
        payload: {
          conversationId: result.conversation.id,
          listingId: result.conversation.listingId,
          sellerId: result.conversation.sellerId,
          buyerId: result.conversation.buyerId,
          status: result.conversation.status,
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.conversation.sellerId, result.conversation.buyerId],
        },
      });

      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: result.conversation.listingId,
          sellerId: result.conversation.sellerId,
          status: 'published',
          reason: 'message_count',
        },
        visibility: {
          includePublic: true,
          includeAdmins: true,
          userIds: [result.conversation.sellerId, result.conversation.buyerId],
        },
      });
    }

    return result;
  }

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

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

  await ensureActorUser(buyer);

  const existing = await prisma.conversation.findUnique({
    where: {
      listingId_sellerId_buyerId: {
        listingId,
        sellerId: listing.sellerId,
        buyerId,
      },
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  if (existing) {
    return {
      status: 'existing' as const,
      conversation: toConversationRecord(existing),
    };
  }

  let conversation: DatabaseConversationRecord;

  try {
    conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          listingId,
          sellerId: listing.sellerId,
          buyerId,
        },
        include: {
          messages: { orderBy: { createdAt: 'asc' } },
          listing: {
            include: {
              images: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      });

      await tx.listing.update({
        where: { id: listingId },
        data: { messageCount: { increment: 1 } },
      });

      return created;
    });
  } catch (error) {
    if (!isPrismaKnownRequestError(error, 'P2002')) {
      throw error;
    }

    const racedConversation = await prisma.conversation.findUnique({
      where: {
        listingId_sellerId_buyerId: {
          listingId,
          sellerId: listing.sellerId,
          buyerId,
        },
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        listing: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });

    if (!racedConversation) {
      throw error;
    }

    return {
      status: 'existing' as const,
      conversation: toConversationRecord(racedConversation),
    };
  }

  const mappedConversation = toConversationRecord(conversation);

  safelyPublishRealtimeEvent({
    type: 'conversation_updated',
    payload: {
      conversationId: mappedConversation.id,
      listingId: mappedConversation.listingId,
      sellerId: mappedConversation.sellerId,
      buyerId: mappedConversation.buyerId,
      status: mappedConversation.status,
    },
    visibility: {
      includeAdmins: true,
      userIds: [mappedConversation.sellerId, mappedConversation.buyerId],
    },
  });

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: mappedConversation.listingId,
      sellerId: mappedConversation.sellerId,
      status: mappedConversation.listing?.status ?? 'published',
      reason: 'message_count',
    },
    visibility: {
      includePublic: true,
      includeAdmins: true,
      userIds: [mappedConversation.sellerId, mappedConversation.buyerId],
    },
  });

  return {
    status: 'created' as const,
    conversation: mappedConversation,
  };
}

export async function reportConversationUser(
  conversationId: string,
  reporter: Actor,
  input: { reason: string; details?: string },
) {
  const reporterId = getActorId(reporter);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.reportConversationUser(conversationId, reporterId, input);
  }

  const conversation = await getConversationForUser(conversationId, reporterId);

  if (!conversation) {
    return {
      status: 'not_found' as const,
      report: null,
      conversation: null,
    };
    }

  const targetUserId = getOtherConversationUserId(conversation, reporterId);

  if (!targetUserId) {
    return {
      status: 'not_found' as const,
      report: null,
      conversation: null,
    };
  }

  const existingOpenReport = await prisma.userReport.findFirst({
    where: {
      reporterId,
      targetUserId,
      conversationId,
      status: 'open',
    },
  });

  if (existingOpenReport) {
    return {
      status: 'already_reported' as const,
      report: {
        id: existingOpenReport.id,
        reporterId: existingOpenReport.reporterId,
        targetUserId: existingOpenReport.targetUserId,
        conversationId: existingOpenReport.conversationId ?? undefined,
        reason: existingOpenReport.reason,
        details: existingOpenReport.details ?? undefined,
        status: existingOpenReport.status,
        createdAt: existingOpenReport.createdAt.toISOString(),
        updatedAt: existingOpenReport.updatedAt.toISOString(),
      },
      conversation,
    };
  }

  await ensureActorUser(reporter);

  const report = await prisma.userReport
    .create({
      data: {
        reporterId,
        targetUserId,
        conversationId,
        reason: input.reason,
        details: input.details,
        status: 'open',
      },
    })
    .catch(async (error) => {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }

      return prisma.userReport.findFirstOrThrow({
        where: {
          reporterId,
          targetUserId,
          conversationId,
          status: 'open',
        },
      });
    });

  safelyPublishRealtimeEvent({
    type: 'conversation_updated',
    payload: {
      conversationId: conversation.id,
      listingId: conversation.listingId,
      sellerId: conversation.sellerId,
      buyerId: conversation.buyerId,
      status: conversation.status,
    },
    visibility: {
      includeAdmins: true,
      userIds: [conversation.sellerId, conversation.buyerId],
    },
  });

  return {
    status: 'reported' as const,
    report: {
      id: report.id,
      reporterId: report.reporterId,
      targetUserId: report.targetUserId,
      conversationId: report.conversationId ?? undefined,
      reason: report.reason,
      details: report.details ?? undefined,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    },
    conversation,
  };
}

export async function blockConversationUser(
  conversationId: string,
  blocker: Actor,
  reason?: string,
) {
  const blockerId = getActorId(blocker);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.blockConversationUser(conversationId, blockerId, reason);
  }

  const conversation = await getConversationForUser(conversationId, blockerId);

  if (!conversation) {
    return {
      status: 'not_found' as const,
      block: null,
      conversation: null,
    };
  }

  const blockedId = getOtherConversationUserId(conversation, blockerId);

  if (!blockedId) {
    return {
      status: 'not_found' as const,
      block: null,
      conversation: null,
    };
  }

  await ensureActorUser(blocker);

  const block = await prisma.userBlock.upsert({
    where: {
      blockerId_blockedId: {
        blockerId,
        blockedId,
      },
    },
    create: {
      blockerId,
      blockedId,
      conversationId,
      reason,
    },
    update: {
      conversationId,
      reason,
    },
  });

  safelyPublishRealtimeEvent({
    type: 'conversation_updated',
    payload: {
      conversationId: conversation.id,
      listingId: conversation.listingId,
      sellerId: conversation.sellerId,
      buyerId: conversation.buyerId,
      status: conversation.status,
    },
    visibility: {
      includeAdmins: true,
      userIds: [conversation.sellerId, conversation.buyerId],
    },
  });

  return {
    status: 'blocked' as const,
    block: {
      id: block.id,
      blockerId: block.blockerId,
      blockedId: block.blockedId,
      conversationId: block.conversationId ?? undefined,
      reason: block.reason ?? undefined,
      createdAt: block.createdAt.toISOString(),
    },
    conversation,
  };
}

export async function addConversationMessage(
  conversationId: string,
  sender: Actor,
  body: string,
) {
  const senderId = getActorId(sender);

  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.addConversationMessage(
      conversationId,
      senderId,
      body,
    );

    if (result.conversation && result.message) {
      safelyPublishRealtimeEvent({
        type: 'message_created',
        payload: {
          conversationId: result.conversation.id,
          listingId: result.conversation.listingId,
          sellerId: result.conversation.sellerId,
          buyerId: result.conversation.buyerId,
          messageId: result.message.id,
          senderId: result.message.senderId,
          status: result.message.status,
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.conversation.sellerId, result.conversation.buyerId],
        },
      });

      safelyPublishRealtimeEvent({
        type: 'conversation_updated',
        payload: {
          conversationId: result.conversation.id,
          listingId: result.conversation.listingId,
          sellerId: result.conversation.sellerId,
          buyerId: result.conversation.buyerId,
          status: result.conversation.status,
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.conversation.sellerId, result.conversation.buyerId],
        },
      });
    }

    return result;
  }

  const conversation = await getConversationForUser(conversationId, senderId);

  if (!conversation) {
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

  const blockStatus = await getConversationBlockStatus(conversationId, senderId);

  if (blockStatus?.blocked) {
    return {
      status: 'conversation_blocked' as const,
      message: null,
      conversation,
      blockStatus,
    };
  }

  await ensureActorUser(sender);

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

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId,
      senderId,
      body: trimmedBody,
      status: 'sent',
      type: 'text',
      reasons: safety.reasons,
      metadata: toPrismaJsonObject({}),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  const updatedConversation = await getConversationForUser(
    conversationId,
    senderId,
  );
  const mappedMessage: ConversationMessage = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    status: message.status as ConversationMessage['status'],
    type: message.type === 'contact_share' ? 'contact_share' : 'text',
    reasons: message.reasons,
    metadata: asRecord(message.metadata),
    createdAt: message.createdAt.toISOString(),
  };

  if (updatedConversation) {
    safelyPublishRealtimeEvent({
      type: 'message_created',
      payload: {
        conversationId: updatedConversation.id,
        listingId: updatedConversation.listingId,
        sellerId: updatedConversation.sellerId,
        buyerId: updatedConversation.buyerId,
        messageId: mappedMessage.id,
        senderId: mappedMessage.senderId,
        status: mappedMessage.status,
      },
      visibility: {
        includeAdmins: true,
        userIds: [updatedConversation.sellerId, updatedConversation.buyerId],
      },
    });

    safelyPublishRealtimeEvent({
      type: 'conversation_updated',
      payload: {
        conversationId: updatedConversation.id,
        listingId: updatedConversation.listingId,
        sellerId: updatedConversation.sellerId,
        buyerId: updatedConversation.buyerId,
        status: updatedConversation.status,
      },
      visibility: {
        includeAdmins: true,
        userIds: [updatedConversation.sellerId, updatedConversation.buyerId],
      },
    });
  }

  return {
    status: 'sent' as const,
    message: mappedMessage,
    conversation: updatedConversation,
  };
}

export async function shareSellerContact(conversationId: string, seller: Actor) {
  const sellerId = getActorId(seller);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.shareSellerContact(
      conversationId,
      sellerId,
      typeof seller === 'string' ? null : seller.phoneNumber,
    );
  }

  const conversation = await getConversationForUser(conversationId, sellerId);

  if (!conversation) {
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

  const blockStatus = await getConversationBlockStatus(conversationId, sellerId);

  if (blockStatus?.blocked) {
    return {
      status: 'conversation_blocked' as const,
      message: null,
      conversation,
      blockStatus,
    };
  }

  const sellerProfile = await prisma.user.findUnique({
    where: { id: sellerId },
    select: { phoneNumber: true },
  });
  const phoneNumber = sellerProfile?.phoneNumber;

  if (!phoneNumber) {
    return {
      status: 'missing_phone' as const,
      message: null,
      conversation,
    };
  }

  const message = await prisma.conversationMessage.create({
    data: {
      conversationId,
      senderId: sellerId,
      body: 'official_contact_share',
      status: 'sent',
      type: 'contact_share',
      reasons: ['official_contact_share'],
      metadata: toPrismaJsonObject({ phoneNumber }),
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  const updatedConversation = await getConversationForUser(
    conversationId,
    sellerId,
  );
  const mappedMessage: ConversationMessage = {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    body: message.body,
    status: 'sent',
    type: 'contact_share',
    reasons: message.reasons,
    metadata: asRecord(message.metadata),
    createdAt: message.createdAt.toISOString(),
  };

  if (updatedConversation) {
    safelyPublishRealtimeEvent({
      type: 'message_created',
      payload: {
        conversationId: updatedConversation.id,
        listingId: updatedConversation.listingId,
        sellerId: updatedConversation.sellerId,
        buyerId: updatedConversation.buyerId,
        messageId: mappedMessage.id,
        senderId: mappedMessage.senderId,
        status: mappedMessage.status,
      },
      visibility: {
        includeAdmins: true,
        userIds: [updatedConversation.sellerId, updatedConversation.buyerId],
      },
    });

    safelyPublishRealtimeEvent({
      type: 'conversation_updated',
      payload: {
        conversationId: updatedConversation.id,
        listingId: updatedConversation.listingId,
        sellerId: updatedConversation.sellerId,
        buyerId: updatedConversation.buyerId,
        status: updatedConversation.status,
      },
      visibility: {
        includeAdmins: true,
        userIds: [updatedConversation.sellerId, updatedConversation.buyerId],
      },
    });
  }

  return {
    status: 'shared' as const,
    message: mappedMessage,
    conversation: updatedConversation,
  };
}

export async function listUserFavorites(userId: string) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listUserFavorites(userId);
  }

  const favorites = await prisma.favorite.findMany({
    where: { userId },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return favorites.map(toFavoriteRecord);
}

export async function listUserFavoritesPage(
  userId: string,
  filters: PaginationInput = {},
) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 24,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    return toPaginatedResponse(
      memoryStore
        .listUserFavorites(userId)
        .slice(pagination.skip, pagination.skip + pagination.take),
      pagination,
    );
  }

  const favorites = await prisma.favorite.findMany({
    where: { userId },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 4,
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return toPaginatedResponse(favorites.map(toFavoriteRecord), pagination);
}

export async function getListingFavoriteState(listingId: string, actor: Actor) {
  const userId = getActorId(actor);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.getListingFavoriteState(listingId, userId);
  }

  const listing = await getListing(listingId);

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

  const favorite = await prisma.favorite.findUnique({
    where: {
      listingId_userId: {
        listingId,
        userId,
      },
    },
    select: { id: true },
  });

  return {
    status: 'ok' as const,
    isFavorite: Boolean(favorite),
    canFavorite: true,
    listing,
  };
}

export async function toggleFavoriteListing(listingId: string, actor: Actor) {
  const userId = getActorId(actor);

  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.toggleFavoriteListing(listingId, userId);

    if (result.listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: result.listing.id,
          sellerId: result.listing.sellerId,
          status: result.listing.status,
          reason: 'favorite_count',
        },
        visibility: {
          includePublic: true,
          includeAdmins: true,
          userIds: [userId, result.listing.sellerId],
        },
      });
    }

    return result;
  }

  const listing = await getListing(listingId);

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

  await ensureActorUser(actor);

  let result:
    | {
        status: 'saved';
        favorite: FavoriteRecord;
        listing: memoryStore.ListingRecord;
      }
    | {
        status: 'removed';
        favorite: null;
        listing: memoryStore.ListingRecord;
      }
    | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await prisma.$transaction(
        async (tx) => {
          const existingFavorite = await tx.favorite.findUnique({
            where: {
              listingId_userId: {
                listingId,
                userId,
              },
            },
          });
          let favorite: FavoriteRecord | null = null;
          let status: 'saved' | 'removed';

          if (existingFavorite) {
            await tx.favorite.delete({
              where: {
                listingId_userId: {
                  listingId,
                  userId,
                },
              },
            });
            status = 'removed';
          } else {
            const createdFavorite = await tx.favorite.create({
              data: {
                listingId,
                userId,
              },
            });
            favorite = {
              id: createdFavorite.id,
              listingId: createdFavorite.listingId,
              userId: createdFavorite.userId,
              createdAt: createdFavorite.createdAt.toISOString(),
            };
            status = 'saved';
          }

          const favoriteCount = await tx.favorite.count({
            where: { listingId },
          });
          const updatedListing = await tx.listing.update({
            where: { id: listingId },
            data: { favoriteCount },
            include: {
              images: {
                orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              },
            },
          });

          return {
            status,
            favorite,
            listing: toListingRecord(updatedListing),
          } as
            | {
                status: 'saved';
                favorite: FavoriteRecord;
                listing: memoryStore.ListingRecord;
              }
            | {
                status: 'removed';
                favorite: null;
                listing: memoryStore.ListingRecord;
              };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (error) {
      if (!isRetryablePrismaWriteConflict(error) || attempt === 2) {
        throw error;
      }

      await waitForSerializableRetry(attempt);
    }
  }

  if (!result) {
    throw new Error('Favorite toggle transaction did not return a result.');
  }

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: result.listing.id,
      sellerId: result.listing.sellerId,
      status: result.listing.status,
      reason: 'favorite_count',
    },
    visibility: {
      includePublic: true,
      includeAdmins: true,
      userIds: [userId, result.listing.sellerId],
    },
  });

  return result;
}

export async function reportListing(
  listingId: string,
  actor: Actor,
  reason: string,
  details?: string,
) {
  const reporterId = getActorId(actor);

  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.reportListing(listingId, reporterId, reason, details);

    if (result.listing) {
      safelyPublishRealtimeEvent({
        type: 'ad_updated',
        payload: {
          listingId: result.listing.id,
          sellerId: result.listing.sellerId,
          status: result.listing.status,
          reason: 'report',
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.listing.sellerId],
        },
      });
    }

    return result;
  }

  const listing = await getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return {
      status: 'not_found' as const,
      report: null,
      listing: null,
    };
  }

  await ensureActorUser(actor);

  const report = await prisma.report.create({
    data: {
      listingId,
      reporterId,
      reason,
      details,
    },
  });

  safelyPublishRealtimeEvent({
    type: 'ad_updated',
    payload: {
      listingId: listing.id,
      sellerId: listing.sellerId,
      status: listing.status,
      reason: 'report',
    },
    visibility: {
      includeAdmins: true,
      userIds: [listing.sellerId],
    },
  });

  safelyPublishRealtimeEvent({
    type: 'moderation_updated',
    payload: {
      entity: 'report',
      entityId: report.id,
      status: report.status,
    },
    visibility: {
      includeAdmins: true,
    },
  });

  return {
    status: 'reported' as const,
    report: {
      id: report.id,
      listingId: report.listingId,
      reporterId: report.reporterId,
      reason: report.reason,
      details: report.details ?? undefined,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    } satisfies ReportRecord,
    listing,
  };
}

export async function listModerationQueue() {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listModerationQueue();
  }

  const [listings, reports] = await Promise.all([
    prisma.listing.findMany({
      where: { status: { in: ['pending', 'rejected'] } },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.report.findMany({
      include: {
        listing: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return {
    listings: listings.map(toListingRecord),
    reports: reports.map(toReportRecord),
  };
}

export async function listModerationQueuePage(filters: PaginationInput = {}) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 20,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    const queue = memoryStore.listModerationQueue();

    return {
      listings: toPaginatedResponse(
        queue.listings.slice(pagination.skip, pagination.skip + pagination.take),
        pagination,
      ).items,
      reports: toPaginatedResponse(
        queue.reports.slice(pagination.skip, pagination.skip + pagination.take),
        pagination,
      ).items,
      userReports: toPaginatedResponse(
        queue.userReports.slice(pagination.skip, pagination.skip + pagination.take),
        pagination,
      ).items,
      pagination: {
        listings: toPaginatedResponse(
          queue.listings.slice(
            pagination.skip,
            pagination.skip + pagination.take,
          ),
          pagination,
        ).pagination,
        reports: toPaginatedResponse(
          queue.reports.slice(pagination.skip, pagination.skip + pagination.take),
          pagination,
        ).pagination,
        userReports: toPaginatedResponse(
          queue.userReports.slice(
            pagination.skip,
            pagination.skip + pagination.take,
          ),
          pagination,
        ).pagination,
      },
    };
  }

  const [listings, reports, userReports] = await Promise.all([
    prisma.listing.findMany({
      where: { status: { in: ['pending', 'rejected'] } },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          take: 4,
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.report.findMany({
      include: {
        listing: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
              take: 4,
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.userReport.findMany({
      include: {
        reporter: { select: { id: true, email: true, name: true } },
        targetUser: { select: { id: true, email: true, name: true } },
        conversation: {
          include: {
            listing: { select: { id: true, title: true } },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: { id: true, senderId: true, body: true, status: true, createdAt: true },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: pagination.skip,
      take: pagination.take,
    }),
  ]);
  const listingPage = toPaginatedResponse(listings.map(toListingRecord), pagination);
  const reportPage = toPaginatedResponse(reports.map(toReportRecord), pagination);
  const mappedUserReports = userReports.map((report) => ({
    id: report.id,
      reporterId: report.reporterId,
      targetUserId: report.targetUserId,
      conversationId: report.conversationId ?? undefined,
      reason: report.reason,
      details: report.details ?? undefined,
      status: report.status as UserReportStatus,
      resolution: (report.resolution ?? undefined) as
        | UserReportResolution
        | undefined,
      resolvedBy: report.resolvedBy ?? undefined,
      resolvedAt: report.resolvedAt?.toISOString(),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
      reporter: report.reporter,
      targetUser: report.targetUser,
      conversation: report.conversation
        ? {
            id: report.conversation.id,
            status: report.conversation.status,
            listing: report.conversation.listing,
            messages: [...report.conversation.messages].reverse().map((message) => ({
              ...message,
              createdAt: message.createdAt.toISOString(),
            })),
          }
        : null,
    }));
  const userReportPage = toPaginatedResponse(mappedUserReports, pagination);

  return {
    listings: listingPage.items,
    reports: reportPage.items,
    userReports: userReportPage.items,
    pagination: {
      listings: listingPage.pagination,
      reports: reportPage.pagination,
      userReports: userReportPage.pagination,
    },
  };
}

export async function setUserReportModerationStatus(
  reportId: string,
  resolution: UserReportResolution,
  admin?: Actor,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.setUserReportModerationStatus(
      reportId,
      resolution,
      admin ? getActorId(admin) : undefined,
    );
  }

  const status: UserReportStatus =
    resolution === 'review'
      ? 'open'
      : resolution === 'dismiss'
        ? 'dismissed'
        : 'reviewed';
  const shouldCloseConversation =
    resolution === 'close_conversation' || resolution === 'restrict';
  const auditAction: AdminAuditAction =
    resolution === 'review'
      ? 'review_report'
      : resolution === 'dismiss'
        ? 'dismiss_report'
        : resolution === 'warn'
          ? 'warn_user'
          : 'restrict_conversation';

  const adminId = await getAdminAuditActorId(admin);
  const report = await prisma.$transaction(async (tx) => {
    const existing = await tx.userReport.findUnique({ where: { id: reportId } });
    if (!existing) return null;
    if (existing.status !== 'open') return 'already_resolved' as const;

    const claimed = await tx.userReport.updateMany({
      where: { id: reportId, status: 'open' },
      data: {
        status,
        resolution,
        resolvedBy: adminId ?? undefined,
        resolvedAt: resolution === 'review' ? null : new Date(),
      },
    });
    if (claimed.count === 0) return 'already_resolved' as const;

    if (shouldCloseConversation && existing.conversationId) {
      await tx.conversation.update({
        where: { id: existing.conversationId },
        data: { status: 'closed' },
      });
      await tx.userBlock.upsert({
        where: {
          blockerId_blockedId: {
            blockerId: existing.reporterId,
            blockedId: existing.targetUserId,
          },
        },
        create: {
          blockerId: existing.reporterId,
          blockedId: existing.targetUserId,
          conversationId: existing.conversationId,
          reason: 'admin_moderation',
        },
        update: {
          conversationId: existing.conversationId,
          reason: 'admin_moderation',
        },
      });
    }

    await createAdminAuditLog(tx, {
      adminId,
      action: auditAction,
      targetType: 'user_report',
      targetId: reportId,
      metadata: { resolution, conversationId: existing.conversationId },
    });
    return tx.userReport.findUniqueOrThrow({ where: { id: reportId } });
  });

  if (!report) return { status: 'not_found' as const, report: null };
  if (report === 'already_resolved') {
    return { status: 'already_resolved' as const, report: null };
  }
  safelyPublishRealtimeEvent({
    type: 'moderation_updated',
    payload: { entity: 'report', entityId: report.id, status: report.status },
    visibility: { includeAdmins: true },
  });
  return {
    status: report.status,
    report: {
      id: report.id,
      reporterId: report.reporterId,
      targetUserId: report.targetUserId,
      conversationId: report.conversationId ?? undefined,
      reason: report.reason,
      details: report.details ?? undefined,
      status: report.status as UserReportStatus,
      resolution: (report.resolution ?? undefined) as
        | UserReportResolution
        | undefined,
      resolvedBy: report.resolvedBy ?? undefined,
      resolvedAt: report.resolvedAt?.toISOString(),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    },
  };
}

export async function setListingModerationStatus(
  listingId: string,
  status: Extract<ListingStatus, 'published' | 'rejected' | 'deleted'>,
  admin?: Actor,
) {
  if (!shouldUseDatabaseStore()) {
    const existingListing = memoryStore.getListing(listingId);
    const result = memoryStore.setListingModerationStatus(listingId, status);

    if (result.listing) {
      safelyPublishRealtimeEvent({
        type: 'moderation_updated',
        payload: {
          entity: 'listing',
          entityId: result.listing.id,
          status: result.listing.status,
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.listing.sellerId],
        },
      });

      safelyPublishRealtimeEvent({
        type: 'ad_status_changed',
        payload: {
          listingId: result.listing.id,
          sellerId: result.listing.sellerId,
          previousStatus: existingListing?.status ?? result.listing.status,
          status: result.listing.status,
        },
        visibility: getListingRealtimeVisibility(
          result.listing.sellerId,
          result.listing.status,
        ),
      });

      if (result.listing.status === 'deleted') {
        safelyPublishRealtimeEvent({
          type: 'ad_deleted',
          payload: {
            listingId: result.listing.id,
            sellerId: result.listing.sellerId,
          },
          visibility: {
            includePublic: true,
            includeAdmins: true,
            userIds: [result.listing.sellerId],
          },
        });
      }
    }

    return result;
  }

  const existing = await getListing(listingId);

  if (!existing) {
    return {
      status: 'not_found' as const,
      listing: null,
    };
  }

  if (status === 'published' && existing.compliance.decision === 'block') {
    return {
      status: 'blocked_by_policy' as const,
      listing: existing,
    };
  }

  const adminId = await getAdminAuditActorId(admin);
  const action: AdminAuditAction =
    status === 'published'
      ? 'approve_listing'
      : status === 'deleted'
        ? 'delete_listing'
        : 'reject_listing';
  const listing = await prisma.$transaction(async (tx) => {
    const updatedListing = await tx.listing.update({
      where: { id: listingId },
      data: { status },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    await createAdminAuditLog(tx, {
      adminId,
      action,
      targetType: 'listing',
      targetId: listingId,
      metadata: {
        previousStatus: existing.status,
        nextStatus: status,
      },
    });

    return updatedListing;
  });

  const mappedListing = toListingRecord(listing);

  safelyPublishRealtimeEvent({
    type: 'moderation_updated',
    payload: {
      entity: 'listing',
      entityId: mappedListing.id,
      status: mappedListing.status,
    },
    visibility: {
      includeAdmins: true,
      userIds: [mappedListing.sellerId],
    },
  });

  safelyPublishRealtimeEvent({
    type: 'ad_status_changed',
    payload: {
      listingId: mappedListing.id,
      sellerId: mappedListing.sellerId,
      previousStatus: existing.status,
      status: mappedListing.status,
    },
    visibility: getListingRealtimeVisibility(
      mappedListing.sellerId,
      mappedListing.status,
    ),
  });

  if (mappedListing.status === 'deleted') {
    safelyPublishRealtimeEvent({
      type: 'ad_deleted',
      payload: {
        listingId: mappedListing.id,
        sellerId: mappedListing.sellerId,
      },
      visibility: {
        includePublic: true,
        includeAdmins: true,
        userIds: [mappedListing.sellerId],
      },
    });
  }

  return {
    status: mappedListing.status,
    listing: mappedListing,
  };
}

export async function setReportModerationStatus(
  reportId: string,
  status: Extract<ReportRecord['status'], 'reviewed' | 'dismissed'>,
  admin?: Actor,
) {
  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.setReportModerationStatus(reportId, status);

    if (result.report) {
      safelyPublishRealtimeEvent({
        type: 'moderation_updated',
        payload: {
          entity: 'report',
          entityId: result.report.id,
          status: result.report.status,
        },
        visibility: {
          includeAdmins: true,
        },
      });
    }

    return result;
  }

  const adminId = await getAdminAuditActorId(admin);
  const report = await prisma.$transaction(async (tx) => {
    const updatedReport = await tx.report.update({
      where: { id: reportId },
      data: { status },
      include: {
        listing: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });

    await createAdminAuditLog(tx, {
      adminId,
      action: status === 'reviewed' ? 'review_report' : 'dismiss_report',
      targetType: 'report',
      targetId: reportId,
      metadata: { nextStatus: status },
    });

    return updatedReport;
  }).catch(() => null);

  if (!report) {
    return {
      status: 'not_found' as const,
      report: null,
    };
  }

  const mappedReport = toReportRecord(report);

  safelyPublishRealtimeEvent({
    type: 'moderation_updated',
    payload: {
      entity: 'report',
      entityId: mappedReport.id,
      status: mappedReport.status,
    },
    visibility: {
      includeAdmins: true,
    },
  });

  return {
    status: mappedReport.status,
    report: mappedReport,
  };
}

export async function listSellerCommissions(sellerId: string) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listSellerCommissions(sellerId);
  }

  const commissions = await prisma.commission.findMany({
    where: { sellerId },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return commissions.map(toCommissionRecord);
}

export async function listSellerCommissionsPage(
  sellerId: string,
  filters: PaginationInput = {},
) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 20,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    return toPaginatedResponse(
      memoryStore
        .listSellerCommissions(sellerId)
        .slice(pagination.skip, pagination.skip + pagination.take),
      pagination,
    );
  }

  const commissions = await prisma.commission.findMany({
    where: { sellerId },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 4,
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return toPaginatedResponse(commissions.map(toCommissionRecord), pagination);
}

export async function listAdminCommissions() {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.listAdminCommissions();
  }

  const commissions = await prisma.commission.findMany({
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return commissions.map(toCommissionRecord);
}

export async function listAdminCommissionsPage(filters: PaginationInput = {}) {
  const pagination = normalizePagination(filters, {
    defaultLimit: 20,
    maxLimit: 48,
  });

  if (!shouldUseDatabaseStore()) {
    return toPaginatedResponse(
      memoryStore
        .listAdminCommissions()
        .slice(pagination.skip, pagination.skip + pagination.take),
      pagination,
    );
  }

  const commissions = await prisma.commission.findMany({
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            take: 4,
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    skip: pagination.skip,
    take: pagination.take,
  });

  return toPaginatedResponse(commissions.map(toCommissionRecord), pagination);
}

export async function updateCommissionSaleAmountForSeller(
  commissionId: string,
  sellerId: string,
  productValue: number,
) {
  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.updateCommissionSaleAmountForSeller(
      commissionId,
      sellerId,
      productValue,
    );

    if (result.commission && result.status === 'updated') {
      safelyPublishRealtimeEvent({
        type: 'commission_updated',
        payload: {
          commissionId: result.commission.id,
          listingId: result.commission.listingId,
          sellerId: result.commission.sellerId,
          status: result.commission.status,
          reason: 'sale_amount_updated',
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.commission.sellerId],
        },
      });
    }

    return result;
  }

  const commission = await prisma.commission.findFirst({
    where: { id: commissionId, sellerId },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  if (!commission) {
    return {
      status: 'not_found' as const,
      commission: null,
    };
  }

  const existingCommission = toCommissionRecord(commission);

  if (
    existingCommission.status === 'paid' ||
    existingCommission.status === 'waived'
  ) {
    return {
      status: 'locked' as const,
      commission: existingCommission,
    };
  }

  const updated = await prisma.commission.update({
    where: { id: commissionId },
    data: {
      productValue,
      commissionAmount: calculateCommissionAmount(productValue),
      status: 'due',
    },
    include: {
      listing: {
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });

  const mappedCommission = toCommissionRecord(updated);

  safelyPublishRealtimeEvent({
    type: 'commission_updated',
    payload: {
      commissionId: mappedCommission.id,
      listingId: mappedCommission.listingId,
      sellerId: mappedCommission.sellerId,
      status: mappedCommission.status,
      reason: 'sale_amount_updated',
    },
    visibility: {
      includeAdmins: true,
      userIds: [mappedCommission.sellerId],
    },
  });

  return {
    status: 'updated' as const,
    commission: mappedCommission,
  };
}

export async function setCommissionStatusForAdmin(
  commissionId: string,
  status: Extract<CommissionStatus, 'due' | 'paid' | 'waived' | 'disputed'>,
  admin?: Actor,
) {
  if (!shouldUseDatabaseStore()) {
    const result = memoryStore.setCommissionStatusForAdmin(commissionId, status);

    if (result.commission) {
      safelyPublishRealtimeEvent({
        type: 'commission_updated',
        payload: {
          commissionId: result.commission.id,
          listingId: result.commission.listingId,
          sellerId: result.commission.sellerId,
          status: result.commission.status,
          reason: 'status_updated',
        },
        visibility: {
          includeAdmins: true,
          userIds: [result.commission.sellerId],
        },
      });
    }

    return result;
  }

  const adminId = await getAdminAuditActorId(admin);
  const updated = await prisma.$transaction(async (tx) => {
    const commission = await tx.commission.update({
      where: { id: commissionId },
      data: {
        status,
        paidAt: status === 'paid' ? new Date() : undefined,
      },
      include: {
        listing: {
          include: {
            images: {
              orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });

    await createAdminAuditLog(tx, {
      adminId,
      action: 'update_commission',
      targetType: 'commission',
      targetId: commissionId,
      metadata: { nextStatus: status },
    });

    return commission;
  }).catch(() => null);

  if (!updated) {
    return {
      status: 'not_found' as const,
      commission: null,
    };
  }

  const mappedCommission = toCommissionRecord(updated);

  safelyPublishRealtimeEvent({
    type: 'commission_updated',
    payload: {
      commissionId: mappedCommission.id,
      listingId: mappedCommission.listingId,
      sellerId: mappedCommission.sellerId,
      status: mappedCommission.status,
      reason: 'status_updated',
    },
    visibility: {
      includeAdmins: true,
      userIds: [mappedCommission.sellerId],
    },
  });

  return {
    status: mappedCommission.status,
    commission: mappedCommission,
  };
}
