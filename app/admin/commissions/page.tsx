'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  Percent,
  Receipt,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';

type CommissionRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  productValue: number | null;
  commissionRatePercent: 1;
  commissionAmount: number | null;
  status: 'pending_amount' | 'due' | 'paid' | 'waived' | 'disputed';
  updatedAt: string;
  paidAt?: string;
  listing: {
    title?: string;
    city?: string;
  } | null;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

function formatMoney(value: number | null) {
  if (typeof value !== 'number') {
    return 'غير محدد';
  }

  return `${new Intl.NumberFormat('ar-SA').format(value)} ر.س`;
}

function formatStatus(status: CommissionRecord['status']) {
  const labels = {
    pending_amount: 'بانتظار قيمة البيع',
    due: 'مستحقة',
    paid: 'مدفوعة',
    waived: 'معفاة',
    disputed: 'متنازع عليها',
  };

  return labels[status];
}

export default function AdminCommissionsPage() {
  const router = useRouter();
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [commissionsPagination, setCommissionsPagination] =
    useState<PaginationMeta | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const totalDue = useMemo(
    () =>
      commissions
        .filter((commission) => commission.status === 'due')
        .reduce((total, commission) => total + (commission.commissionAmount ?? 0), 0),
    [commissions],
  );
  const totalPaid = useMemo(
    () =>
      commissions
        .filter((commission) => commission.status === 'paid')
        .reduce((total, commission) => total + (commission.commissionAmount ?? 0), 0),
    [commissions],
  );

  const refreshCommissions = useCallback(async (page = 1) => {
    setIsLoading(true);
    setNotice('');

    try {
      const response = await fetch(`/api/admin/commissions?page=${page}&limit=20`, {
        cache: 'no-store',
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 403) {
        setNotice('هذه الصفحة مخصصة للمسؤول فقط.');
        setCommissions([]);
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحميل العمولات.');
        return;
      }

      const payload = (await response.json()) as {
        commissions?: CommissionRecord[];
        pagination?: PaginationMeta;
      };
      setCommissions((currentCommissions) =>
        page === 1
          ? (payload.commissions ?? [])
          : [...currentCommissions, ...(payload.commissions ?? [])],
      );
      setCommissionsPagination(payload.pagination ?? null);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshCommissions();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshCommissions]);

  useSmartstoreRealtime({
    enabled: true,
    fallbackIntervalMs: 4000,
    eventTypes: ['commission_updated', 'maintenance_cleanup'],
    onEvent: () => {
      void refreshCommissions(1);
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return refreshCommissions(1);
    },
  });

  const commissionsLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(commissionsPagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void refreshCommissions(commissionsPagination?.nextPage ?? 1);
    },
  });

  const setCommissionStatus = useCallback(
    async (
      commissionId: string,
      status: 'due' | 'paid' | 'waived' | 'disputed',
    ) => {
      const response = await fetch(`/api/admin/commissions/${commissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        setNotice('تعذر تحديث حالة العمولة.');
        return;
      }

      await refreshCommissions(1);
    },
    [refreshCommissions],
  );

  const deleteCommission = useCallback(
    async (commissionId: string) => {
      if (!window.confirm('هل تريد حذف سجل العمولة؟')) {
        return;
      }

      const response = await fetch(`/api/admin/commissions/${commissionId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setNotice('تعذر حذف سجل العمولة.');
        return;
      }

      setNotice('تم حذف سجل العمولة.');
      await refreshCommissions(1);
    },
    [refreshCommissions],
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
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Percent className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">إدارة العمولات</h1>
              <p className="truncate text-xs text-muted-foreground">
                متابعة عمولة 1% من عمليات البيع داخل الموقع
              </p>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        {notice && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {notice}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">مستحق</div>
            <div className="mt-1 text-2xl font-bold">{formatMoney(totalDue)}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">مدفوع</div>
            <div className="mt-1 text-2xl font-bold">{formatMoney(totalPaid)}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">السجلات</div>
            <div className="mt-1 text-2xl font-bold">{commissions.length}</div>
          </div>
        </section>

        <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold">
            <Receipt className="size-4 text-blue-600" />
            سجل العمولات
          </div>

          {isLoading && commissions.length === 0 ? (
            <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
              جار تحميل العمولات...
            </div>
          ) : commissions.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
              لا توجد عمولات حتى الآن.
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3">
                {commissions.map((commission) => (
                  <article key={commission.id} className="grid gap-3 rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold">
                        {commission.listing?.title ?? 'إعلان غير متاح'}
                      </h2>
                      <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>البائع: {commission.sellerId}</span>
                        <span>قيمة البيع: {formatMoney(commission.productValue)}</span>
                        <span>العمولة: {formatMoney(commission.commissionAmount)}</span>
                        <span>{formatStatus(commission.status)}</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      <ShieldCheck className="size-3.5" />
                      {commission.commissionRatePercent}%
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Button
                      variant="outline"
                      className="rounded-md"
                      onClick={() => setCommissionStatus(commission.id, 'paid')}
                    >
                      <CheckCircle2 className="size-4" />
                      مدفوعة
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      onClick={() => setCommissionStatus(commission.id, 'due')}
                    >
                      مستحقة
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      onClick={() => setCommissionStatus(commission.id, 'disputed')}
                    >
                      متنازع
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      onClick={() => setCommissionStatus(commission.id, 'waived')}
                    >
                      إعفاء
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      onClick={() => void deleteCommission(commission.id)}
                    >
                      <Trash2 className="size-4" />
                      حذف
                    </Button>
                  </div>
                  </article>
                ))}
              </div>
              <div ref={commissionsLoadMoreRef} className="h-px" />
              {commissionsPagination?.hasMore && (
                <Button
                  variant="outline"
                  className="mx-auto rounded-md"
                  disabled={isLoading}
                  onClick={() =>
                    void refreshCommissions(
                      commissionsPagination.nextPage ?? 1,
                    )
                  }
                >
                  {isLoading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
                </Button>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
