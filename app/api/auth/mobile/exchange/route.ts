import { NextResponse } from 'next/server';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAppBaseUrl } from '@/lib/app-url';
import { parseMobileAuthTicket } from '@/lib/auth/mobile-oauth';
import { createSessionCookie, parseSignedSession } from '@/lib/auth/session';

export async function GET(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_mobile_exchange',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const url = new URL(request.url);
  const sessionValue = parseMobileAuthTicket(url.searchParams.get('ticket'));
  const session = parseSignedSession(sessionValue);

  if (!session) {
    return new Response('Invalid mobile sign-in ticket.', { status: 400 });
  }

  const response = NextResponse.redirect(new URL('/', getAppBaseUrl(request)));
  response.headers.append('Set-Cookie', createSessionCookie(session.user));

  return response;
}
