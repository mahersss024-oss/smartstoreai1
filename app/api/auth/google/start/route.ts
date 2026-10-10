import { NextResponse } from 'next/server';

import {
  createOauthState,
  createOauthStateCookie,
  hasCommissionAgreement,
} from '@/lib/auth/session';
import {
  appendMobileClientParam,
  createMobileAuthState,
  isMobileAuthRequest,
} from '@/lib/auth/mobile-oauth';
import { getAppBaseUrl } from '@/lib/app-url';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';

export async function GET(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_google_start',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const isMobileAuth = isMobileAuthRequest(request);

  if (!hasCommissionAgreement(request)) {
    const agreementUrl = new URL(
      '/commission-agreement?provider=google',
      getAppBaseUrl(request),
    );

    if (isMobileAuth) {
      appendMobileClientParam(agreementUrl);
    }

    return NextResponse.redirect(
      agreementUrl,
    );
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    console.warn('[google_auth] start_unavailable=missing_client_id');
    return new Response('Google sign-in is temporarily unavailable.', {
      status: 503,
    });
  }

  const oauthState = isMobileAuth
    ? createMobileAuthState()
    : createOauthState();
  const callbackUrl = new URL('/api/auth/google/callback', getAppBaseUrl(request));
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', oauthState);
  authorizationUrl.searchParams.set('prompt', 'select_account');

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      'Set-Cookie': createOauthStateCookie(oauthState),
    },
  });
}
