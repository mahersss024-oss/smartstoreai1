import { z } from 'zod';

import {
  addConversationMessage,
  getConversationForUser,
  shareSellerContact,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});
const shareContactSchema = z.object({
  action: z.literal('share_contact'),
});
const conversationPostSchema = z.union([sendMessageSchema, shareContactSchema]);
const maxConversationMessageRequestBytes = 8 * 1024;

type RouteContext = {
  params: Promise<{
    conversationId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to view this conversation.',
      },
      { status: 401 },
    );
  }

  const { conversationId } = await context.params;
  const conversation = await getConversationForUser(conversationId, session.user.id);

  if (!conversation) {
    return Response.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  return Response.json({ conversation }, { headers: noStoreHeaders });
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Google sign-in is required to send messages.',
      },
      { status: 401 },
    );
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'message',
    actorId: session.user.id,
    maxRequests: 30,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const oversizedRequestResponse = rejectOversizedRequest(
    request,
    maxConversationMessageRequestBytes,
    'Conversation message request body is too large.',
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

  const parsed = conversationPostSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { conversationId } = await context.params;
  const action = 'action' in parsed.data ? parsed.data.action : 'send_message';
  const messageBody = 'body' in parsed.data ? parsed.data.body : '';
  const idempotency = await reserveIdempotencyKey(request, {
    namespace:
      action === 'share_contact' ? 'seller_contact_share' : 'message_send',
    actorKey: `${session.user.id}:${conversationId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result =
    action === 'share_contact'
      ? await shareSellerContact(conversationId, session.user)
      : await addConversationMessage(
          conversationId,
          session.user,
          messageBody,
        );

  if (result.status === 'not_found') {
    const responseBody = { error: 'conversation_not_found' };

    return idempotency
      ? idempotency.complete(responseBody, 404)
      : Response.json(responseBody, { status: 404 });
  }

  if (result.status === 'conversation_closed') {
    const responseBody = {
      error: 'conversation_closed',
      conversation: result.conversation,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'not_seller') {
    const responseBody = {
      error: 'seller_only',
      message: 'Only the seller can share official contact information.',
      conversation: result.conversation,
    };

    return idempotency
      ? idempotency.complete(responseBody, 403)
      : Response.json(responseBody, { status: 403 });
  }

  if (result.status === 'missing_phone') {
    const responseBody = {
      error: 'seller_phone_required',
      message: 'Add your mobile number in account settings before sharing it.',
      conversation: result.conversation,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'message_blocked') {
    const responseBody = {
      error: 'message_blocked',
      message:
        'Manual phone numbers and emails are not allowed in buyer-seller chat. Use the official contact sharing button.',
      reasons: result.reasons,
      conversation: result.conversation,
    };

    return idempotency
      ? idempotency.complete(responseBody, 422)
      : Response.json(responseBody, { status: 422 });
  }

  return idempotency
    ? idempotency.complete(result, 201)
    : Response.json(result, { status: 201 });
}
