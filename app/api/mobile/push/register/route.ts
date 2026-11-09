import { z } from 'zod';

import {
  deactivateMobilePushToken,
  saveMobilePushRegistration,
} from '@/agent/marketplace/mobile-push-tokens';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';
import { parseMobilePushRemovalToken } from '@/lib/push/mobile-registration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const maxMobilePushRequestBytes = 8 * 1024;

const registerSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().trim().min(1).max(32).optional(),
  locale: z.string().trim().min(1).max(32).optional(),
});

const unregisterSchema = z.object({
  token: z.string().min(20).max(4096),
  removalToken: z.string().min(1).max(2048).optional(),
});

export async function POST(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      { error: 'auth_required' },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'mobile_push_register',
    actorId: session.user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = await rejectOversizedRequest(
    request,
    maxMobilePushRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const registration = await saveMobilePushRegistration({
    userId: session.user.id,
    token: parsed.data.token,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion,
    locale: parsed.data.locale,
    userAgent: request.headers.get('user-agent'),
    sessionExpiresAt: new Date(session.expiresAt * 1000),
  });

  return Response.json(registration, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const session = getAuthSession(request);
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'mobile_push_unregister',
    actorId: session?.user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = await rejectOversizedRequest(
    request,
    maxMobilePushRequestBytes,
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: session ? 'invalid_json' : 'auth_required' }, { status: session ? 400 : 401 });
  }

  const parsed = unregisterSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: session ? 'invalid_request' : 'auth_required' },
      { status: session ? 400 : 401 },
    );
  }

  const removal = parsed.data.removalToken
    ? parseMobilePushRemovalToken(parsed.data.removalToken, parsed.data.token) : null;
  if ((parsed.data.removalToken && !removal) || (!session && !removal))
    return Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders });
  await deactivateMobilePushToken(parsed.data.token, removal?.userId ?? session!.user.id, removal?.registrationKey);

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
