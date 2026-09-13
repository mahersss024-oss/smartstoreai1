import { z } from 'zod';

import { setListingModerationStatus } from '@/agent/marketplace/repository';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';

const maxModerationListingActionRequestBytes = 4 * 1024;

const moderationActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'delete']),
});

type RouteContext = {
  params: Promise<{
    listingId: string;
  }>;
};

function getModerationStatus(action: z.infer<typeof moderationActionSchema>['action']) {
  if (action === 'approve') {
    return 'published';
  }

  if (action === 'delete') {
    return 'deleted';
  }

  return 'rejected';
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!(await hasVerifiedModeratorAccess(session))) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxModerationListingActionRequestBytes,
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

  const parsed = moderationActionSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { listingId } = await context.params;
  const result = await setListingModerationStatus(
    listingId,
    getModerationStatus(parsed.data.action),
    session.user,
  );

  if (result.status === 'not_found') {
    return Response.json({ error: 'listing_not_found' }, { status: 404 });
  }

  if (result.status === 'blocked_by_policy') {
    return Response.json(
      { error: 'blocked_by_policy', listing: result.listing },
      { status: 422 },
    );
  }

  return Response.json(result);
}
