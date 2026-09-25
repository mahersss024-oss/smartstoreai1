'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';

const conversationAlertStorageKey = 'smartstore_conversation_alert';

type UseConversationMessageAlertOptions = {
  userId?: string | null;
};

export function useConversationMessageAlert({
  userId,
}: UseConversationMessageAlertOptions = {}) {
  const pathname = usePathname();
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [hasConversationAlert, setHasConversationAlert] = useState(false);
  const currentUserId = userId === undefined ? sessionUserId : userId;

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
        setHasConversationAlert(
          window.localStorage.getItem(conversationAlertStorageKey) === '1',
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  useSmartstoreRealtime({
    enabled:
      Boolean(currentUserId) &&
      !pathname.startsWith('/conversations') &&
      !pathname.startsWith('/admin') &&
      !pathname.startsWith('/api'),
    eventTypes: ['message_created'],
    onEvent: (event) => {
      if (
        event.type !== 'message_created' ||
        event.payload.status !== 'sent' ||
        event.payload.senderId === currentUserId ||
        pathname.startsWith('/conversations')
      ) {
        return;
      }

      window.localStorage.setItem(conversationAlertStorageKey, '1');
      setHasConversationAlert(true);
    },
  });

  return { hasConversationAlert };
}
