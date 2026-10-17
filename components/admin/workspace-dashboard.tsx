'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@ui/button';
import type { AdminWorkspace } from '@/lib/admin/workspace';
import { WorkspaceCharts } from './workspace-charts';
import { StatusDistribution } from './status-distribution';

const WorkspaceCalendar = dynamic(() => import('./workspace-calendar'), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      جارٍ تحميل التقويم...
    </p>
  ),
});

const listingLabels: Record<string, string> = {
  draft: 'مسودات',
  pending: 'بانتظار المراجعة',
  published: 'منشورة',
  paused: 'متوقفة',
  sold: 'مباعة',
  rejected: 'مرفوضة',
  deleted: 'محذوفة',
};
const evidenceLabels: Record<string, string> = {
  pending: 'بانتظار الحفظ',
  complete: 'مكتملة',
  incomplete: 'غير مكتملة',
};
const commissionLabels: Record<string, string> = {
  pending_amount: 'بانتظار تحديد المبلغ',
  due: 'مستحقة',
  paid: 'مدفوعة',
  waived: 'معفاة',
  disputed: 'متنازع عليها',
};
const number = (value: number | string) =>
  new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(
    Number(value),
  );

export function WorkspaceDashboard() {
  const params = useSearchParams();
  const calendar = params.get('view') === 'calendar';
  const [month, setMonth] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .slice(0, 7),
  );
  const [data, setData] = useState<AdminWorkspace | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      setData(null);
      try {
        const response = await fetch(
          `/api/admin/overview?view=workspace&month=${encodeURIComponent(month)}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new Error('workspace_unavailable');
        const payload: AdminWorkspace = await response.json();
        if (!controller.signal.aborted) setData(payload);
      } catch {
        if (!controller.signal.aborted)
          setError('تعذر تحميل المؤشرات والمواعيد.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [month, revision]);
  const pending =
    data?.listings.find((row) => row.status === 'pending')?.count ?? 0;
  const incomplete =
    data?.evidence
      .filter((row) => row.status !== 'complete')
      .reduce((sum, row) => sum + row.count, 0) ?? 0;
  const due = data?.commissions.find((row) => row.status === 'due');
  return (
    <section
      className="grid min-w-0 gap-4"
      aria-label="متابعة الإدارة"
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <nav className="flex flex-wrap gap-1" aria-label="عرض متابعة الإدارة">
          <Button variant={calendar ? 'ghost' : 'secondary'} asChild>
            <Link
              href="/admin"
              prefetch={false}
              aria-current={!calendar ? 'page' : undefined}
            >
              <ChartNoAxesCombined className="size-4" />
              المؤشرات
            </Link>
          </Button>
          <Button variant={calendar ? 'secondary' : 'ghost'} asChild>
            <Link
              href="/admin?view=calendar"
              prefetch={false}
              aria-current={calendar ? 'page' : undefined}
            >
              <CalendarDays className="size-4" />
              التقويم
            </Link>
          </Button>
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-xs text-muted-foreground"
            htmlFor="admin-month"
          >
            الشهر
          </label>
          <input
            id="admin-month"
            type="month"
            min="2000-01"
            max="2099-12"
            value={month}
            onChange={(event) => {
              if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value))
                setMonth(event.target.value);
            }}
            className="h-9 min-w-0 max-w-full rounded-md border bg-card px-2 text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="تحديث المؤشرات والمواعيد"
            title="تحديث المؤشرات والمواعيد"
            disabled={loading}
            onClick={refresh}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>
      {loading && (
        <div
          className="grid min-h-72 place-items-center text-sm text-muted-foreground"
          role="status"
        >
          جارٍ تحميل المؤشرات والمواعيد...
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 py-8 text-sm"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={refresh}>
            <RefreshCw className="size-4" />
            إعادة المحاولة
          </Button>
        </div>
      )}
      {data && (
        <>
          <section className="admin-panel" aria-label="تنبيهات إدارية">
            <h2 className="admin-panel-heading flex items-center gap-2">
              <Bell className="size-4" />
              يحتاج متابعة الآن
            </h2>
            <div className="admin-panel-body grid gap-3 text-sm sm:grid-cols-3">
              <Link
                href="/admin/moderation"
                className="flex flex-wrap justify-between gap-2"
              >
                <span>إعلانات تنتظر المراجعة</span>
                <strong>{number(pending)}</strong>
              </Link>
              <Link
                href="/admin/moderation"
                className="flex flex-wrap justify-between gap-2"
              >
                <span>أدلة لم يكتمل حفظها</span>
                <strong>{number(incomplete)}</strong>
              </Link>
              <Link
                href="/admin/commissions"
                className="flex flex-wrap justify-between gap-2"
              >
                <span>عمولات مستحقة</span>
                <strong>{number(due?.count ?? 0)}</strong>
              </Link>
            </div>
          </section>
          {calendar ? (
            <WorkspaceCalendar data={data} />
          ) : (
            <>
              <WorkspaceCharts data={data} />
              <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                <StatusDistribution
                  title="توزيع حالات الإعلانات"
                  rows={data.listings}
                  labels={listingLabels}
                  href={(status) =>
                    `/admin/listings?status=${encodeURIComponent(status)}`
                  }
                  source="المصدر: الإعلانات المسجلة في قاعدة البيانات"
                  empty="لا توجد إعلانات مسجلة."
                />
                <StatusDistribution
                  title="اكتمال حفظ الأدلة"
                  rows={data.evidence}
                  labels={evidenceLabels}
                  href={() => '/admin/moderation'}
                  source="المصدر: القضايا التي لم تُتلف أدلتها"
                  empty="لا توجد قضايا بأدلة محفوظة."
                />
              </div>
              <details className="admin-disclosure">
                <summary>تفاصيل الحالات</summary>
                <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                  <section className="admin-panel">
                    <h2 className="admin-panel-heading">
                      حالات الإعلانات الحالية
                    </h2>
                    <dl className="admin-panel-body grid gap-3 text-sm">
                      {data.listings.map((row) => (
                        <div
                          key={row.status}
                          className="flex justify-between gap-3"
                        >
                          <dt>{listingLabels[row.status] ?? row.status}</dt>
                          <dd>{number(row.count)}</dd>
                        </div>
                      ))}
                      {data.listings.length === 0 && (
                        <div>لا توجد إعلانات.</div>
                      )}
                    </dl>
                  </section>
                  <section className="admin-panel">
                    <h2 className="admin-panel-heading">حفظ الأدلة</h2>
                    <dl className="admin-panel-body grid gap-3 text-sm">
                      {data.evidence.map((row) => (
                        <div
                          key={row.status}
                          className="flex justify-between gap-3"
                        >
                          <dt>{evidenceLabels[row.status] ?? row.status}</dt>
                          <dd>{number(row.count)}</dd>
                        </div>
                      ))}
                      {data.evidence.length === 0 && (
                        <div>لا توجد قضايا بأدلة محفوظة.</div>
                      )}
                    </dl>
                  </section>
                </div>
              </details>
              <section className="admin-panel">
                <h2 className="admin-panel-heading">العمولات الحالية</h2>
                <div className="admin-panel-body overflow-x-auto">
                  <table className="w-full min-w-80 text-sm">
                    <thead>
                      <tr className="border-b text-start text-xs text-muted-foreground">
                        <th scope="col" className="pb-3 text-start">
                          الحالة
                        </th>
                        <th scope="col">العدد</th>
                        <th scope="col" className="text-end">
                          المبلغ (ر.س)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.commissions.map((row) => (
                        <tr key={row.status} className="border-b last:border-0">
                          <th
                            scope="row"
                            className="py-3 text-start font-normal"
                          >
                            {commissionLabels[row.status] ?? row.status}
                          </th>
                          <td className="text-center">{number(row.count)}</td>
                          <td className="text-end">{number(row.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.commissions.length === 0 && (
                    <p className="py-3 text-sm text-muted-foreground">
                      لا توجد عمولات.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
