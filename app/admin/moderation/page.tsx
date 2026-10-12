'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CheckCircle2,
  ExternalLink,
  Flag,
  MessageCircle,
  Percent,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { useAdminAccess } from '../use-admin-access';

type ListingRecord = {
  id: string;
  sellerId: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  status: string;
  compliance: {
    decision: 'allow' | 'block' | 'needs_review';
    reasons: string[];
    prohibitedCategory?: string;
  };
};

type ReportRecord = {
  id: string;
  listingId: string;
  reporterId: string;
  reason: string;
  details?: string;
  status: 'open' | 'reviewed' | 'dismissed';
  createdAt: string;
  listing: ListingRecord | null;
};

type UserReportResolution =
  | 'review'
  | 'dismiss'
  | 'warn'
  | 'restrict'
  | 'close_conversation';

type UserReportRecord = {
  id: string;
  reporterId: string;
  targetUserId: string;
  reason: string;
  details?: string;
  status: 'open' | 'reviewed' | 'dismissed';
  resolution?: UserReportResolution;
  createdAt: string;
  reporter?: { id: string; email: string; name: string | null };
  targetUser?: { id: string; email: string; name: string | null };
  conversation: {
    id: string;
    status: string;
    listing: { id: string; title: string | null };
    messages: Array<{
      id: string;
      senderId: string;
      body: string;
      status: string;
      createdAt: string;
    }>;
  } | null;
};

type ModerationQueue = {
  listings: ListingRecord[];
  reports: ReportRecord[];
  userReports: UserReportRecord[];
  pagination?: {
    listings: PaginationMeta;
    reports: PaginationMeta;
    userReports: PaginationMeta;
  };
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

type ListingModerationAction = 'approve' | 'reject' | 'delete';

type ListingReportAction = 'dismiss' | 'reject_listing' | 'delete_listing';

function formatPrice(price: ListingRecord['price']) {
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

function formatComplianceDecision(decision: ListingRecord['compliance']['decision']) {
  const labels = {
    allow: 'مسموح',
    block: 'محظور',
    needs_review: 'يحتاج مراجعة',
  };

  return labels[decision];
}

function formatUserReportResolution(resolution: UserReportResolution) {
  const labels: Record<UserReportResolution, string> = {
    review: 'قيد المراجعة',
    dismiss: 'بلاغ مرفوض',
    warn: 'تحذير مسجّل',
    restrict: 'تواصل مقيّد',
    close_conversation: 'محادثة مغلقة',
  };

  return labels[resolution];
}

function formatReportStatus(status: ReportRecord['status']) {
  const labels: Record<ReportRecord['status'], string> = {
    open: 'مفتوح',
    reviewed: 'تمت المراجعة',
    dismissed: 'مرفوض',
  };

  return labels[status];
}

function formatListingReportReason(reason: string) {
  const labels: Record<string, string> = {
    prohibited_item: 'منتج أو محتوى غير مسموح',
    fraud: 'احتيال أو نصب',
    counterfeit: 'منتج مقلّد',
    wrong_category: 'تصنيف غير صحيح',
    misleading_images: 'صور مضلّلة',
    abusive_content: 'محتوى مسيء',
    other: 'سبب آخر',
  };

  return labels[reason] ?? reason;
}

function formatConversationReportReason(reason: string) {
  const labels: Record<string, string> = {
    conversation_report: 'بلاغ من المحادثة',
    conversation_block: 'حجب من المحادثة',
  };

  return labels[reason] ?? reason;
}

function getUserReportConfirmationMessage(action: UserReportResolution) {
  const messages: Partial<Record<UserReportResolution, string>> = {
    close_conversation:
      'سيتم إغلاق المحادثة ومنع استمرار التواصل بين الطرفين. هل تريد المتابعة؟',
    restrict: 'سيتم منع التواصل بين الطرفين وإغلاق البلاغ. هل تريد المتابعة؟',
    warn: 'سيتم تسجيل تحذير على الحساب المبلّغ عنه وإغلاق البلاغ. هل تريد المتابعة؟',
  };

  return messages[action] ?? '';
}

function getListingReportConfirmMessage(action: ListingReportAction) {
  const messages: Partial<Record<ListingReportAction, string>> = {
    delete_listing:
      'سيتم حذف الإعلان وإغلاق البلاغ بعد تسجيل القرار. هل تريد المتابعة؟',
    reject_listing:
      'سيتم إيقاف الإعلان عن الظهور وإغلاق البلاغ بعد تسجيل القرار. هل تريد المتابعة؟',
  };

  return messages[action] ?? '';
}

function SensitiveListingsSection({
  listings,
  isLoading,
  onModerate,
}: Readonly<{
  listings: ListingRecord[];
  isLoading: boolean;
  onModerate: (listingId: string, action: ListingModerationAction) => void;
}>) {
  let content;

  if (isLoading && listings.length === 0) {
    content = (
      <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
        جار تحميل المراجعة...
      </div>
    );
  } else if (listings.length === 0) {
    content = (
      <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
        لا توجد إعلانات بانتظار المراجعة.
      </div>
    );
  } else {
    content = (
      <div className="grid gap-3">
        {listings.map((listing) => (
          <article key={listing.id} className="grid gap-3 rounded-md border p-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">{listing.title ?? 'إعلان بدون عنوان'}</h2>
                <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  {formatComplianceDecision(listing.compliance.decision)}
                </span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-7 text-muted-foreground">
                {listing.description ?? 'لا يوجد وصف.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{formatPrice(listing.price)}</span>
                <span>{listing.city ?? 'السعودية'}</span>
                <span>{listing.category}</span>
                <span>{listing.compliance.prohibitedCategory ?? 'بدون تصنيف خطر'}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button
                variant="outline"
                className="rounded-md"
                disabled={listing.compliance.decision === 'block'}
                onClick={() => onModerate(listing.id, 'approve')}
              >
                <CheckCircle2 className="size-4" />
                اعتماد
              </Button>
              <Button
                variant="outline"
                className="rounded-md"
                onClick={() => onModerate(listing.id, 'reject')}
              >
                <Ban className="size-4" />
                رفض
              </Button>
              <Button
                variant="outline"
                className="rounded-md"
                onClick={() => onModerate(listing.id, 'delete')}
              >
                <Trash2 className="size-4" />
                حذف
              </Button>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
        <ShieldCheck className="size-4 text-blue-600" />
        الإعلانات الحساسة
      </div>
      {content}
    </section>
  );
}

function ListingReportsSection({
  reports,
  isLoading,
  processingReportId,
  canDeleteReports,
  onResolve,
  onDelete,
}: Readonly<{
  reports: ReportRecord[];
  isLoading: boolean;
  processingReportId: string | null;
  canDeleteReports: boolean;
  onResolve: (report: ReportRecord, action: ListingReportAction) => void;
  onDelete: (reportId: string) => void;
}>) {
  let content;

  if (isLoading && reports.length === 0) {
    content = (
      <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
        جار تحميل البلاغات...
      </div>
    );
  } else if (reports.length === 0) {
    content = (
      <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
        لا توجد بلاغات.
      </div>
    );
  } else {
    content = (
      <div className="grid gap-3">
        {reports.map((report) => {
          const hasActiveListing =
            Boolean(report.listing) && report.listing?.status !== 'deleted';

          return (
            <article key={report.id} className="grid gap-3 rounded-md border p-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold">
                    {report.listing?.title ?? 'إعلان غير متاح'}
                  </h2>
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
                    {formatReportStatus(report.status)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  السبب: {formatListingReportReason(report.reason)}
                </p>
                {report.details && (
                  <p className="mt-1 rounded-md bg-[#f7f9fc] p-2 text-sm leading-7 text-muted-foreground dark:bg-background">
                    {report.details}
                  </p>
                )}
              </div>
              {report.status === 'open' && (
                <div className="grid grid-cols-2 gap-2">
                  {hasActiveListing && report.listing && (
                    <Button asChild variant="outline" className="rounded-md">
                      <Link
                        href={`/admin/listings?listingId=${encodeURIComponent(report.listing.id)}`}
                        target="_blank"
                      >
                        <ExternalLink className="size-4" />
                        فتح الإعلان
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="rounded-md"
                    disabled={processingReportId === report.id}
                    onClick={() => onResolve(report, 'dismiss')}
                  >
                    <BadgeCheck className="size-4" />
                    رفض البلاغ
                  </Button>
                  {hasActiveListing && (
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={processingReportId === report.id}
                      onClick={() => onResolve(report, 'reject_listing')}
                    >
                      <Ban className="size-4" />
                      إيقاف الإعلان
                    </Button>
                  )}
                  {hasActiveListing && (
                    <Button
                      variant="outline"
                      className="rounded-md text-red-600 hover:text-red-700"
                      disabled={processingReportId === report.id}
                      onClick={() => onResolve(report, 'delete_listing')}
                    >
                      <Trash2 className="size-4" />
                      حذف الإعلان
                    </Button>
                  )}
                </div>
              )}
              {canDeleteReports && report.status !== 'open' && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    className="rounded-md text-red-600 hover:text-red-700"
                    disabled={processingReportId === report.id}
                    onClick={() => onDelete(report.id)}
                  >
                    <Trash2 className="size-4" />
                    حذف البلاغ
                  </Button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
        <Flag className="size-4 text-blue-600" />
        البلاغات
      </div>
      {content}
    </section>
  );
}

function UserReportsSection({
  userReports,
  processingReportId,
  canViewAccounts,
  canDeleteReports,
  onModerate,
  onDelete,
}: Readonly<{
  userReports: UserReportRecord[];
  processingReportId: string | null;
  canViewAccounts: boolean;
  canDeleteReports: boolean;
  onModerate: (reportId: string, action: UserReportResolution) => void;
  onDelete: (reportId: string) => void;
}>) {
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  let content;

  if (userReports.length === 0) {
    content = (
      <div className="grid min-h-32 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
        لا توجد بلاغات محادثات.
      </div>
    );
  } else {
    content = (
      <div className="grid gap-3">
        {userReports.map((report) => {
          const isExpanded = expandedReportId === report.id;
          const messagePreview = report.conversation?.messages.at(0);

          return (
          <article key={report.id} className="grid gap-3 rounded-md border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">
                  {report.conversation?.listing.title ?? 'محادثة دون إعلان متاح'}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  السبب: {formatConversationReportReason(report.reason)} · {new Date(report.createdAt).toLocaleString('ar-SA')}
                </p>
              </div>
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
                {formatReportStatus(report.status)}
                {report.resolution ? ` · ${formatUserReportResolution(report.resolution)}` : ''}
              </span>
            </div>
            {report.details && (
              <p className="rounded-md bg-[#f7f9fc] p-2 text-sm leading-7 text-muted-foreground dark:bg-background">
                {report.details}
              </p>
            )}
            {messagePreview && !isExpanded && (
              <p className="line-clamp-2 text-xs leading-6 text-muted-foreground">
                <span className="font-semibold text-foreground">معاينة: </span>
                {messagePreview.body}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-md"
                onClick={() =>
                  setExpandedReportId((currentId) =>
                    currentId === report.id ? null : report.id,
                  )
                }
              >
                <MessageCircle className="size-3.5" />
                {isExpanded ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
              </Button>
              {canDeleteReports && report.status !== 'open' && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-md text-red-600 hover:text-red-700"
                  disabled={processingReportId === report.id}
                  onClick={() => onDelete(report.id)}
                >
                  <Trash2 className="size-3.5" />
                  حذف البلاغ
                </Button>
              )}
            </div>
            {isExpanded && (
              <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md border p-2 text-xs leading-6">
                <div className="font-bold">المبلّغ</div>
                <div>{report.reporter?.name ?? 'دون اسم'}</div>
                <div className="break-all text-muted-foreground">{report.reporter?.email ?? report.reporterId}</div>
                <div className="break-all text-muted-foreground">{report.reporterId}</div>
                {canViewAccounts && (
                  <Button asChild size="sm" variant="outline" className="mt-2 w-full rounded-md">
                    <Link href={`/admin/users?query=${encodeURIComponent(report.reporterId)}`}>
                      <Users className="size-3.5" />
                      عرض حساب المبلّغ
                    </Link>
                  </Button>
                )}
              </div>
              <div className="rounded-md border p-2 text-xs leading-6">
                <div className="font-bold">المبلّغ عنه</div>
                <div>{report.targetUser?.name ?? 'دون اسم'}</div>
                <div className="break-all text-muted-foreground">{report.targetUser?.email ?? report.targetUserId}</div>
                <div className="break-all text-muted-foreground">{report.targetUserId}</div>
                {canViewAccounts && (
                  <Button asChild size="sm" variant="outline" className="mt-2 w-full rounded-md">
                    <Link href={`/admin/users?query=${encodeURIComponent(report.targetUserId)}`}>
                      <Users className="size-3.5" />
                      عرض الحساب المبلّغ عنه
                    </Link>
                  </Button>
                )}
              </div>
            </div>
            {report.conversation?.messages.length ? (
              <div className="grid gap-1.5 rounded-md border p-2">
                <div className="text-xs font-bold">آخر الرسائل المرتبطة بالبلاغ</div>
                {report.conversation.messages.map((message) => (
                  <div key={message.id} className="rounded bg-[#f7f9fc] px-2 py-1.5 text-xs dark:bg-background">
                    <span className="font-semibold">
                      {message.senderId === report.reporterId ? 'المبلّغ' : 'المبلّغ عنه'}:
                    </span>{' '}
                    <span className="wrap-break-word">{message.body}</span>
                  </div>
                ))}
              </div>
            ) : null}
              </>
            )}
            {report.status === 'open' && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Button
                  variant="outline"
                  className="rounded-md"
                  disabled={processingReportId === report.id}
                  onClick={() => onModerate(report.id, 'dismiss')}
                >
                  <BadgeCheck className="size-4" />
                  رفض البلاغ
                </Button>
                <Button
                  variant="outline"
                  className="rounded-md"
                  disabled={processingReportId === report.id}
                  onClick={() => onModerate(report.id, 'review')}
                >
                  <ShieldCheck className="size-4" />
                  توثيق المراجعة
                </Button>
                <Button
                  variant="outline"
                  className="rounded-md text-amber-700 hover:text-amber-800 dark:text-amber-200"
                  disabled={processingReportId === report.id}
                  onClick={() => onModerate(report.id, 'warn')}
                >
                  <Flag className="size-4" />
                  تسجيل تحذير إداري
                </Button>
                <Button
                  variant="outline"
                  className="rounded-md text-red-600 hover:text-red-700"
                  disabled={processingReportId === report.id || !report.conversation}
                  onClick={() => onModerate(report.id, 'restrict')}
                >
                  <Ban className="size-4" />
                  تقييد التواصل
                </Button>
                <Button
                  variant="outline"
                  className="rounded-md text-red-600 hover:text-red-700"
                  disabled={processingReportId === report.id || !report.conversation}
                  onClick={() => onModerate(report.id, 'close_conversation')}
                >
                  <Ban className="size-4" />
                  إغلاق ومنع التواصل
                </Button>
              </div>
            )}
          </article>
          );
        })}
      </div>
    );
  }

  return (
    <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
        <MessageCircle className="size-4 text-blue-600" />
        بلاغات المحادثات
      </div>
      {content}
    </section>
  );
}

export default function AdminModerationPage() {
  const router = useRouter();
  const {
    adminAccessRole,
    adminAccessNotice,
    isAdminAccessAllowed,
    verifyAdminAccess,
  } = useAdminAccess('moderator');
  const [queue, setQueue] = useState<ModerationQueue>({
    listings: [],
    reports: [],
    userReports: [],
  });
  const [nextPage, setNextPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [processingReportId, setProcessingReportId] = useState<string | null>(null);
  const [pendingModerationConfirm, setPendingModerationConfirm] = useState<{
    title: string;
    description: string;
    tone?: 'default' | 'danger' | 'success';
    onConfirm: () => void;
  } | null>(null);

  const openReportsCount = useMemo(
    () =>
      queue.reports.filter((report) => report.status === 'open').length +
      queue.userReports.filter((report) => report.status === 'open').length,
    [queue.reports, queue.userReports],
  );
  const hasMoreQueue =
    Boolean(queue.pagination?.listings.hasMore) ||
    Boolean(queue.pagination?.reports.hasMore) ||
    Boolean(queue.pagination?.userReports.hasMore);
  const canDeleteReports =
    adminAccessRole === 'owner' ||
    adminAccessRole === 'admin' ||
    adminAccessRole === 'moderator';

  const refreshQueue = useCallback(async (page = 1) => {
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        setQueue({ listings: [], reports: [], userReports: [] });
        return;
      }

      const response = await fetch(`/api/admin/moderation?page=${page}&limit=20`, {
        cache: 'no-store',
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 403) {
        setNotice('هذه الصفحة مخصصة للمسؤول فقط.');
        setQueue({ listings: [], reports: [], userReports: [] });
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحميل طابور المراجعة.');
        return;
      }

      const payload = (await response.json()) as ModerationQueue;

      setQueue((currentQueue) =>
        page === 1
          ? payload
          : {
              ...payload,
              listings: [...currentQueue.listings, ...payload.listings],
              reports: [...currentQueue.reports, ...payload.reports],
              userReports: [
                ...currentQueue.userReports,
                ...(payload.userReports ?? []),
              ],
            },
      );
      setNextPage(page + 1);
    } finally {
      setIsLoading(false);
    }
  }, [router, verifyAdminAccess]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshQueue();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshQueue]);

  useSmartstoreRealtime({
    enabled: isAdminAccessAllowed,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'moderation_updated',
      'ad_status_changed',
      'ad_deleted',
      'ad_updated',
      'maintenance_cleanup',
    ],
    onEvent: () => {
      void refreshQueue(1);
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return refreshQueue(1);
    },
  });

  const queueLoadMoreRef = useInfiniteScroll({
    enabled: hasMoreQueue,
    isLoading,
    onLoadMore: () => {
      void refreshQueue(nextPage);
    },
  });

  const moderateListing = useCallback(
    async (listingId: string, action: ListingModerationAction) => {
      const response = await fetch(
        `/api/admin/moderation/listings/${listingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        setNotice('تعذر تنفيذ إجراء المراجعة على الإعلان.');
        return;
      }

      void refreshQueue(1);
    },
    [refreshQueue],
  );

  const moderateReport = useCallback(
    async (reportId: string, action: 'review' | 'dismiss') => {
      const response = await fetch(
        `/api/admin/moderation/reports/${reportId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );

      if (!response.ok) {
        setNotice('تعذر تحديث البلاغ.');
        return;
      }

      void refreshQueue(1);
    },
    [refreshQueue],
  );

  const moderateUserReport = useCallback(
    async (
      reportId: string,
      action: UserReportResolution,
      skipConfirm = false,
    ) => {
      const confirmationMessage = getUserReportConfirmationMessage(action);

      if (confirmationMessage && !skipConfirm) {
        setPendingModerationConfirm({
          title: 'تأكيد إجراء البلاغ',
          description: confirmationMessage,
          tone:
            action === 'dismiss' || action === 'review' ? 'default' : 'danger',
          onConfirm: () => {
            setPendingModerationConfirm(null);
            void moderateUserReport(reportId, action, true);
          },
        });
        return;
      }

      setProcessingReportId(reportId);
      setNotice('');
      try {
        const response = await fetch(
          `/api/admin/moderation/user-reports/${reportId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
          },
        );
        if (!response.ok) {
          setNotice('تعذر معالجة بلاغ المحادثة، وبقي البلاغ مفتوحًا.');
          return;
        }
        void refreshQueue(1);
      } finally {
        setProcessingReportId(null);
      }
    },
    [refreshQueue],
  );

  const deleteClosedReport = useCallback(
    async (
      reportId: string,
      reportType: 'listing' | 'conversation',
      skipConfirm = false,
    ) => {
      if (!skipConfirm) {
        setPendingModerationConfirm({
          title: 'تأكيد حذف البلاغ',
          description: 'سيتم حذف البلاغ المغلق نهائيًا.',
          tone: 'danger',
          onConfirm: () => {
            setPendingModerationConfirm(null);
            void deleteClosedReport(reportId, reportType, true);
          },
        });
        return;
      }

      setProcessingReportId(reportId);
      setNotice('');
      try {
        const reportPath =
          reportType === 'conversation' ? 'user-reports' : 'reports';
        const response = await fetch(
          `/api/admin/moderation/${reportPath}/${reportId}`,
          { method: 'DELETE' },
        );

        if (response.status === 409) {
          setNotice('لا يمكن حذف البلاغ قبل إغلاقه.');
          return;
        }

        if (!response.ok) {
          setNotice('تعذر حذف البلاغ. تحقق من الصلاحية وحالة البلاغ.');
          return;
        }

        void refreshQueue(1);
      } finally {
        setProcessingReportId(null);
      }
    },
    [refreshQueue],
  );

  const resolveReport = useCallback(
    async (
      report: ReportRecord,
      action: ListingReportAction,
      skipConfirm = false,
    ) => {
      if (action !== 'dismiss' && !report.listing) {
        setNotice('الإعلان المرتبط بهذا البلاغ لم يعد متاحًا. يمكنك رفض البلاغ وإغلاقه.');
        return;
      }

      const confirmationMessage = getListingReportConfirmMessage(action);

      if (confirmationMessage && !skipConfirm) {
        setPendingModerationConfirm({
          title: 'تأكيد إجراء البلاغ',
          description: confirmationMessage,
          tone: action === 'dismiss' ? 'default' : 'danger',
          onConfirm: () => {
            setPendingModerationConfirm(null);
            void resolveReport(report, action, true);
          },
        });
        return;
      }

      setProcessingReportId(report.id);
      setNotice('');

      try {
        if (action !== 'dismiss' && report.listing) {
          const listingResponse = await fetch(
            `/api/admin/moderation/listings/${report.listing.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: action === 'delete_listing' ? 'delete' : 'reject',
              }),
            },
          );

          if (!listingResponse.ok) {
            setNotice('تعذر تنفيذ الإجراء على الإعلان، لذلك بقي البلاغ مفتوحًا.');
            return;
          }
        }

        await moderateReport(
          report.id,
          action === 'dismiss' ? 'dismiss' : 'review',
        );
      } finally {
        setProcessingReportId(null);
      }
    },
    [moderateReport],
  );

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء المراجعة"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <ActionConfirmDialog
        confirmLabel="تنفيذ الإجراء"
        description={pendingModerationConfirm?.description ?? ''}
        loading={Boolean(processingReportId)}
        loadingText="جاري التنفيذ..."
        onCancel={() => setPendingModerationConfirm(null)}
        onConfirm={() => pendingModerationConfirm?.onConfirm()}
        open={Boolean(pendingModerationConfirm)}
        title={pendingModerationConfirm?.title ?? 'تأكيد الإجراء'}
        tone={pendingModerationConfirm?.tone ?? 'default'}
      />
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.webp" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">لوحة المراجعة</h1>
              <p className="truncate text-xs text-muted-foreground">
                الإعلانات الحساسة والبلاغات
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="rounded-md">
              <Link href="/admin/commissions">
                <Percent className="size-4" />
                رسوم المنصة
              </Link>
            </Button>
          </div>
        </header>

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">إعلانات تنتظر المراجعة</div>
            <div className="mt-1 text-2xl font-bold">{queue.listings.length}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">بلاغات مفتوحة</div>
            <div className="mt-1 text-2xl font-bold">{openReportsCount}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">إجمالي البلاغات</div>
            <div className="mt-1 text-2xl font-bold">
              {queue.reports.length + queue.userReports.length}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <SensitiveListingsSection
            listings={queue.listings}
            isLoading={isLoading}
            onModerate={(listingId, action) => void moderateListing(listingId, action)}
          />

          <ListingReportsSection
            reports={queue.reports}
            isLoading={isLoading}
            processingReportId={processingReportId}
            canDeleteReports={canDeleteReports}
            onResolve={(report, action) => void resolveReport(report, action)}
            onDelete={(reportId) =>
              void deleteClosedReport(reportId, 'listing')
            }
          />
        </section>
        <UserReportsSection
          userReports={queue.userReports}
          processingReportId={processingReportId}
          canViewAccounts={
            adminAccessRole === 'owner' || adminAccessRole === 'admin'
          }
          canDeleteReports={canDeleteReports}
          onModerate={(reportId, action) => void moderateUserReport(reportId, action)}
          onDelete={(reportId) =>
            void deleteClosedReport(reportId, 'conversation')
          }
        />
        <div ref={queueLoadMoreRef} className="h-px" />
        {hasMoreQueue && (
          <Button
            variant="outline"
            className="mx-auto rounded-md"
            disabled={isLoading}
            onClick={() => void refreshQueue(nextPage)}
          >
            {isLoading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
          </Button>
        )}
      </div>
    </main>
  );
}
