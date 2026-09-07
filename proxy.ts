import { NextResponse, type NextRequest } from 'next/server';

const productionCanonicalUrl = 'https://www.smartstore-ai.com';

export function proxy(request: NextRequest) {
  const canonicalUrl = new URL(
    process.env.NEXT_PUBLIC_APP_URL?.trim() || productionCanonicalUrl,
  );

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
