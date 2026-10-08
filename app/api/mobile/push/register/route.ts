import { z } from 'zod';

import {
  deactivateMobilePushToken,
  saveMobilePushToken,
} from '@/agent/marketplace/mobile-push-tokens';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';

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

  const oversizedRequestResponse = rejectOversizedRequest(
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

  const id = await saveMobilePushToken({
    userId: session.user.id,
    token: parsed.data.token,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion,
    locale: parsed.data.locale,
    userAgent: request.headers.get('user-agent'),
  });

  return Response.json({ id }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      { error: 'auth_required' },
      { status: 401, headers: noStoreHeaders },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'mobile_push_unregister',
    actorId: session.user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
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

  const parsed = unregisterSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await deactivateMobilePushToken(parsed.data.token, session.user.id);

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}
