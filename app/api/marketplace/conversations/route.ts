import { z } from 'zod';

import { createConversationForListing } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';

const createConversationSchema = z.object({
  listingId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to message a seller.',
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

  const parsed = createConversationSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await createConversationForListing(
    parsed.data.listingId,
    session.user,
  );

  if (result.status === 'not_found') {
    return Response.json(
      { error: 'listing_not_found_or_unavailable' },
      { status: 404 },
    );
  }

  if (result.status === 'self_contact_blocked') {
    return Response.json(
      { error: 'self_contact_blocked' },
      { status: 409 },
    );
  }

  return Response.json(result, {
    status: result.status === 'created' ? 201 : 200,
  });
}
