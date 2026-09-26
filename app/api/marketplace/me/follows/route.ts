import { listAccountFollows } from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'account_follows',
    actorId: session.user.id,
    maxRequests: 120,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const follows = await listAccountFollows(session.user);

  return Response.json(follows);
}
