import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import {
  persistGoogleUserRegistration,
  verifyGoogleIdentityToken,
} from '@/lib/auth/google';
import {
  createSessionCookie,
  hasCommissionAgreement,
  type AuthSessionUser,
} from '@/lib/auth/session';

const maxNativeGoogleRequestBytes = 12 * 1024;

export async function POST(request: Request) {
  const oversizedRequest = rejectOversizedRequest(
    request,
    maxNativeGoogleRequestBytes,
    'Google native sign-in request body is too large.',
  );

  if (oversizedRequest) {
    return oversizedRequest;
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_google_native',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!hasCommissionAgreement(request)) {
    return Response.json(
      { error: 'commission_agreement_required' },
      { status: 409, headers: noStoreHeaders },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    idToken?: unknown;
  } | null;
  const idToken = typeof body?.idToken === 'string' ? body.idToken.trim() : '';

  if (!idToken) {
    return Response.json(
      { error: 'missing_google_id_token' },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const identity = await verifyGoogleIdentityToken(idToken);

  if (!identity) {
    return Response.json(
      { error: 'invalid_google_id_token' },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const user: AuthSessionUser = {
    id: `google:${identity.sub}`,
    email: identity.email,
    name: identity.name,
    picture: identity.picture,
  };
  let registeredUser = user;

  try {
    registeredUser = await persistGoogleUserRegistration(request, user);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'UnknownError';

    if (errorMessage === 'ACCOUNT_SOFT_DELETED') {
      return Response.json(
        { error: 'account_deactivated' },
        { status: 403, headers: noStoreHeaders },
      );
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[google_native_auth] registration_failed=${errorName}`);

    return Response.json(
      { error: 'google_registration_failed' },
      { status: 502, headers: noStoreHeaders },
    );
  }

  return Response.json(
    {
      authenticated: true,
      user: registeredUser,
    },
    {
      headers: {
        ...noStoreHeaders,
        'Set-Cookie': createSessionCookie(registeredUser),
      },
    },
  );
}
