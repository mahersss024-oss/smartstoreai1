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
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

type ListingsResponsePayload = {
  listings: Awaited<ReturnType<typeof listMarketplaceListings>>;
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
    nextPage: number | null;
  };
};

const createListingSchema = z.object({
  category: z.string().min(2),
  title: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  price: z
    .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
    .optional(),
  city: z.string().min(2).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? undefined;
  const page = parsePositiveInteger(url.searchParams.get('page'), 1);
  const limit = Math.min(
    Math.max(parsePositiveInteger(url.searchParams.get('limit'), 24), 1),
    48,
  );

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
    page,
    limit: limit + 1,
  });
  const hasMore = listings.length > limit;
  const payload = {
    listings: listings.slice(0, limit),
    pagination: {
      page,
      limit,
      hasMore,
      nextPage: hasMore ? page + 1 : null,
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
        message: 'Google sign-in is required to create a listing draft.',
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
