import { z } from 'zod';

import {
  createListingDraft,
  listPublicMarketplaceListings,
} from '@/agent/marketplace/repository';
import {
  getMaxListingsPerSeller,
  isListingLimitReachedError,
} from '@/agent/marketplace/listing-limits';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';
import { parsePaginationFromRequest } from '@/lib/pagination';
import { marketplaceCategoryIds } from '@/lib/marketplace/categories';
import { getMarketplaceCategoryOption, InvalidMarketplaceCategoryOptionError } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModel } from '@/lib/marketplace/car-models';
import { sortPreferenceSchema } from '@/agent/marketplace/structured-search-intent';

export const dynamic = 'force-dynamic';

const maxCreateListingRequestBytes = 64 * 1024;
const publicSearchSchema = z.object({
  query: z.string().trim().max(300).optional(),
  city: z.string().trim().max(80).optional(),
  category: z.enum(marketplaceCategoryIds).optional(),
  categoryOption: z.string().trim().min(1).max(80).optional(),
  carModel: z.string().trim().min(1).max(80).optional(),
  categories: z.array(z.enum(marketplaceCategoryIds)).max(marketplaceCategoryIds.length).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  yearMin: z.coerce.number().int().min(1900).max(2099).optional(),
  yearMax: z.coerce.number().int().min(1900).max(2099).optional(),
  mileageMin: z.coerce.number().int().nonnegative().optional(),
  mileageMax: z.coerce.number().int().nonnegative().optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  sort: sortPreferenceSchema.optional(),
}).refine(value => !value.categoryOption || Boolean(value.category && getMarketplaceCategoryOption(value.category, value.categoryOption)), { message: 'invalid_category_option' })
  .refine(value => !value.carModel || Boolean(value.category === 'cars' && value.categoryOption && getMarketplaceCarModel(value.categoryOption, value.carModel)), { message: 'invalid_car_model' });
const createListingSchema = z.object({
  autoCategory: z.boolean().optional(),
  category: z.enum(marketplaceCategoryIds),
  title: z.string().min(2).max(140).optional(),
  description: z.string().min(2).max(4000).optional(),
  price: z
    .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
    .optional(),
  city: z.string().min(2).max(80).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? undefined;
  const cityParam = url.searchParams.get('city')?.trim();
  const city = cityParam && cityParam !== 'all' ? cityParam : undefined;
  const parsedSearch = publicSearchSchema.safeParse({
    query, city,
    categories: url.searchParams.has('categories') ? url.searchParams.get('categories')!.split(',') : undefined,
    ...Object.fromEntries(['category', 'categoryOption', 'carModel', 'minPrice', 'maxPrice', 'yearMin', 'yearMax', 'mileageMin', 'mileageMax', 'condition', 'sort']
      .filter(key => url.searchParams.has(key)).map(key => [key, url.searchParams.get(key)])),
  });
  if (!parsedSearch.success) return Response.json({ error: 'invalid_search_filters' }, { status: 400, headers: noStoreHeaders });
  const pagination = parsePaginationFromRequest(request, {
    defaultLimit: 24,
    maxLimit: 48,
  });

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'search',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const listings = await listPublicMarketplaceListings({
    ...parsedSearch.data,
    page: pagination.page,
    limit: pagination.limit,
    take: pagination.limit + 1,
  });
  const hasMore = listings.length > pagination.limit;
  const payload = {
    listings: listings.slice(0, pagination.limit),
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      hasMore,
      nextPage: hasMore ? pagination.page + 1 : null,
    },
  };

  return Response.json(payload, {
    headers: noStoreHeaders,
  });
}

export async function POST(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to create a listing draft.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'listing_create',
    actorId: session.user.id,
    maxRequests: 12,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxCreateListingRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = createListingSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'listing_create',
    actorKey: session.user.id,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  let listing: Awaited<ReturnType<typeof createListingDraft>>;

  try {
    listing = await createListingDraft(session.user, parsed.data);
  } catch (error) {
    if (error instanceof InvalidMarketplaceCategoryOptionError) {
      await idempotency?.abandon();
      return Response.json({ error: 'invalid_category_option', message: error.message }, { status: 400 });
    }
    if (isListingLimitReachedError(error)) {
      const maxListings = getMaxListingsPerSeller();
      const responseBody = {
        error: 'seller_listing_limit_reached',
        message: `وصل حسابك إلى الحد الأقصى (${maxListings}) من الإعلانات المحفوظة. احذف إعلانًا قديمًا قبل إضافة إعلان جديد.`,
        maxListings,
      };

      return idempotency
        ? idempotency.complete(responseBody, 409)
        : Response.json(responseBody, { status: 409 });
    }

    await idempotency?.abandon();
    throw error;
  }

  if (listing.compliance.decision === 'block') {
    const responseBody = {
      error: 'listing_blocked',
      listing,
    };

    return idempotency
      ? idempotency.complete(responseBody, 422)
      : Response.json(responseBody, { status: 422 });
  }

  const responseBody = { listing };

  return idempotency
    ? idempotency.complete(responseBody, 201)
    : Response.json(responseBody, { status: 201 });
}
