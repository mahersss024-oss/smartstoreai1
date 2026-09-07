import type { AuthSessionUser } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

import { evaluateSaudiMarketplaceCompliance } from './policy';
import { parseMarketplaceSearchQuery } from './search';
import * as memoryStore from './store';
import type {
  ComplianceDecision,
  CommissionRecord,
  CommissionStatus,
  Conversation,
  ConversationMessage,
  FavoriteRecord,
  ListingCondition,
  ListingImage,
  ListingStatus,
  ReportRecord,
} from './types';
import { evaluateConversationMessageSafety } from './message-safety';

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
    reasons: string[];
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
    Object.values(input.attributes ?? {}).join(' '),
  ]
    .filter(Boolean)
    .join(' ');
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

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toPrismaJsonObject(value: Record<string, unknown>) {
  return value as Prisma.InputJsonObject;
}

function getActorId(actor: Actor) {
  return typeof actor === 'string' ? actor : actor.id;
}

function getPlaceholderEmail(userId: string) {
  return `${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}@smartstore.local`;
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
          ({
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
            reasons: message.reasons,
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
  const searchConditions: Prisma.ListingWhereInput[] = [];

  if (parsedQuery.category) {
    searchConditions.push({ category: parsedQuery.category });
  }

  if (parsedQuery.city) {
    searchConditions.push({
      city: { contains: parsedQuery.city, mode: 'insensitive' },
    });
  }

  if (
    parsedQuery.minPrice !== undefined ||
    parsedQuery.maxPrice !== undefined
  ) {
    searchConditions.push({
      price: {
        ...(parsedQuery.minPrice !== undefined
          ? { gte: parsedQuery.minPrice }
          : {}),
        ...(parsedQuery.maxPrice !== undefined
          ? { lte: parsedQuery.maxPrice }
          : {}),
      },
    });
  }

  for (const termGroup of parsedQuery.termGroups) {
    searchConditions.push({
      OR: termGroup.flatMap((term) => [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
        { category: { contains: term, mode: 'insensitive' } },
      ]),
    });
  }

  const listings = await prisma.listing.findMany({
    where: {
      status: 'published',
      ...(searchConditions.length ? { AND: searchConditions } : {}),
    },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 80,
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

export async function createListingDraft(
  user: AuthSessionUser,
  input: CreateListingInput,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.createListingDraft({
      sellerId: user.id,
      ...input,
    });
  }

  await ensureUser(user);

  const compliance = evaluateSaudiMarketplaceCompliance(toSearchText(input));
  const listing = await prisma.listing.create({
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
      compliance: toPrismaJsonObject(
        compliance as unknown as Record<string, unknown>,
      ),
      status: chooseInitialStatus(compliance),
    },
    include: { images: true },
  });

  return toListingRecord(listing);
}

export async function updateListingForSeller(
  listingId: string,
  sellerId: string,
  updates: Partial<CreateListingInput>,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.updateListingForSeller(listingId, sellerId, updates);
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

  return toListingRecord(listing);
}

export async function setListingStatusForSeller(
  listingId: string,
  sellerId: string,
  status: Extract<ListingStatus, 'published' | 'paused' | 'sold' | 'deleted'>,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.setListingStatusForSeller(listingId, sellerId, status);
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
      : status;
  const listing = await prisma.listing.update({
    where: { id: listingId },
    data: { status: nextStatus },
    include: { images: true },
  });

  if (listing.status === 'sold') {
    const productValue =
      listing.price && typeof listing.price === 'object' && 'toNumber' in listing.price
        ? listing.price.toNumber()
        : null;

    await prisma.commission.upsert({
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
  }

  return toListingRecord(listing);
}

export async function addListingImageForSeller(
  listingId: string,
  sellerId: string,
  image: ListingImage,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.addListingImageForSeller(listingId, sellerId, image);
  }

  const existing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: { images: true },
  });

  if (!existing || existing.sellerId !== sellerId) {
    return null;
  }

  const isFirstApprovedImage = !existing.images.some(
    (currentImage) => currentImage.status === 'approved',
  );

  await prisma.listingImage.create({
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

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        take: 10,
      },
    },
  });

  return listing ? toListingRecord(listing) : null;
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

export async function createConversationForListing(
  listingId: string,
  buyer: Actor,
) {
  const buyerId = getActorId(buyer);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.createConversationForListing(listingId, buyerId);
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

  const conversation = await prisma.$transaction(async (tx) => {
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

  return {
    status: 'created' as const,
    conversation: toConversationRecord(conversation),
  };
}

export async function addConversationMessage(
  conversationId: string,
  sender: Actor,
  body: string,
) {
  const senderId = getActorId(sender);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.addConversationMessage(conversationId, senderId, body);
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

  await ensureActorUser(sender);

  const trimmedBody = body.trim();
  const safety = evaluateConversationMessageSafety(trimmedBody);
  const message = await prisma.conversationMessage.create({
    data: {
      conversationId,
      senderId,
      body: trimmedBody,
      status: safety.decision === 'allow' ? 'sent' : 'blocked',
      reasons: safety.reasons,
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
    reasons: message.reasons,
    createdAt: message.createdAt.toISOString(),
  };

  if (mappedMessage.status === 'blocked') {
    return {
      status: 'message_blocked' as const,
      message: mappedMessage,
      conversation: updatedConversation,
    };
  }

  return {
    status: 'sent' as const,
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

export async function toggleFavoriteListing(listingId: string, actor: Actor) {
  const userId = getActorId(actor);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.toggleFavoriteListing(listingId, userId);
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

  const existing = await prisma.favorite.findUnique({
    where: {
      listingId_userId: {
        listingId,
        userId,
      },
    },
  });

  if (existing) {
    const updatedListing = await prisma.$transaction(async (tx) => {
      await tx.favorite.delete({ where: { id: existing.id } });

      return tx.listing.update({
        where: { id: listingId },
        data: { favoriteCount: { decrement: 1 } },
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          },
        },
      });
    });

    return {
      status: 'removed' as const,
      favorite: null,
      listing: toListingRecord(updatedListing),
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const favorite = await tx.favorite.create({
      data: {
        listingId,
        userId,
      },
    });
    const updatedListing = await tx.listing.update({
      where: { id: listingId },
      data: { favoriteCount: { increment: 1 } },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    return { favorite, listing: updatedListing };
  });

  return {
    status: 'saved' as const,
    favorite: {
      id: result.favorite.id,
      listingId: result.favorite.listingId,
      userId: result.favorite.userId,
      createdAt: result.favorite.createdAt.toISOString(),
    } satisfies FavoriteRecord,
    listing: toListingRecord(result.listing),
  };
}

export async function reportListing(
  listingId: string,
  actor: Actor,
  reason: string,
  details?: string,
) {
  const reporterId = getActorId(actor);

  if (!shouldUseDatabaseStore()) {
    return memoryStore.reportListing(listingId, reporterId, reason, details);
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

export async function setListingModerationStatus(
  listingId: string,
  status: Extract<ListingStatus, 'published' | 'rejected' | 'deleted'>,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.setListingModerationStatus(listingId, status);
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

  const listing = await prisma.listing.update({
    where: { id: listingId },
    data: { status },
    include: {
      images: {
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      },
    },
  });

  return {
    status: listing.status as ListingStatus,
    listing: toListingRecord(listing),
  };
}

export async function setReportModerationStatus(
  reportId: string,
  status: Extract<ReportRecord['status'], 'reviewed' | 'dismissed'>,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.setReportModerationStatus(reportId, status);
  }

  const report = await prisma.report.update({
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
  }).catch(() => null);

  if (!report) {
    return {
      status: 'not_found' as const,
      report: null,
    };
  }

  return {
    status: report.status as ReportRecord['status'],
    report: toReportRecord(report),
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

export async function updateCommissionSaleAmountForSeller(
  commissionId: string,
  sellerId: string,
  productValue: number,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.updateCommissionSaleAmountForSeller(
      commissionId,
      sellerId,
      productValue,
    );
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

  const mappedCommission = toCommissionRecord(commission);

  if (mappedCommission.status === 'paid' || mappedCommission.status === 'waived') {
    return {
      status: 'locked' as const,
      commission: mappedCommission,
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

  return {
    status: 'updated' as const,
    commission: toCommissionRecord(updated),
  };
}

export async function setCommissionStatusForAdmin(
  commissionId: string,
  status: Extract<CommissionStatus, 'due' | 'paid' | 'waived' | 'disputed'>,
) {
  if (!shouldUseDatabaseStore()) {
    return memoryStore.setCommissionStatusForAdmin(commissionId, status);
  }

  const updated = await prisma.commission.update({
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
  }).catch(() => null);

  if (!updated) {
    return {
      status: 'not_found' as const,
      commission: null,
    };
  }

  return {
    status: updated.status as CommissionStatus,
    commission: toCommissionRecord(updated),
  };
}
