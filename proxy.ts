import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { clearSessionCookie, getAuthSession } from '@/lib/auth/session';
import { isSameOriginApiMutationAllowed } from '@/lib/security/same-origin';

const productionCanonicalUrl = 'https://souqhamad.com';
const productionHosts = new Set(['www.souqhamad.com', 'souqhamad.com']);

function normalizeCanonicalUrl(url: URL) {
  if (productionHosts.has(url.hostname.toLowerCase())) {
    url.protocol = 'https:';
    url.hostname = 'souqhamad.com';
    url.port = '';
  }

  return url;
}

function getCanonicalUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredUrl) {
    return new URL(productionCanonicalUrl);
  }

  const canonicalUrl = new URL(configuredUrl);

  return canonicalUrl.hostname.endsWith('.onrender.com')
    ? new URL(productionCanonicalUrl)
    : normalizeCanonicalUrl(canonicalUrl);
}

export async function proxy(request: NextRequest) {
  const canonicalUrl = getCanonicalUrl();

  // Health checks must answer on the platform host (e.g. *.onrender.com)
  // so the hosting provider can probe the running instance directly.
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  if (
    process.env.NODE_ENV === 'production' &&
    (request.nextUrl.hostname.endsWith('.onrender.com') ||
      request.nextUrl.hostname === 'www.souqhamad.com') &&
    request.nextUrl.hostname !== canonicalUrl.hostname
  ) {
    const url = request.nextUrl.clone();
    url.protocol = canonicalUrl.protocol;
    url.host = canonicalUrl.host;

    return NextResponse.redirect(url, 308);
  }

  if (!isSameOriginApiMutationAllowed(request)) {
    return NextResponse.json(
      { error: 'cross_site_request_blocked' },
      { status: 403 },
    );
  }

  if (
    request.nextUrl.pathname.startsWith('/api/') &&
    !request.nextUrl.pathname.startsWith('/api/auth/') &&
    process.env.SMARTSTORE_MARKETPLACE_STORE === 'database' &&
    process.env.DATABASE_URL?.trim()
  ) {
    const session = getAuthSession(request);

    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { deletedAt: true },
      });

      if (!user || user.deletedAt) {
        const response = NextResponse.json(
          { error: 'auth_required' },
          { status: 401 },
        );
        response.headers.append('Set-Cookie', clearSessionCookie());
        return response;
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|splash).*)'],
};
