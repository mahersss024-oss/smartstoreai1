import { z } from 'zod';

import {
  deactivatePushSubscription,
  savePushSubscription,
} from '@/agent/marketplace/push-subscriptions';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getAuthSession } from '@/lib/auth/session';
import { isPushConfigured, getVapidConfig } from '@/lib/push/web-push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  platform: z.enum(['web', 'ios', 'android']).optional(),
  locale: z.string().max(10).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function GET() {
  const config = getVapidConfig();

  return Response.json(
    {
      configured: isPushConfigured(),
      publicKey: config?.publicKey ?? null,
    },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'push_subscribe',
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!isPushConfigured()) {
    return Response.json(
      { error: 'push_not_configured' },
      { status: 503, headers: noStoreHeaders },
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = subscribeSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const session = getAuthSession(request);
  const id = await savePushSubscription({
    userId: session?.user.id ?? null,
    endpoint: parsed.data.endpoint,
    p256dh: parsed.data.keys.p256dh,
    auth: parsed.data.keys.auth,
    platform: parsed.data.platform,
    locale: parsed.data.locale,
    userAgent: request.headers.get('user-agent'),
  });

  return Response.json({ id }, { headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = unsubscribeSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  await deactivatePushSubscription(parsed.data.endpoint);

  return Response.json({ ok: true }, { headers: noStoreHeaders });
}

