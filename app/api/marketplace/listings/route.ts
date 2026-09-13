import { z } from 'zod';

import {
  createListingDraft,
  listMarketplaceListings,
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

export const dynamic = 'force-dynamic';

const maxCreateListingRequestBytes = 64 * 1024;

const createListingSchema = z.object({
  category: z.string().min(2).max(80),
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

  const listings = await listMarketplaceListings({
    query,
    page: pagination.page,
    limit: pagination.limit + 1,
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
