import { randomUUID } from 'node:crypto';

import {
  recordSiteVisit,
  siteVisitorCookieName,
} from '@/lib/analytics/site-visits';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getCookieValue } from '@/lib/auth/session';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { noStoreHeaders } from '@/lib/api/no-store';
import { z } from 'zod';

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
  const oversized = await rejectOversizedRequest(request, 2048);
  if (oversized) return oversized;
  // An absent body preserves the original website contract.
  const body = await request.text();
  let payload: unknown = {};
  try { if (body.trim()) payload = JSON.parse(body); }
  catch { return Response.json({ error: 'invalid_json' }, { status: 400, headers: noStoreHeaders }); }
  const parsed = z.object({
    platform: z.enum(['web', 'ios', 'android']).default('web'),
    visitorId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/).optional(),
    sessionId: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/).optional(),
    path: z.string().max(500).optional(),
  }).safeParse(payload);
  if (!parsed.success || (parsed.data.platform !== 'web' && (!parsed.data.visitorId || !parsed.data.sessionId)))
    return Response.json({ error: 'invalid_request' }, { status: 400, headers: noStoreHeaders });
  const native = parsed.data.platform !== 'web';
  const existingVisitorId = normalizeVisitorId(
    getCookieValue(request, siteVisitorCookieName),
  );
  const visitorId = native ? parsed.data.visitorId! : existingVisitorId ?? randomUUID();
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'site_visit',
    actorId: native ? `${parsed.data.platform}:${visitorId}` : existingVisitorId ?? undefined,
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await recordSiteVisit({ ...parsed.data, visitorId });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[site_visit] failure=${errorName}`);
    if (native) return Response.json({ error: 'analytics_unavailable' }, { status: 503, headers: noStoreHeaders });
  }

  const headers = new Headers(noStoreHeaders);

  if (!native && !existingVisitorId) {
    headers.append('Set-Cookie', createVisitorCookie(visitorId));
  }

  return Response.json({ ok: true }, { headers });
}
