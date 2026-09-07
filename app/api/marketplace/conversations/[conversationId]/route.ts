import { z } from 'zod';

import {
  addConversationMessage,
  getConversationForUser,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

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

  return Response.json({ conversation });
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

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = sendMessageSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { conversationId } = await context.params;
  const idempotency = await reserveIdempotencyKey(request, {
    namespace: 'message_send',
    actorKey: `${session.user.id}:${conversationId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  const result = await addConversationMessage(
    conversationId,
    session.user,
    parsed.data.body,
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

  if (result.status === 'message_blocked') {
    const responseBody = {
      error: 'message_blocked',
      message:
        'Keep communication and payment arrangements inside SmartStore AI.',
      blockedMessage: result.message,
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
