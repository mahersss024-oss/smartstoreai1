import { listingCategoryClassifier, listingCategoryTextSchema } from '@/agent/marketplace/listing-category-model';
import { getAuthSession } from '@/lib/auth/session';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';

export async function POST(request: Request) {
  const session = getAuthSession(request);
  if (!session) return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  const limited = await enforceApiRateLimit(request, {
    namespace: 'listing_category', actorId: session.user.id, maxRequests: 20, windowMs: 60_000,
  });
  if (limited) return limited;
  const oversized = rejectOversizedRequest(request, 24 * 1024);
  if (oversized) return oversized;
  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_json' }, { status: 400, headers: noStoreHeaders }); }
  const parsed = listingCategoryTextSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'invalid_request' }, { status: 400, headers: noStoreHeaders });
  const result = await listingCategoryClassifier.suggest(parsed.data);
  return Response.json(result, { status: result.status === 'unavailable' ? 503 : 200, headers: noStoreHeaders });
}
