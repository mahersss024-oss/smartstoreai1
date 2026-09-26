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
  User,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui/dropdown-menu';

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
};

type AuthSessionPayload = {
  authenticated: boolean;
  user: AuthUser | null;
};

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
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
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

export default function ConversationsPage() {
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [conversationsPagination, setConversationsPagination] =
    useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null);
  const [conversationNotice, setConversationNotice] = useState<{
    tone: 'success' | 'danger';
    message: string;
  } | null>(null);
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
      const sessionResponse = await fetch('/api/auth/session', {
        cache: 'no-store',
      });
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (!nextSession.authenticated) {
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
        setConversations([]);
        setConversationsPagination(null);
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
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

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

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshConversations(1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

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
    if (!window.confirm('هل أنت متأكد من حذف هذه المحادثة؟')) {
      return;
    }

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
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/40 px-1 py-3 dark:border-white/10">
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
          <div className="flex items-center gap-2">
            <ThemeToggle language="ar" />
            <Button asChild className="hidden rounded-md bg-blue-600 hover:bg-blue-700 sm:inline-flex">
              <Link href="/account">
                <User className="size-4" />
                حسابي
              </Link>
            </Button>
          </div>
        </header>

        {isLoading && !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <ShieldCheck className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  نتحقق من جلسة الدخول قبل عرض محادثاتك.
                </p>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <ShieldCheck className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض محادثاتك</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  المحادثات تظهر فقط للأطراف المرتبطة بالإعلان.
                </p>
              </div>
              <Button asChild className="justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                <a href="/api/auth/google/start">
                  <GoogleMark className="size-5" />
                  دخول Google
                </a>
              </Button>
              <Button asChild className="justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                <a href="/api/auth/apple/start">
                  <AppleMark className="size-5" />
                  دخول Apple
                </a>
              </Button>
            </div>
          </section>
        ) : (
          <>
<section className="bg-white p-1 dark:bg-card sm:p-2">
{conversationNotice && (
                <div
                  className={`mb-3 rounded-md border px-3 py-2 text-xs font-semibold ${
                    conversationNotice.tone === 'success'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-300/30 dark:bg-emerald-400/10 dark:text-emerald-100'
                      : 'border-red-300 bg-red-50 text-red-800 dark:border-red-300/30 dark:bg-red-400/10 dark:text-red-100'
                  }`}
                >
                  {conversationNotice.message}
                </div>
              )}

              {isLoading && conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  جار تحميل المحادثات...
                </div>
              ) : conversations.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                  <div className="grid max-w-sm gap-3">
                    <MessageCircle className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد محادثات بعد</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      عندما يتواصل مشتري مع بائع أو تضغط على تواصل داخل إعلان، ستظهر المحادثة هنا.
                    </p>
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
                        className={`grid grid-cols-[minmax(0,1fr)_2.25rem] overflow-hidden border-b bg-white transition hover:bg-blue-50/60 dark:bg-card dark:hover:bg-blue-400/10 ${
                          hasUnreadMessages
                            ? 'border-rose-300 shadow-rose-950/10 dark:border-rose-400/40'
                            : ''
                        }`}
                      >
                        <Link
                          className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
                          href={`/conversations/${conversation.id}`}
                        >
                          <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 shadow-sm dark:border-blue-300/20 dark:bg-blue-400/10 dark:text-blue-100">
                            {otherParticipant?.picture ? (
                              <img
                                alt=""
                                className="h-full w-full object-cover"
                                decoding="async"
                                loading="lazy"
                                src={otherParticipant.picture}
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
                            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                              {lastMessage?.body ?? 'لم تبدأ الرسائل بعد'}
                            </p>
                          </div>
                          <div className="grid justify-items-end gap-2 text-left">
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
                                className="size-8 rounded-md"
                                disabled={deletingConversationId === conversation.id}
                                size="icon-sm"
                                variant="ghost"
                              >
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-40">
                              <DropdownMenuItem asChild>
                                <Link href={`/conversations/${conversation.id}`}>
                                  <MessageCircle className="size-4" />
                                  فتح المحادثة
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={deletingConversationId === conversation.id}
                                onSelect={(event) => {
                                  event.preventDefault();
                                  void deleteConversation(conversation);
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
