import { z } from 'zod';

import {
  addConversationMessage,
  blockConversationUser,
  deleteConversationForUser,
  getConversationBlockStatus,
  getConversationForUser,
  markConversationReadForUser,
  reportConversationUser,
  shareSellerContact,
  unblockConversationUser,
} from '@/agent/marketplace/repository';
import { reserveIdempotencyKey } from '@/lib/api/idempotency';
import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';
import { notifyConversationMessage } from '@/lib/push/conversation-notifications';

export const dynamic = 'force-dynamic';

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});
const shareContactSchema = z.object({
  action: z.literal('share_contact'),
});
const reportUserSchema = z.object({
  action: z.literal('report_user'),
  reason: z.string().trim().min(2).max(120).default('conversation_report'),
  details: z.string().trim().max(1000).optional(),
});
const blockUserSchema = z.object({
  action: z.literal('block_user'),
  reason: z.string().trim().max(120).optional(),
});
const unblockUserSchema = z.object({
  action: z.literal('unblock_user'),
});
const conversationPostSchema = z.union([
  sendMessageSchema,
  shareContactSchema,
  reportUserSchema,
  blockUserSchema,
  unblockUserSchema,
]);
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
        message: 'Sign-in is required to view this conversation.',
      },
      { status: 401 },
    );
  }

  const { conversationId } = await context.params;
  await markConversationReadForUser(conversationId, session.user.id);
  const conversation = await getConversationForUser(conversationId, session.user.id);

  if (!conversation) {
    return Response.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  const blockStatus = await getConversationBlockStatus(
    conversationId,
    session.user.id,
  );

  return Response.json(
    { conversation, blockStatus },
    { headers: noStoreHeaders },
  );
}

export async function DELETE(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to delete conversations.',
      },
      { status: 401 },
    );
  }

  const { conversationId } = await context.params;
  const result = await deleteConversationForUser(conversationId, session.user.id);

  if (result.status === 'not_found') {
    return Response.json({ error: 'conversation_not_found' }, { status: 404 });
  }

  return Response.json(
    {
      status: 'deleted',
      message: 'Conversation deleted successfully.',
    },
    { headers: noStoreHeaders },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json(
      {
        error: 'auth_required',
        message: 'Sign-in is required to send messages.',
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
      action === 'share_contact'
        ? 'seller_contact_share'
        : action === 'report_user'
          ? 'conversation_user_report'
          : action === 'block_user'
            ? 'conversation_user_block'
            : action === 'unblock_user'
              ? 'conversation_user_unblock'
              : 'message_send',
    actorKey: `${session.user.id}:${conversationId}`,
  });

  if (idempotency?.response) {
    return idempotency.response;
  }

  let result:
    | Awaited<ReturnType<typeof shareSellerContact>>
    | Awaited<ReturnType<typeof reportConversationUser>>
    | Awaited<ReturnType<typeof blockConversationUser>>
    | Awaited<ReturnType<typeof unblockConversationUser>>
    | Awaited<ReturnType<typeof addConversationMessage>>;

  if ('body' in parsed.data) {
    result = await addConversationMessage(
      conversationId,
      session.user,
      messageBody,
    );
  } else if (parsed.data.action === 'share_contact') {
    result = await shareSellerContact(conversationId, session.user);
  } else if (parsed.data.action === 'report_user') {
    result = await reportConversationUser(conversationId, session.user, {
      reason: parsed.data.reason,
      details: parsed.data.details,
    });
  } else if (parsed.data.action === 'block_user') {
    result = await blockConversationUser(
      conversationId,
      session.user,
      parsed.data.reason,
    );
  } else {
    result = await unblockConversationUser(conversationId, session.user);
  }

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

  if (result.status === 'conversation_blocked') {
    const responseBody = {
      error: 'conversation_blocked',
      message: 'This conversation is blocked.',
      conversation: result.conversation,
      blockStatus: result.blockStatus,
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

  if (result.status === 'already_reported') {
    const responseBody = {
      error: 'already_reported',
      message: 'You already have an open report on this conversation.',
      report: result.report,
      conversation: result.conversation,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'blocked') {
    const responseBody = {
      ...result,
      blockStatus: {
        blocked: true,
        blockedByMe: true,
        blockerId: session.user.id,
        blockedUserId: result.block?.blockedId,
      },
    };

    return idempotency
      ? idempotency.complete(responseBody, 201)
      : Response.json(responseBody, { status: 201 });
  }

  if (result.status === 'not_blocked') {
    const responseBody = {
      error: 'conversation_not_blocked_by_user',
      message: 'This conversation is not blocked by the current user.',
      conversation: result.conversation,
      blockStatus: result.blockStatus,
    };

    return idempotency
      ? idempotency.complete(responseBody, 409)
      : Response.json(responseBody, { status: 409 });
  }

  if (result.status === 'unblocked') {
    const responseBody = {
      ...result,
      blockStatus: result.blockStatus ?? {
        blocked: false,
        blockedByMe: false,
      },
    };

    return idempotency
      ? idempotency.complete(responseBody, 200)
      : Response.json(responseBody, { status: 200 });
  }

  if (
    'body' in parsed.data &&
    result.status === 'sent' &&
    result.conversation &&
    result.message
  ) {
    await notifyConversationMessage({
      conversation: result.conversation,
      message: result.message,
      senderName: session.user.name,
    }).catch((error) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[push_notifications] message_notify_failed=${errorName}`);
    });
  }

  return idempotency
    ? idempotency.complete(result, 201)
    : Response.json(result, { status: 201 });
}
