import { z } from 'zod';

import { reportListing } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

const reportSchema = z.object({
  reason: z.enum([
    'prohibited_item',
    'fraud',
    'counterfeit',
    'wrong_category',
    'misleading_images',
    'abusive_content',
    'other',
  ]),
  details: z.string().trim().max(1000).optional(),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to report a listing.',
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

  const parsed = reportSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { listingId } = await context.params;
  const result = await reportListing(
    listingId,
    session.user,
    parsed.data.reason,
    parsed.data.details,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  return Response.json(result, { status: 201 });
}
