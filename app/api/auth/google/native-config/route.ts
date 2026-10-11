import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getGoogleNativeClientId } from '@/lib/auth/google';

export async function GET(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_google_native_config',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const clientId = getGoogleNativeClientId();

  if (!clientId) {
    return Response.json(
      { error: 'google_native_unavailable' },
      { status: 503, headers: noStoreHeaders },
    );
  }

  return Response.json({ clientId }, { headers: noStoreHeaders });
}
