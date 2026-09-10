'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  MessageCircle,
  ShieldCheck,
  User,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';

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
    createdAt: string;
  }>;
  updatedAt: string;
  listing: ConversationListing | null;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22675%22 viewBox=%220 0 900 675%22%3E%3Crect width=%22900%22 height=%22675%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M382 291h136a28 28 0 0 1 28 28v95a28 28 0 0 1-28 28H382a28 28 0 0 1-28-28v-95a28 28 0 0 1 28-28z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22/%3E%3Ccircle cx=%22417%22 cy=%22342%22 r=%2220%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m382 414 53-55 43 43 25-27 43 39%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22450%22 y=%22492%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';

function getListingImage(listing: ConversationListing | null) {
  const image = listing?.images?.[0];

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    missingListingImageDataUrl
  );
}

function formatPrice(price: ConversationListing['price']) {
  if (typeof price === 'number') {
    return `${new Intl.NumberFormat('ar-SA').format(price)} ر.س`;
  }

  if (price === 'bid') {
    return 'على السوم';
  }

  if (price === 'negotiable') {
    return 'قابل للتفاوض';
  }

  return 'السعر غير محدد';
}

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
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

  const conversationsCount = conversations.length;
  const openConversationsCount = useMemo(
    () =>
      conversations.filter((conversation) => conversation.status === 'open')
        .length,
    [conversations],
  );
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
      const [sessionResponse, conversationsResponse] = await Promise.all([
        fetch('/api/auth/session', { cache: 'no-store' }),
        fetch(`/api/marketplace/me/conversations?page=${page}&limit=20`, {
          cache: 'no-store',
        }),
      ]);
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (!conversationsResponse.ok) {
        setConversations([]);
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
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshConversations(1);
  }, [refreshConversations]);

  useSmartstoreRealtime({
    enabled: true,
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

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">محادثاتي</h1>
              <p className="truncate text-xs text-muted-foreground">
                محادثات البيع والشراء داخل SmartStore AI
              </p>
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

        {!session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <ShieldCheck className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض محادثاتك</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  المحادثات تظهر فقط للأطراف المرتبطة بالإعلان.
                </p>
              </div>
              <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                <a href="/api/auth/google/start">
                  <User className="size-4" />
                  دخول Google
                </a>
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                <div className="text-xs text-muted-foreground">إجمالي المحادثات</div>
                <div className="mt-1 text-2xl font-bold">{conversationsCount}</div>
              </div>
              <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                <div className="text-xs text-muted-foreground">المحادثات المفتوحة</div>
                <div className="mt-1 text-2xl font-bold">{openConversationsCount}</div>
              </div>
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold">
                <MessageCircle className="size-4 text-blue-600" />
                قائمة المحادثات
              </div>

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
                  <div className="grid gap-3">
                    {conversations.map((conversation) => {
                    const lastMessage = [...conversation.messages]
                      .reverse()
                      .find((message) => message.status === 'sent');
                    const isSeller = session.user?.id === conversation.sellerId;

                    return (
                      <Link
                        key={conversation.id}
                        className="grid gap-3 rounded-md border p-3 transition hover:border-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-400/10 md:grid-cols-[5rem_1fr_auto]"
                        href={`/conversations/${conversation.id}`}
                      >
                        <img
                          alt={conversation.listing?.title ?? 'صورة الإعلان'}
                          className="aspect-square w-full rounded-md object-cover md:size-20"
                          src={getListingImage(conversation.listing)}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-bold">
                              {conversation.listing?.title ?? 'إعلان غير متاح'}
                            </h3>
                            <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                              {isSeller ? 'بائع' : 'مشتري'}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-sm text-muted-foreground">
                            {lastMessage?.body ?? 'لم تبدأ الرسائل بعد'}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{formatPrice(conversation.listing?.price)}</span>
                            <span>{conversation.listing?.city ?? 'السعودية'}</span>
                            <span>{formatUpdatedAt(conversation.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-200">
                          <BadgeCheck className="size-4" />
                          {conversation.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                        </div>
                      </Link>
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
