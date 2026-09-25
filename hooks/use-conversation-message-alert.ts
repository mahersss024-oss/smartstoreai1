'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';

const conversationAlertStorageKey = 'smartstore_conversation_alert';

type UseConversationMessageAlertOptions = {
  userId?: string | null;
};

type ConversationMessageAlertRecord = {
  senderId: string;
  status: 'sent' | 'blocked';
  metadata?: Record<string, unknown>;
};

function isMessageReadBy(
  message: ConversationMessageAlertRecord,
  userId?: string | null,
) {
  if (!userId) {
    return false;
  }

  const readBy = message.metadata?.readBy;

  return (
    typeof readBy === 'object' &&
    readBy !== null &&
    !Array.isArray(readBy) &&
    typeof (readBy as Record<string, unknown>)[userId] === 'string'
  );
}

export function useConversationMessageAlert({
  userId,
}: UseConversationMessageAlertOptions = {}) {
  const pathname = usePathname();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [hasConversationAlert, setHasConversationAlert] = useState(false);
  const isUserIdControlled = userId !== undefined;
  const currentUserId = userId === undefined ? sessionUserId : userId;

  const syncUnreadConversations = useCallback(async () => {
    if (!currentUserId || pathname.startsWith('/conversations')) {
      return;
    }

    try {
      const response = await fetch('/api/marketplace/me/conversations?page=1&limit=48', {
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        conversations?: Array<{
          messages?: ConversationMessageAlertRecord[];
        }>;
      };
      const hasUnread = Boolean(
        payload.conversations?.some((conversation) =>
          conversation.messages?.some(
            (message) =>
              message.status === 'sent' &&
              message.senderId !== currentUserId &&
              !isMessageReadBy(message, currentUserId),
          ),
        ),
      );

      if (hasUnread) {
        window.localStorage.setItem(conversationAlertStorageKey, '1');
      } else {
        window.localStorage.removeItem(conversationAlertStorageKey);
      }

      setHasConversationAlert(hasUnread);
    } catch {
      // Keep the current visual state if the unread sync is temporarily unavailable.
    }
  }, [currentUserId, pathname]);

  useEffect(() => {
    if (userId !== undefined) {
      return;
    }

    let cancelled = false;

    async function syncSession() {
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          authenticated?: boolean;
          user?: { id?: string } | null;
        };

        if (!cancelled) {
          setSessionUserId(
            payload.authenticated && payload.user?.id ? payload.user.id : null,
          );
        }
      } catch {
        if (!cancelled) {
          setSessionUserId(null);
        }
      }
    }

    void syncSession();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    if (pathname.startsWith('/conversations')) {
      window.localStorage.removeItem(conversationAlertStorageKey);
      queueMicrotask(() => {
        if (!cancelled) {
          setHasConversationAlert(false);
        }
      });

      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        if (currentUserId) {
          void syncUnreadConversations();
          return;
        }

        if (isUserIdControlled) {
          setHasConversationAlert(false);
          return;
        }

        setHasConversationAlert(
          window.localStorage.getItem(conversationAlertStorageKey) === '1',
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [currentUserId, isUserIdControlled, pathname, syncUnreadConversations]);

  useSmartstoreRealtime({
    enabled:
      Boolean(currentUserId) &&
      !pathname.startsWith('/conversations') &&
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/api'),
    eventTypes: ['message_created', 'conversation_updated'],
    onEvent: (event) => {
      if (pathname.startsWith('/conversations')) {
        return;
      }

      if (event.type === 'conversation_updated') {
        void syncUnreadConversations();
        return;
      }

      if (
        event.type === 'message_created' &&
        event.payload.status === 'sent' &&
        event.payload.senderId !== currentUserId
      ) {
        window.localStorage.setItem(conversationAlertStorageKey, '1');
        setHasConversationAlert(true);
      }
    },
  });

  return { hasConversationAlert };
}
