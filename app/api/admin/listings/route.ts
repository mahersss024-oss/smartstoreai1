import { createListingImageDeliveryUrls } from '@/agent/marketplace/listing-image-delivery';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { noStoreHeaders } from '@/lib/api/no-store';
import { parsePaginationFromRequest } from '@/lib/pagination';
import { isMarketplaceCategory } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOption, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModel, marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';

export const dynamic = 'force-dynamic';

function decimalToListingPrice(price: unknown, priceMode?: string | null) {
  if (priceMode === 'bid' || priceMode === 'negotiable') {
    return priceMode;
  }

  if (price && typeof price === 'object' && 'toNumber' in price) {
    return (price as { toNumber: () => number }).toNumber();
  }

  return typeof price === 'number' ? price : null;
}

function mapListing(listing: {
  id: string;
  sellerId: string;
  category: string;
  attributes?: unknown;
  title: string | null;
  description: string | null;
  price: unknown;
  priceMode: string | null;
  city: string | null;
  condition: string | null;
  status: string;
  views: number;
  messageCount: number;
  favoriteCount: number;
  createdAt: Date;
  updatedAt: Date;
  seller?: { email: string; name: string | null } | null;
  images?: Array<{ id: string; originalUrl: string; displayUrl: string; thumbnailUrl: string; isPrimary: boolean }>;
}) {
  return {
    id: listing.id,
    sellerId: listing.sellerId,
    seller: listing.seller,
    category: listing.category,
    attributes: listing.attributes,
    title: listing.title,
    description: listing.description,
    price: decimalToListingPrice(listing.price, listing.priceMode),
    priceMode: listing.priceMode,
    city: listing.city,
    condition: listing.condition,
    status: listing.status,
    views: listing.views,
    messageCount: listing.messageCount,
    favoriteCount: listing.favoriteCount,
    createdAt: listing.createdAt.toISOString(),
    updatedAt: listing.updatedAt.toISOString(),
    images:
      listing.images?.map((image) => ({
        ...image,
        ...createListingImageDeliveryUrls(image.originalUrl, { displayUrl: image.displayUrl, thumbnailUrl: image.thumbnailUrl }),
      })) ?? [],
  };
}

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('query')?.trim();
  const status = url.searchParams.get('status')?.trim();
  const listingId = url.searchParams.get('listingId')?.trim();
  const sellerId = url.searchParams.get('sellerId')?.trim();
  const category = url.searchParams.get('category')?.trim();
  const categoryOption = url.searchParams.get('categoryOption')?.trim();
  const carModel = url.searchParams.get('carModel')?.trim();
  if ((category && !isMarketplaceCategory(category)) || (categoryOption && (!category || !getMarketplaceCategoryOption(category, categoryOption)))) {
    return Response.json({ error: 'invalid_search_filters' }, { status: 400, headers: noStoreHeaders });
  }
  if (carModel && (category !== 'cars' || !categoryOption || !getMarketplaceCarModel(categoryOption, carModel))) {
    return Response.json({ error: 'invalid_search_filters' }, { status: 400, headers: noStoreHeaders });
  }
  const pagination = parsePaginationFromRequest(request, {
    defaultLimit: 24,
    maxLimit: 48,
  });
  const where = {
    ...(category ? { category } : {}),
    ...(categoryOption ? { attributes: { path: [marketplaceCategoryOptionAttribute], equals: categoryOption } } : {}),
    ...(carModel ? { AND: [{ attributes: { path: [marketplaceCarModelAttribute], equals: carModel } }] } : {}),
    ...(sellerId ? { sellerId } : {}),
    ...(listingId ? { id: listingId } : {}),
    ...(status && status !== 'all' ? { status: status as never } : {}),
    ...(query && !listingId
      ? {
          OR: [
            { id: { contains: query, mode: 'insensitive' as const } },
            { title: { contains: query, mode: 'insensitive' as const } },
            { description: { contains: query, mode: 'insensitive' as const } },
            { category: { contains: query, mode: 'insensitive' as const } },
            { city: { contains: query, mode: 'insensitive' as const } },
            { seller: { email: { contains: query, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      include: {
        seller: { select: { email: true, name: true } },
        images: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, originalUrl: true, displayUrl: true, thumbnailUrl: true, isPrimary: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.listing.count({ where }),
  ]);

  return Response.json({
    listings: listings.map(mapListing),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      hasMore: pagination.skip + listings.length < total,
      nextPage:
        pagination.skip + listings.length < total ? pagination.page + 1 : null,
      total,
    },
  }, {
    headers: noStoreHeaders,
  });
}
