'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  MessageCircle,
  MoreVertical,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAuthProviderVisibility } from '@/hooks/use-auth-provider-visibility';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import {
  readClientPageCache,
  writeClientPageCache,
} from '@/lib/client-page-cache';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui/dropdown-menu';

type ConversationListing = {
  id: string;
  title?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  images?: Array<{
    displayUrl?: string;
    originalUrl?: string;
    thumbnailUrl?: string;
  }>;
};

type ConversationRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  status: 'open' | 'closed' | 'reported';
  messages: Array<{
    id: string;
    body: string;
    senderId: string;
    status: 'sent' | 'blocked';
    metadata?: Record<string, unknown>;
    createdAt: string;
  }>;
  updatedAt: string;
  listing: ConversationListing | null;
  seller?: ConversationParticipant;
  buyer?: ConversationParticipant;
};

type ConversationParticipant = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  lastActiveAt?: string;
  deletedAt?: string;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

type ConversationsCachePayload = {
  conversations: ConversationRecord[];
  pagination?: PaginationMeta | null;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return new Intl.DateTimeFormat('ar-SA', sameDay
    ? {
        hour: '2-digit',
        minute: '2-digit',
      }
    : {
        day: 'numeric',
        month: 'short',
      }).format(date);
}

function getParticipantFallbackName(participantId?: string | null) {
  if (!participantId) {
    return 'عميل سوق حمد';
  }

  if (participantId.startsWith('google:') || participantId.startsWith('apple:')) {
    return 'عميل سوق حمد';
  }

  return participantId;
}

function getParticipantDisplayName(participant?: ConversationParticipant | null) {
  return (
    participant?.name?.trim() ||
    participant?.email?.trim() ||
    getParticipantFallbackName(participant?.id)
  );
}

function getParticipantInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'ح';
}

function isMessageReadBy(
  message: ConversationRecord['messages'][number],
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

function getConversationsCacheKey(userId: string) {
  return `smartstore:page-cache:v1:conversations:${userId}`;
}

export default function ConversationsPage() {
  const { isSessionLoading, session } = useAuthSession();
  const authProviders = useAuthProviderVisibility();
  const sessionUserId = session.user?.id;
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [conversationsPagination, setConversationsPagination] =
    useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [conversationNotice, setConversationNotice] = useState<{
    tone: 'success' | 'danger';
    message: string;
  } | null>(null);
  const [pendingConversationDelete, setPendingConversationDelete] =
    useState<ConversationRecord | null>(null);
  const trackedListingIds = useMemo(
    () => new Set(conversations.map((conversation) => conversation.listingId)),
    [conversations],
  );

  const refreshConversations = useCallback(async (
    page = 1,
    options?: { showLoading?: boolean },
  ) => {
    const showLoading = options?.showLoading ?? true;

    if (showLoading) {
      setIsLoading(true);
    }

    try {
      if (!session.authenticated) {
        setConversations([]);
        setConversationsPagination(null);
        return;
      }

      const conversationsResponse = await fetch(
        `/api/marketplace/me/conversations?page=${page}&limit=20`,
        {
          cache: 'no-store',
        },
      );

      if (!conversationsResponse.ok) {
        if (showLoading) {
          setConversations([]);
          setConversationsPagination(null);
        }
        return;
      }

      const payload = (await conversationsResponse.json()) as {
        conversations?: ConversationRecord[];
        pagination?: PaginationMeta;
      };
      setConversations((currentConversations) =>
        page === 1
          ? (payload.conversations ?? [])
          : [...currentConversations, ...(payload.conversations ?? [])],
      );
      setConversationsPagination(payload.pagination ?? null);

      if (page === 1 && sessionUserId) {
        writeClientPageCache<ConversationsCachePayload>(
          getConversationsCacheKey(sessionUserId),
          {
            conversations: payload.conversations ?? [],
            pagination: payload.pagination ?? null,
          },
        );
      }
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [session.authenticated, sessionUserId]);

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshConversations(1, { showLoading: false });
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshConversations]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    if (isSessionLoading) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        if (session.authenticated) {
          const cachedPayload = sessionUserId
            ? readClientPageCache<ConversationsCachePayload>(
                getConversationsCacheKey(sessionUserId),
              )
            : null;

          if (cachedPayload) {
            setConversations(cachedPayload.conversations ?? []);
            setConversationsPagination(cachedPayload.pagination ?? null);
            setIsLoading(false);
          }

          void refreshConversations(1, { showLoading: !cachedPayload });
          return;
        }

        setConversations([]);
        setConversationsPagination(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    isSessionLoading,
    refreshConversations,
    session.authenticated,
    sessionUserId,
  ]);

  useSmartstoreRealtime({
    enabled: session.authenticated,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'message_created',
      'conversation_updated',
      'ad_status_changed',
      'ad_deleted',
      'maintenance_cleanup',
    ],
    onEvent: (event) => {
      if (
        event.type === 'message_created' ||
        event.type === 'conversation_updated'
      ) {
        void refreshConversations(1, { showLoading: false });
        return;
      }

      if (
        (event.type === 'ad_status_changed' || event.type === 'ad_deleted') &&
        trackedListingIds.has(event.payload.listingId)
      ) {
        void refreshConversations(1, { showLoading: false });
        return;
      }

      if (event.type === 'maintenance_cleanup') {
        void refreshConversations(1, { showLoading: false });
      }
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return refreshConversations(1, { showLoading: false });
    },
  });

  const conversationsLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(conversationsPagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void refreshConversations(conversationsPagination?.nextPage ?? 1);
    },
  });

  const deleteConversation = useCallback(async (conversation: ConversationRecord) => {
    setPendingConversationDelete(null);
    setDeletingConversationId(conversation.id);
    setConversationNotice(null);

    try {
      const response = await fetch(
        `/api/marketplace/conversations/${conversation.id}`,
        {
          method: 'DELETE',
          headers: {
            'Idempotency-Key': `conversation-delete-${conversation.id}`,
          },
        },
      );

      if (!response.ok) {
        setConversationNotice({
          tone: 'danger',
          message: 'تعذر حذف المحادثة. حاول مرة أخرى.',
        });
        return;
      }

      setConversations((currentConversations) =>
        currentConversations.filter(
          (currentConversation) => currentConversation.id !== conversation.id,
        ),
      );
      setConversationNotice({
        tone: 'success',
        message: 'تم حذف المحادثة بنجاح.',
      });
      void refreshConversations(1, { showLoading: false });
    } catch {
      setConversationNotice({
        tone: 'danger',
        message: 'تعذر حذف المحادثة. حاول مرة أخرى.',
      });
    } finally {
      setDeletingConversationId(null);
    }
  }, [refreshConversations]);

  return (
    <main className="smartstore-stable-page min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        message={conversationNotice?.message}
        onDismiss={() => setConversationNotice(null)}
        open={Boolean(conversationNotice)}
        tone={conversationNotice?.tone ?? 'info'}
      />
      <ActionConfirmDialog
        confirmLabel="حذف المحادثة"
        description="سيتم حذف هذه المحادثة من قائمتك."
        loading={Boolean(
          pendingConversationDelete &&
            deletingConversationId === pendingConversationDelete.id,
        )}
        loadingText="جاري الحذف..."
        onCancel={() => setPendingConversationDelete(null)}
        onConfirm={() => {
          if (pendingConversationDelete) {
            void deleteConversation(pendingConversationDelete);
          }
        }}
        open={Boolean(pendingConversationDelete)}
        title="تأكيد حذف المحادثة"
        tone="danger"
      />
      <div className="smartstore-stable-content mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="smartstore-stable-header flex flex-wrap items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white dark:bg-card">
              <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.jpeg" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">محادثاتي</h1>
            </div>
          </div>
        </header>

        {(isSessionLoading || isLoading) && !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <ShieldCheck className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <ShieldCheck className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض محادثاتك</h2>
              </div>
              {authProviders.google ? (
                <Button asChild className="justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                  <a href="/api/auth/google/start">
                    <GoogleMark className="size-5" />
                    دخول Google
                  </a>
                </Button>
              ) : null}
              {authProviders.apple ? (
                <Button asChild className="justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                  <a href="/api/auth/apple/start">
                    <AppleMark className="size-5" />
                    دخول Apple
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <>
<section className="bg-white p-1 dark:bg-card sm:p-2">

              {isLoading && conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  جار تحميل المحادثات...
                </div>
              ) : conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                  <div className="grid max-w-sm gap-3">
                    <MessageCircle className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد محادثات بعد</h3>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    {conversations.map((conversation) => {
                    const lastMessage = [...conversation.messages]
                      .reverse()
                      .find((message) => message.status === 'sent');
                    const otherParticipant =
                      session.user?.id === conversation.sellerId
                        ? conversation.buyer
                        : conversation.seller;
                    const otherParticipantId =
                      session.user?.id === conversation.sellerId
                        ? conversation.buyerId
                        : conversation.sellerId;
                    const otherParticipantName =
                      getParticipantDisplayName(otherParticipant) ||
                      getParticipantFallbackName(otherParticipantId);
                    const hasUnreadMessages = conversation.messages.some(
                      (message) =>
                        message.status === 'sent' &&
                        message.senderId !== session.user?.id &&
                        !isMessageReadBy(message, session.user?.id),
                    );

                    return (
                      <div
                        key={conversation.id}
                        className={`grid grid-cols-[minmax(0,1fr)_2rem] overflow-hidden border-b bg-white transition hover:bg-blue-50/60 dark:bg-card dark:hover:bg-blue-400/10 ${
                          hasUnreadMessages
                            ? 'border-rose-300 shadow-rose-950/10 dark:border-rose-400/40'
                            : ''
                        }`}
                      >
                        <Link
                          className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:px-3"
                          href={`/conversations/${conversation.id}`}
                          prefetch={false}
                        >
                          <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 shadow-sm dark:border-blue-300/20 dark:bg-blue-400/10 dark:text-blue-100 sm:size-11">
                            {otherParticipant?.picture ? (
                              <SellerAvatar
                                alt={otherParticipantName}
                                picture={otherParticipant.picture}
                              />
                            ) : (
                              <span>{getParticipantInitial(otherParticipantName)}</span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <h3 className="truncate text-sm font-bold">
                                {otherParticipantName}
                              </h3>
                            </div>
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {lastMessage?.body ?? 'لم تبدأ الرسائل بعد'}
                            </p>
                          </div>
                          <div className="grid justify-items-end gap-1.5 text-left">
                            <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                              {formatUpdatedAt(conversation.updatedAt)}
                            </span>
                            {hasUnreadMessages && (
                              <span className="size-2.5 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.65)]" />
                            )}
                          </div>
                        </Link>
                        <div className="grid place-items-center border-r">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label="خيارات المحادثة"
                                className="size-7 rounded-md"
                                disabled={deletingConversationId === conversation.id}
                                size="icon-sm"
                                variant="ghost"
                              >
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-40">
                              <DropdownMenuItem asChild>
                                <Link href={`/conversations/${conversation.id}`} prefetch={false}>
                                  <MessageCircle className="size-4" />
                                  فتح المحادثة
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={deletingConversationId === conversation.id}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  setPendingConversationDelete(conversation);
                                }}
                              >
                                <Trash2 className="size-4" />
                                حذف المحادثة
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                  <div ref={conversationsLoadMoreRef} className="h-px" />
                  {conversationsPagination?.hasMore && (
                    <Button
                      variant="outline"
                      className="mx-auto rounded-md"
                      disabled={isLoading}
                      onClick={() =>
                        void refreshConversations(
                          conversationsPagination.nextPage ?? 1,
                        )
                      }
                    >
                      {isLoading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
                    </Button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
