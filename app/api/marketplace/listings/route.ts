import { z } from 'zod';

import {
  createListingDraft,
  listMarketplaceListings,
} from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? undefined;

  return Response.json({
    listings: await listMarketplaceListings({ query }),
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

  const listing = await createListingDraft(session.user, parsed.data);

  if (listing.compliance.decision === 'block') {
    return Response.json(
      {
        error: 'listing_blocked',
        listing,
      },
      { status: 422 },
    );
  }

  return Response.json({ listing }, { status: 201 });
}
