import { randomUUID } from 'node:crypto';

import {
  recordSiteVisit,
  siteVisitorCookieName,
} from '@/lib/analytics/site-visits';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getCookieValue } from '@/lib/auth/session';

const visitorMaxAgeSeconds = 60 * 60 * 24 * 365;

function createVisitorCookie(visitorId: string) {
  const parts = [
    `${siteVisitorCookieName}=${encodeURIComponent(visitorId)}`,
    'Path=/',
    `Max-Age=${visitorMaxAgeSeconds}`,
    'SameSite=Lax',
    'HttpOnly',
  ];

  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function normalizeVisitorId(value: string | undefined) {
  return value && /^[a-zA-Z0-9_-]{16,80}$/.test(value) ? value : null;
}

export async function POST(request: Request) {
  const existingVisitorId = normalizeVisitorId(
    getCookieValue(request, siteVisitorCookieName),
  );
  const visitorId = existingVisitorId ?? randomUUID();
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'site_visit',
    actorId: existingVisitorId ?? undefined,
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await recordSiteVisit({ visitorId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[site_visit] failure=${errorName}`);
  }

  const headers = new Headers();

  if (!existingVisitorId) {
    headers.append('Set-Cookie', createVisitorCookie(visitorId));
  }

  return Response.json({ ok: true }, { headers });
}
