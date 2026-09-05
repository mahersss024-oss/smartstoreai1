import { NextResponse } from 'next/server';

import {
  createOauthState,
  createOauthStateCookie,
  hasCommissionAgreement,
} from '@/lib/auth/session';

function getBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
}

export async function GET(request: Request) {
  if (!hasCommissionAgreement(request)) {
    return NextResponse.redirect(new URL('/commission-agreement', getBaseUrl(request)));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();

  if (!clientId) {
    return new Response('GOOGLE_CLIENT_ID is not configured.', { status: 500 });
  }

  const state = createOauthState();
  const callbackUrl = new URL('/api/auth/google/callback', getBaseUrl(request));
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');

  authorizationUrl.searchParams.set('client_id', clientId);
  authorizationUrl.searchParams.set('redirect_uri', callbackUrl.toString());
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('scope', 'openid email profile');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set('prompt', 'select_account');

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.toString(),
      'Set-Cookie': createOauthStateCookie(state),
    },
  });
}
