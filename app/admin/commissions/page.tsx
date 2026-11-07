'use client';

import { AdminPageHeading } from '@/components/admin/page-heading';
import { TechnicalDetails } from '@/components/admin/record-details';
import { useAdminRequest } from '@/components/admin/use-admin-request';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Receipt,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { useAdminAccess } from '../use-admin-access';

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
  const {
    adminAccessNotice,
    isAdminAccessAllowed,
    verifyAdminAccess,
  } = useAdminAccess('admin');
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [commissionsPagination, setCommissionsPagination] =
    useState<PaginationMeta | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState<{ totalDue: number; totalPaid: number; totalRecords: number } | null>(null);
  const [pendingCommissionId, setPendingCommissionId] = useState<string | null>(null);
  const [pendingDeleteCommissionId, setPendingDeleteCommissionId] =
    useState<string | null>(null);
  const { begin: beginLoad, invalidate: invalidateLoad } = useAdminRequest(isAdminAccessAllowed);
  const { begin: beginMutation } = useAdminRequest(isAdminAccessAllowed);

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
    const request = beginLoad();
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        if (!request.isCurrent()) return;
        setCommissions([]);
        setCommissionsPagination(null);
        setSummary(null);
        return;
      }
      if (!request.isCurrent()) return;

      const response = await fetch(`/api/admin/commissions?page=${page}&limit=20`, {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!request.isCurrent()) return;

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
        setNotice('تعذر تحميل رسوم المنصة.');
        return;
      }

      const payload = (await response.json()) as {
        commissions?: CommissionRecord[];
        pagination?: PaginationMeta;
        summary?: { totalDue: number; totalPaid: number; totalRecords: number };
      };
      if (!request.isCurrent()) return;
      setCommissions((currentCommissions) =>
        page === 1
          ? (payload.commissions ?? [])
          : [...currentCommissions, ...(payload.commissions ?? []).filter(commission => !currentCommissions.some(row => row.id === commission.id))],
      );
      setCommissionsPagination(payload.pagination ?? null);
      setSummary(payload.summary ?? null);
    } catch {
      if (request.isCurrent()) setNotice('تعذر الاتصال لتحميل رسوم المنصة. حاول مجددًا.');
    } finally {
      if (request.isCurrent()) setIsLoading(false);
    }
  }, [router, verifyAdminAccess, beginLoad]);

  useEffect(() => {
    if (isAdminAccessAllowed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) { setCommissions([]); setSummary(null); setCommissionsPagination(null); setPendingDeleteCommissionId(null); }
    });
    return () => { cancelled = true; };
  }, [isAdminAccessAllowed]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    if (!isAdminAccessAllowed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshCommissions();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAdminAccessAllowed, refreshCommissions]);

  useSmartstoreRealtime({
    enabled: isAdminAccessAllowed,
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
      const request = beginMutation();
      invalidateLoad();
      setPendingCommissionId(commissionId);
      try {
        const response = await fetch(`/api/admin/commissions/${commissionId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
        });
        if (!request.isCurrent()) return;
        if (!response.ok) { setNotice('تعذر تحديث حالة الرسوم.'); return; }
        await refreshCommissions(1);
        if (request.isCurrent()) setNotice('تم تحديث حالة الرسوم.');
      } catch {
        if (request.isCurrent()) setNotice('تعذر الاتصال لتحديث حالة الرسوم. حاول مجددًا.');
      } finally {
        if (request.isCurrent()) setPendingCommissionId(null);
      }
    },
    [refreshCommissions, beginMutation, invalidateLoad],
  );

  const deleteCommission = useCallback(
    async (commissionId: string) => {
      const request = beginMutation();
      invalidateLoad();
      setPendingDeleteCommissionId(null);
      setPendingCommissionId(commissionId);
      try {
        const response = await fetch(`/api/admin/commissions/${commissionId}`, { method: 'DELETE' });
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        if (!request.isCurrent()) return;
        if (!response.ok) { setNotice(payload?.message ?? 'تعذر حذف سجل الرسوم.'); return; }
        await refreshCommissions(1);
        if (request.isCurrent()) setNotice('تم حذف سجل الرسوم.');
      } catch {
        if (request.isCurrent()) setNotice('تعذر الاتصال لحذف سجل الرسوم. حاول مجددًا.');
      } finally {
        if (request.isCurrent()) setPendingCommissionId(null);
      }
    },
    [refreshCommissions, beginMutation, invalidateLoad],
  );

  if (!isAdminAccessAllowed) return <main dir="rtl"><div className="admin-page"><AdminPageHeading title="إدارة رسوم المنصة" /><p role="status">{adminAccessNotice || 'جارٍ التحقق من الصلاحية…'}</p></div></main>;

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء الرسوم"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <ActionConfirmDialog
        confirmLabel="حذف السجل"
        description="سيتم حذف سجل الرسوم المحدد."
        onCancel={() => setPendingDeleteCommissionId(null)}
        onConfirm={() => {
          if (pendingDeleteCommissionId) {
            void deleteCommission(pendingDeleteCommissionId);
          }
        }}
        open={Boolean(pendingDeleteCommissionId)}
        title="تأكيد حذف سجل الرسوم"
        tone="danger"
      />
      <div className="admin-page">
        <AdminPageHeading title="إدارة رسوم المنصة" />

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="admin-statistics sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">{summary ? 'مستحق' : 'مستحق في السجلات المحمّلة'}</div>
            <div className="mt-1 text-2xl font-bold">{formatMoney(summary?.totalDue ?? totalDue)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{summary ? 'مدفوع' : 'مدفوع في السجلات المحمّلة'}</div>
            <div className="mt-1 text-2xl font-bold">{formatMoney(summary?.totalPaid ?? totalPaid)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{summary ? 'إجمالي السجلات' : 'السجلات المحمّلة'}</div>
            <div className="mt-1 text-2xl font-bold">{new Intl.NumberFormat('ar-SA').format(summary?.totalRecords ?? commissions.length)}</div>
          </div>
        </section>

        <section className="admin-section">
          <div className="mb-4 flex items-center gap-2 text-sm font-bold">
            <Receipt className="size-4 text-blue-600" />
            سجل رسوم المنصة
          </div>

          {isLoading && commissions.length === 0 ? (
            <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
              جار تحميل رسوم المنصة...
            </div>
          ) : commissions.length === 0 ? (
            <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
              لا توجد عمولات حتى الآن.
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-3">
                {commissions.map((commission) => (
                  <article key={commission.id} className="admin-record">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-bold">
                        {commission.listing?.title ?? 'إعلان غير متاح'}
                      </h2>
                      <span className="admin-status mt-2">{formatStatus(commission.status)}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      <ShieldCheck className="size-3.5" />
                      {commission.commissionRatePercent}%
                    </span>
                  </div>

                  <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">قيمة البيع</dt><dd className="mt-1 text-lg font-semibold">{formatMoney(commission.productValue)}</dd></div><div><dt className="text-xs text-muted-foreground">رسوم المنصة</dt><dd className="mt-1 text-lg font-semibold">{formatMoney(commission.commissionAmount)}</dd></div></dl>
                  <TechnicalDetails title="معرّفات سجل الرسوم" value={{ commissionId: commission.id, sellerId: commission.sellerId, listingId: commission.listingId }} />
                  <div className="admin-actions">
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(pendingCommissionId)}
                      onClick={() => setCommissionStatus(commission.id, 'paid')}
                    >
                      <CheckCircle2 className="size-4" />
                      مدفوعة
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(pendingCommissionId)}
                      onClick={() => setCommissionStatus(commission.id, 'due')}
                    >
                      مستحقة
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(pendingCommissionId)}
                      onClick={() => setCommissionStatus(commission.id, 'disputed')}
                    >
                      متنازع
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(pendingCommissionId)}
                      onClick={() => setCommissionStatus(commission.id, 'waived')}
                    >
                      إعفاء
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(pendingCommissionId)}
                      onClick={() => setPendingDeleteCommissionId(commission.id)}
                    >
                      <Trash2 className="size-4" />
                      حذف
                    </Button>
                  </div>
                  </article>
                ))}
              </div>
              {commissionsPagination?.hasMore && (
                <div>
                  <div
                    ref={commissionsLoadMoreRef}
                    aria-hidden="true"
                    className="h-24 w-full"
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
