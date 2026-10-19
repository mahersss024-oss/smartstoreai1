import { resetIncompleteSellerDrafts } from '@/agent/marketplace/repository';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { getAuthSession } from '@/lib/auth/session';
import { parseChatConversationId } from '@/lib/chat/conversation';

export async function POST(request: Request) {
  const session = getAuthSession(request);
  const requestedOwner = request.headers.get('x-chat-owner-id');
  if (requestedOwner !== null && requestedOwner !== session?.user.id) {
    return new Response('تغيّر حساب الدخول. حدّث الصفحة لبدء محادثة تخص حسابك الحالي.', { status: 409 });
  }
  const conversationHeader = request.headers.get('x-chat-conversation-id');
  const conversationId = parseChatConversationId(conversationHeader);
  if (conversationHeader !== null && !conversationId) {
    return new Response('معرّف المحادثة غير صالح.', { status: 400 });
  }
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'chat_reset',
    actorId: session?.user.id,
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (session) {
    await resetIncompleteSellerDrafts(session.user.id);
  }

  return Response.json(
    { status: 'reset' },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
