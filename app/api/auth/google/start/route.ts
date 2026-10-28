import { NextResponse } from 'next/server';

import {
  createOauthState,
  createOauthStateCookie,
  hasCommissionAgreement,
  sanitizeAuthReturnTo,
} from '@/lib/auth/session';
import {
  createMobileAuthState,
  isMobileAppRequest,
} from '@/lib/auth/mobile-oauth';
import { getAppBaseUrl } from '@/lib/app-url';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mobileFallback = url.searchParams.get('native_fallback') === '1';
  const returnTo = sanitizeAuthReturnTo(url.searchParams.get('return_to'));

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_google_start',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!hasCommissionAgreement(request)) {
    const agreementUrl = new URL('/commission-agreement', getAppBaseUrl(request));
    agreementUrl.searchParams.set('provider', 'google');
    if (returnTo !== '/') agreementUrl.searchParams.set('return_to', returnTo);
    if (mobileFallback) {
      agreementUrl.searchParams.set('native_fallback', '1');
    }

    return NextResponse.redirect(agreementUrl);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    console.warn('[google_auth] start_unavailable=missing_client_id');
    return new Response('Google sign-in is temporarily unavailable.', {
      status: 503,
    });
  }

  const isMobileAuth = isMobileAppRequest(request) || mobileFallback;
  const oauthState = isMobileAuth ? createMobileAuthState() : createOauthState(returnTo);
  const callbackUrl = new URL('/api/auth/google/callback', getAppBaseUrl(request));
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', oauthState);
  authorizationUrl.searchParams.set('prompt', 'select_account');

  const headers = new Headers({
    Location: authorizationUrl.toString(),
  });

  headers.set('Set-Cookie', createOauthStateCookie(oauthState));

  return new NextResponse(null, {
    status: 302,
    headers,
  });
}
