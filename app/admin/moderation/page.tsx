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
  Flag,
  Percent,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';

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

type ModerationQueue = {
  listings: ListingRecord[];
  reports: ReportRecord[];
  pagination?: {
    listings: PaginationMeta;
    reports: PaginationMeta;
  };
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

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

export default function AdminModerationPage() {
  const router = useRouter();
  const [queue, setQueue] = useState<ModerationQueue>({
    listings: [],
    reports: [],
  });
  const [nextPage, setNextPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const openReportsCount = useMemo(
    () => queue.reports.filter((report) => report.status === 'open').length,
    [queue.reports],
  );
  const hasMoreQueue =
    Boolean(queue.pagination?.listings.hasMore) ||
    Boolean(queue.pagination?.reports.hasMore);

  const refreshQueue = useCallback(async (page = 1) => {
    setIsLoading(true);
    setNotice('');

    try {
      const response = await fetch(`/api/admin/moderation?page=${page}&limit=20`);

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 403) {
        setNotice('هذه الصفحة مخصصة للمسؤول فقط.');
        setQueue({ listings: [], reports: [] });
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
            },
      );
      setNextPage(page + 1);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshQueue();
  }, [refreshQueue]);

  const moderateListing = useCallback(
    async (listingId: string, action: 'approve' | 'reject' | 'delete') => {
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

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
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
                العمولات
              </Link>
            </Button>
            <ThemeToggle language="ar" />
          </div>
        </header>

        {notice && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {notice}
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
            <div className="mt-1 text-2xl font-bold">{queue.reports.length}</div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="size-4 text-blue-600" />
              الإعلانات الحساسة
            </div>

            {isLoading ? (
              <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                جار تحميل المراجعة...
              </div>
            ) : queue.listings.length === 0 ? (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
                لا توجد إعلانات بانتظار المراجعة.
              </div>
            ) : (
              <div className="grid gap-3">
                {queue.listings.map((listing) => (
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
                        onClick={() => moderateListing(listing.id, 'approve')}
                      >
                        <CheckCircle2 className="size-4" />
                        اعتماد
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-md"
                        onClick={() => moderateListing(listing.id, 'reject')}
                      >
                        <Ban className="size-4" />
                        رفض
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-md"
                        onClick={() => moderateListing(listing.id, 'delete')}
                      >
                        <Trash2 className="size-4" />
                        حذف
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold">
              <Flag className="size-4 text-blue-600" />
              البلاغات
            </div>

            {isLoading ? (
              <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                جار تحميل البلاغات...
              </div>
            ) : queue.reports.length === 0 ? (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
                لا توجد بلاغات.
              </div>
            ) : (
              <div className="grid gap-3">
                {queue.reports.map((report) => (
                  <article key={report.id} className="grid gap-3 rounded-md border p-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold">
                          {report.listing?.title ?? 'إعلان غير متاح'}
                        </h2>
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-100">
                          {report.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-7 text-muted-foreground">
                        السبب: {report.reason}
                      </p>
                      {report.details && (
                        <p className="mt-1 rounded-md bg-[#f7f9fc] p-2 text-sm leading-7 text-muted-foreground dark:bg-background">
                          {report.details}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        className="rounded-md"
                        onClick={() => moderateReport(report.id, 'review')}
                      >
                        <BadgeCheck className="size-4" />
                        تمت المراجعة
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-md"
                        onClick={() => moderateReport(report.id, 'dismiss')}
                      >
                        <Ban className="size-4" />
                        تجاهل
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </section>
        {hasMoreQueue && (
          <Button
            variant="outline"
            className="mx-auto rounded-md"
            disabled={isLoading}
            onClick={() => void refreshQueue(nextPage)}
          >
            {isLoading ? 'ط¬ط§ط± ط§ظ„طھط­ظ…ظٹظ„...' : 'طھط­ظ…ظٹظ„ ط§ظ„ظ…ط²ظٹط¯'}
          </Button>
        )}
      </div>
    </main>
  );
}
