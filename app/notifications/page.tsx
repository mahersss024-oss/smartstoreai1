'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, CheckCheck, Trash2 } from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { PushNotificationSettings } from '@/components/push-notification-settings';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';

type FollowNotification = {
  id: string;
  listingId: string;
  sellerId: string;
  title?: string;
  body?: string;
  url: string;
  readAt?: string;
  createdAt: string;
};

type NotificationsPayload = {
  notifications: FollowNotification[];
  unreadCount: number;
};

const notificationsReadEventName = 'smartstore:notifications-read';
const notificationsChangedEventName = 'smartstore:notifications-changed';

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function NotificationsPage() {
  const { isSessionLoading, session } = useAuthSession();
  const [payload, setPayload] = useState<NotificationsPayload>({
    notifications: [],
    unreadCount: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(
    null,
  );
  const [isDeleteAllConfirmOpen, setIsDeleteAllConfirmOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const deletingNotificationRef = useRef<string | null>(null);
  const isDeletingAllRef = useRef(false);
  const [actionNotice, setActionNotice] = useState<{
    tone: 'success' | 'warning' | 'danger' | 'info';
    title?: string;
    message: string;
  } | null>(null);

  const refreshNotifications = useCallback(async () => {
    setIsLoading(true);

    try {
      if (!session.authenticated) {
        setPayload({ notifications: [], unreadCount: 0 });
        return;
      }

      const response = await fetch('/api/notifications', {
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      setPayload((await response.json()) as NotificationsPayload);
    } finally {
      setIsLoading(false);
    }
  }, [session.authenticated]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    if (isSessionLoading) {
      return;
    }

    void refreshNotifications();
  }, [isSessionLoading, refreshNotifications]);

  useSmartstoreRealtime({
    enabled: session.authenticated,
    fallbackIntervalMs: 5000,
    eventTypes: ['follow_listing_published', 'listing_notification_created'],
    onResync: refreshNotifications,
  });

  const markAllRead = useCallback(async () => {
    setIsMarkingRead(true);

    const readAt = new Date().toISOString();

    setPayload((currentPayload) => ({
      notifications: currentPayload.notifications.map((notification) => ({
        ...notification,
        readAt: notification.readAt ?? readAt,
      })),
      unreadCount: 0,
    }));
    window.dispatchEvent(new Event(notificationsReadEventName));

    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
      });

      if (response.ok) {
        await refreshNotifications();
      }
    } finally {
      setIsMarkingRead(false);
    }
  }, [refreshNotifications]);

  const deleteNotification = useCallback(
    async (notificationId: string) => {
      if (deletingNotificationRef.current || isDeletingAllRef.current) {
        return;
      }

      deletingNotificationRef.current = notificationId;
      setDeletingNotificationId(notificationId);
      setActionNotice(null);

      try {
        const response = await fetch(
          `/api/notifications?id=${encodeURIComponent(notificationId)}`,
          { method: 'DELETE' },
        );

        if (!response.ok) {
          setActionNotice({
            tone: 'danger',
            message: 'تعذر حذف الإشعار الآن. حاول مرة أخرى.',
          });
          return;
        }

        await refreshNotifications();
        window.dispatchEvent(new Event(notificationsChangedEventName));
        setActionNotice({
          tone: 'success',
          message: 'تم حذف الإشعار.',
        });
      } finally {
        deletingNotificationRef.current = null;
        setDeletingNotificationId(null);
      }
    },
    [refreshNotifications],
  );

  const deleteAllNotifications = useCallback(async () => {
    if (isDeletingAllRef.current || payload.notifications.length === 0) {
      return;
    }

    isDeletingAllRef.current = true;
    setIsDeletingAll(true);
    setActionNotice(null);

    try {
      const response = await fetch('/api/notifications', {
        method: 'DELETE',
      });

      if (!response.ok) {
        setActionNotice({
          tone: 'danger',
          message: 'تعذر حذف جميع الإشعارات الآن. حاول مرة أخرى.',
        });
        return;
      }

      setPayload({ notifications: [], unreadCount: 0 });
      window.dispatchEvent(new Event(notificationsChangedEventName));
      setActionNotice({
        tone: 'success',
        message: 'تم حذف جميع الإشعارات.',
      });
    } finally {
      isDeletingAllRef.current = false;
      setIsDeletingAll(false);
      setIsDeleteAllConfirmOpen(false);
    }
  }, [payload.notifications.length]);

  useEffect(() => {
    if (
      isSessionLoading ||
      isLoading ||
      !session.authenticated ||
      payload.unreadCount <= 0 ||
      isMarkingRead
    ) {
      return;
    }

    void markAllRead();
  }, [
    isLoading,
    isMarkingRead,
    isSessionLoading,
    markAllRead,
    payload.unreadCount,
    session.authenticated,
  ]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">الإشعارات</h1>
            </div>
          </div>
          {payload.unreadCount > 0 ? (
            <span className="rounded-full bg-rose-500 px-2.5 py-1 text-xs font-bold text-white">
              {payload.unreadCount}
            </span>
          ) : null}
        </header>

        {!isSessionLoading && !session.authenticated ? (
          <section className="grid min-h-[28rem] place-items-center p-6 text-center">
            <div className="grid max-w-sm gap-3">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <Bell className="size-7" />
              </div>
              <h2 className="text-lg font-bold">سجل الدخول لعرض الإشعارات</h2>
              <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                <a href="/api/auth/google/start">دخول</a>
              </Button>
            </div>
          </section>
        ) : (
          <>
            <PushNotificationSettings />
            <FloatingActionNotice
              closeLabel="إغلاق نتيجة الإشعارات"
              message={actionNotice?.message}
              onDismiss={() => setActionNotice(null)}
              open={Boolean(actionNotice)}
              title={actionNotice?.title}
              tone={actionNotice?.tone ?? 'info'}
            />
            <ActionConfirmDialog
              confirmLabel="حذف الكل"
              description="سيتم حذف جميع الإشعارات من حسابك."
              loading={isDeletingAll}
              loadingText="جاري الحذف..."
              onCancel={() => setIsDeleteAllConfirmOpen(false)}
              onConfirm={() => void deleteAllNotifications()}
              open={isDeleteAllConfirmOpen}
              title="حذف جميع الإشعارات؟"
              tone="danger"
            />

            <section className="grid gap-3 px-1 py-3 sm:px-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold">سجل الإشعارات</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    className="rounded-md"
                    disabled={isMarkingRead || payload.unreadCount === 0}
                    onClick={() => void markAllRead()}
                    type="button"
                    variant="outline"
                  >
                    <CheckCheck className="size-4" />
                    تعليم كمقروء
                  </Button>
                  {payload.notifications.length > 0 ? (
                    <Button
                      className="rounded-md text-red-600 hover:text-red-700"
                      disabled={isDeletingAll}
                      loading={isDeletingAll}
                      loadingText="جاري الحذف..."
                      onClick={() => setIsDeleteAllConfirmOpen(true)}
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="size-4" />
                      حذف الكل
                    </Button>
                  ) : null}
                </div>
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  جاري تحميل الإشعارات...
                </p>
              ) : payload.notifications.length ? (
                <div className="grid gap-2">
                  {payload.notifications.map((notification) => (
                    <article
                      key={notification.id}
                      className={`grid gap-1 rounded-md border px-3 py-3 text-sm transition hover:border-blue-300 hover:bg-blue-50/50 dark:hover:bg-blue-400/10 ${
                        notification.readAt
                          ? 'border-slate-200/70 bg-white/45 dark:border-white/10 dark:bg-card/40'
                          : 'border-blue-300 bg-blue-50/75 shadow-[0_0_18px_rgba(37,99,235,0.12)] dark:border-blue-400/30 dark:bg-blue-400/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={notification.url}
                          className="grid min-w-0 flex-1 gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <strong className="min-w-0 truncate">
                              {notification.title ?? 'إشعار جديد'}
                            </strong>
                            {!notification.readAt ? (
                              <span className="mt-1 size-2 shrink-0 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]" />
                            ) : null}
                          </div>
                          <p className="line-clamp-2 text-muted-foreground">
                            {notification.body ?? 'يوجد تحديث جديد من حساب تتابعه.'}
                          </p>
                          <time className="text-xs text-muted-foreground">
                            {formatNotificationTime(notification.createdAt)}
                          </time>
                        </Link>
                        <Button
                          aria-label="حذف الإشعار"
                          className="size-8 shrink-0 rounded-md text-red-600 hover:text-red-700"
                          disabled={isDeletingAll}
                          loading={deletingNotificationId === notification.id}
                          onClick={() => void deleteNotification(notification.id)}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-[14rem] place-items-center rounded-md border border-dashed border-slate-300/80 bg-white/35 p-6 text-center dark:border-white/10 dark:bg-card/30">
                  <div className="grid gap-2">
                    <Bell className="mx-auto size-8 text-blue-600" />
                    <p className="text-sm font-bold">لا توجد إشعارات حتى الآن</p>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
