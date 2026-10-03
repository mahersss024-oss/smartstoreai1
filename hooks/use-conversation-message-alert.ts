'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useAuthSession } from '@/hooks/use-auth-session';
import { scheduleIdleTask } from '@/lib/client-idle-task';

const conversationAlertStorageKey = 'smartstore_conversation_alert';
const unreadConversationSyncIdleTimeoutMs = 2500;

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
  const { session } = useAuthSession();
  const [hasConversationAlert, setHasConversationAlert] = useState(false);
  const isUserIdControlled = userId !== undefined;
  const currentUserId = userId === undefined ? (session.user?.id ?? null) : userId;

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

    const cancelIdleSync = scheduleIdleTask(() => {
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
    }, unreadConversationSyncIdleTimeoutMs);

    return () => {
      cancelled = true;
      cancelIdleSync();
    };
  }, [currentUserId, isUserIdControlled, pathname, syncUnreadConversations]);

  useEffect(() => {
    if (!currentUserId || pathname.startsWith('/conversations')) {
      return;
    }

    let cancelPendingSync = () => {};

    const queueUnreadSync = () => {
      cancelPendingSync();
      cancelPendingSync = scheduleIdleTask(() => {
        void syncUnreadConversations();
      }, unreadConversationSyncIdleTimeoutMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        queueUnreadSync();
      }
    };

    window.addEventListener('focus', queueUnreadSync);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelPendingSync();
      window.removeEventListener('focus', queueUnreadSync);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUserId, pathname, syncUnreadConversations]);

  return { hasConversationAlert };
}
