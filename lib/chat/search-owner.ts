import { createHash } from 'node:crypto';

import type { AuthSession } from '@/lib/auth/session';
import { scopeChatSearchOwnerKey } from './conversation';

function getClientId(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstForwardedIp = forwardedFor?.split(',')[0]?.trim();

  return (
    firstForwardedIp ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'anonymous'
  );
}

export function getChatSearchOwnerKey(
  session: AuthSession | null,
  request: Request,
  conversationId?: string,
) {
  if (session) {
    return scopeChatSearchOwnerKey(`user:${session.user.id}`, conversationId);
  }

  return scopeChatSearchOwnerKey(`anon:${createHash('sha256')
    .update(getClientId(request))
    .digest('hex')
    .slice(0, 32)}`, conversationId);
}
