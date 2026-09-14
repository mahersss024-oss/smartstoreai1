import { NextResponse } from 'next/server';

import { getAppBaseUrl } from '@/lib/app-url';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAppleClientId, isAppleAuthConfigured } from '@/lib/auth/apple';
import {
  createOauthState,
  createOauthStateCookie,
  hasCommissionAgreement,
} from '@/lib/auth/session';

export async function GET(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_apple_start',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!hasCommissionAgreement(request)) {
    return NextResponse.redirect(
      new URL('/commission-agreement?provider=apple', getAppBaseUrl(request)),
    );
  }

  if (!isAppleAuthConfigured()) {
    return new Response('Apple OAuth is not configured.', { status: 500 });
  }

  const state = createOauthState();
  const callbackUrl = new URL(
    '/api/auth/apple/callback',
    getAppBaseUrl(request),
  );
  const authorizationUrl = new URL('https://appleid.apple.com/auth/authorize');

  authorizationUrl.searchParams.set('client_id', getAppleClientId());
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizationUrl.searchParams.set('response_type', 'code id_token');
  authorizationUrl.searchParams.set('response_mode', 'form_post');
  authorizationUrl.searchParams.set('scope', 'name email');
  authorizationUrl.searchParams.set('state', state);

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      'Set-Cookie': createOauthStateCookie(state, {
        sameSite: 'None',
        secure: true,
      }),
    },
  });
}
