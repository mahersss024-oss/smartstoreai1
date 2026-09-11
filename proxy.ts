import { NextResponse, type NextRequest } from 'next/server';

const productionCanonicalUrl = 'https://www.smartstore-ai.com';

function getCanonicalUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (!configuredUrl) {
    return new URL(productionCanonicalUrl);
  }

  const canonicalUrl = new URL(configuredUrl);

  return canonicalUrl.hostname.endsWith('.onrender.com')
    ? new URL(productionCanonicalUrl)
    : canonicalUrl;
}

export function proxy(request: NextRequest) {
  const canonicalUrl = getCanonicalUrl();

  // Health checks must answer on the platform host (e.g. *.onrender.com)
  // so the hosting provider can probe the running instance directly.
  if (request.nextUrl.pathname === '/api/health') {
    return NextResponse.next();
  }

  if (
    process.env.NODE_ENV === 'production' &&
    request.nextUrl.hostname.endsWith('.onrender.com') &&
    request.nextUrl.hostname !== canonicalUrl.hostname
  ) {
    const url = request.nextUrl.clone();
    url.protocol = canonicalUrl.protocol;
    url.host = canonicalUrl.host;

    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|splash).*)'],
};


