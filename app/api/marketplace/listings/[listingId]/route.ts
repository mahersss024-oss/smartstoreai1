import { z } from 'zod';

import {
  getListing,
  setListingStatusForSeller,
  updateListingForSeller,
} from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

const updateListingSchema = z.object({
  title: z.string().min(2).optional(),
  description: z.string().min(2).optional(),
  price: z
    .union([z.number().nonnegative(), z.enum(['bid', 'negotiable'])])
    .optional(),
  city: z.string().min(2).optional(),
  category: z.string().min(2).optional(),
  condition: z.enum(['new', 'used', 'like_new', 'damaged']).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const actionSchema = z.object({
  action: z.enum(['publish', 'pause', 'mark_sold', 'delete']),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

function getActionStatus(action: z.infer<typeof actionSchema>['action']) {
  if (action === 'publish') {
    return 'published';
  }

  if (action === 'pause') {
    return 'paused';
  }

  if (action === 'mark_sold') {
    return 'sold';
  }

  return 'deleted';
}

export async function GET(_request: Request, context: RouteContext) {
  const { listingId } = await context.params;
  const listing = await getListing(listingId);

  if (!listing || listing.status !== 'published') {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  return Response.json({ listing });
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to control a listing.',
      },
      { status: 401 },
    );
  }

  const { listingId } = await context.params;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const action = actionSchema.safeParse(payload);

  if (action.success) {
    const listing = await setListingStatusForSeller(
      listingId,
      session.user.id,
      getActionStatus(action.data.action),
    );

    if (!listing) {
      return Response.json({ error: 'listing_not_found' }, { status: 404 });
    }

    return Response.json({ listing });
  }

  const updates = updateListingSchema.safeParse(payload);

  if (!updates.success) {
    return Response.json(
      { error: 'invalid_request', details: updates.error.flatten() },
      { status: 400 },
    );
  }

  const listing = await updateListingForSeller(
    listingId,
    session.user.id,
    updates.data,
  );

  if (!listing) {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  if (listing.compliance.decision === 'block') {
    return Response.json(
      {
        error: 'listing_blocked',
        listing,
      },
      { status: 422 },
    );
  }

  return Response.json({ listing });
}
