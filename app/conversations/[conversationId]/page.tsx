'use client';
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  MessageCircle,
  Send,
  ShieldCheck,
  Store,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import { Textarea } from '@ui/textarea';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

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

type ConversationMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  status: 'sent' | 'blocked';
  reasons: string[];
  createdAt: string;
};

type ConversationListing = {
  id: string;
  title?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  category: string;
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
  messages: ConversationMessage[];
  updatedAt: string;
  listing: ConversationListing | null;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22675%22 viewBox=%220 0 900 675%22%3E%3Crect width=%22900%22 height=%22675%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M382 291h136a28 28 0 0 1 28 28v95a28 28 0 0 1-28 28H382a28 28 0 0 1-28-28v-95a28 28 0 0 1 28-28z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22/%3E%3Ccircle cx=%22417%22 cy=%22342%22 r=%2220%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m382 414 53-55 43 43 25-27 43 39%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22450%22 y=%22492%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';

const conversationRefreshIntervalMs = 3000;

function pickLatestConversation(
  current: ConversationRecord | null,
  incoming: ConversationRecord,
) {
  if (current?.id !== incoming.id) {
    return incoming;
  }

  const currentTimestamp = Date.parse(current.updatedAt);
  const incomingTimestamp = Date.parse(incoming.updatedAt);

  if (
    Number.isFinite(currentTimestamp) &&
    Number.isFinite(incomingTimestamp) &&
    incomingTimestamp < currentTimestamp
  ) {
    return current;
  }

  return incoming;
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

function getListingImage(listing: ConversationListing | null) {
  const image = listing?.images?.[0];

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    missingListingImageDataUrl
  );
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  }).format(new Date(value));
}

export default function ConversationPage() {
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [conversation, setConversation] = useState<ConversationRecord | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);

  const isSeller = session.user?.id === conversation?.sellerId;
  const roleLabel = isSeller ? 'أنت البائع' : 'أنت المشتري';
  const visibleMessages = useMemo(
    () => conversation?.messages ?? [],
    [conversation?.messages],
  );

  const refreshConversation = useCallback(async (
    options?: { showLoading?: boolean; clearNotice?: boolean },
  ) => {
    const showLoading = options?.showLoading ?? true;
    const clearNotice = options?.clearNotice ?? true;

    if (showLoading) {
      setIsLoading(true);
    }

    if (clearNotice) {
      setNotice('');
    }

    try {
      const [sessionResponse, conversationResponse] = await Promise.all([
        fetch('/api/auth/session', { cache: 'no-store' }),
        fetch(`/api/marketplace/conversations/${conversationId}`, {
          cache: 'no-store',
        }),
      ]);

      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (conversationResponse.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!conversationResponse.ok) {
        setNotice('تعذر العثور على هذه المحادثة أو ليس لديك صلاحية لعرضها.');
        setConversation(null);
        return;
      }

      const payload = (await conversationResponse.json()) as {
        conversation: ConversationRecord;
      };
      setConversation((currentConversation) =>
        pickLatestConversation(currentConversation, payload.conversation),
      );
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [conversationId, router]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshConversation();

    const intervalId = window.setInterval(() => {
      void refreshConversation({ showLoading: false, clearNotice: false });
    }, conversationRefreshIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshConversation]);

  const sendConversationMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!draft.trim() || isSending) {
        return;
      }

      setIsSending(true);
      setNotice('');

      try {
        const response = await fetch(
          `/api/marketplace/conversations/${conversationId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': createClientIdempotencyKey('message-send'),
            },
            body: JSON.stringify({ body: draft }),
          },
        );
        const payload = (await response.json()) as {
          conversation?: ConversationRecord;
          error?: string;
        };

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (response.status === 422) {
          setNotice(
            'تم حظر الرسالة. استخدم الشات لترتيب المعاينة وتجنب مشاركة طرق دفع أو تحويل خارج المنصة.',
          );
          if (payload.conversation) {
            setConversation((currentConversation) =>
              pickLatestConversation(
                currentConversation,
                payload.conversation as ConversationRecord,
              ),
            );
          }
          return;
        }

        if (!response.ok || !payload.conversation) {
          setNotice('تعذر إرسال الرسالة الآن.');
          return;
        }

        setDraft('');
        setConversation((currentConversation) =>
          pickLatestConversation(
            currentConversation,
            payload.conversation as ConversationRecord,
          ),
        );
        void refreshConversation({ showLoading: false, clearNotice: false });
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, draft, isSending, refreshConversation, router],
  );

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/conversations">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">محادثة SmartStore AI</h1>
              <p className="truncate text-xs text-muted-foreground">
                تواصل داخلي آمن بين البائع والمشتري
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle language="ar" />
            <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
              <Link href="/conversations">
                <MessageCircle className="size-4" />
                محادثاتي
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="flex min-h-[36rem] flex-col overflow-hidden rounded-md border bg-white shadow-sm dark:bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid size-9 place-items-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <Bot className="size-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold">
                    {conversation?.listing?.title ?? 'محادثة إعلان'}
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {session.authenticated ? roleLabel : 'يتطلب تسجيل Google'}
                  </p>
                </div>
              </div>
              <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                {conversation?.status === 'open' ? 'مفتوحة' : 'مغلقة'}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f9fc] p-4 dark:bg-background">
              {isLoading ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  جار تحميل المحادثة...
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div className="grid max-w-xs gap-3">
                    <MessageCircle className="mx-auto size-10 text-blue-600" />
                    <h3 className="text-base font-bold">ابدأ المحادثة</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      اكتب رسالتك داخل المنصة، وسيبقى سجل التواصل مرتبطًا بالإعلان.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3">
                  {visibleMessages.map((message) => {
                    const mine = message.senderId === session.user?.id;

                    return (
                      <div
                        key={message.id}
                        className={`grid max-w-[78%] gap-1 ${mine ? 'justify-self-start text-right' : 'justify-self-end text-right'}`}
                      >
                        <div
                          className={`rounded-md border px-3 py-2 text-sm leading-7 shadow-sm ${
                            mine
                              ? 'bg-blue-600 text-white'
                              : 'bg-white text-foreground dark:bg-card'
                          } ${message.status === 'blocked' ? 'border-destructive bg-destructive/10 text-destructive' : ''}`}
                        >
                          {message.body}
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {message.status === 'blocked'
                            ? 'محجوبة'
                            : formatMessageTime(message.createdAt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {notice && (
              <div className="border-t bg-amber-50 px-4 py-2 text-sm leading-7 text-amber-900 dark:bg-amber-400/10 dark:text-amber-100">
                {notice}
              </div>
            )}

            <form className="grid gap-2 border-t p-3" onSubmit={sendConversationMessage}>
              <Textarea
                className="min-h-20 resize-none"
                disabled={conversation?.status !== 'open'}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="اكتب رسالتك هنا..."
                value={draft}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4 text-blue-600" />
                  التواصل والدفع داخل SmartStore AI
                </div>
                <Button
                  className="rounded-md bg-blue-600 hover:bg-blue-700"
                  disabled={!draft.trim() || isSending || !conversation}
                  type="submit"
                >
                  <Send className="size-4" />
                  إرسال
                </Button>
              </div>
            </form>
          </section>

          <aside className="grid h-fit gap-4 rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <img
              alt={conversation?.listing?.title ?? 'صورة الإعلان'}
              className="aspect-square w-full rounded-md object-cover"
              src={getListingImage(conversation?.listing ?? null)}
            />
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Store className="size-4" />
                الإعلان
              </div>
              <h2 className="text-lg font-bold leading-7">
                {conversation?.listing?.title ?? 'إعلان غير متاح'}
              </h2>
              <p className="mt-2 text-xl font-bold text-blue-700">
                {formatPrice(conversation?.listing?.price)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {conversation?.listing?.city ?? 'السعودية'}
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-md border bg-blue-50 p-3 text-xs leading-6 text-blue-950 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-50">
              <BadgeCheck className="mt-1 size-4 shrink-0 text-blue-600 dark:text-blue-200" />
              <span>
                المحادثة مرتبطة بهذا الإعلان فقط، ولا تظهر إلا للبائع والمشتري.
              </span>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
