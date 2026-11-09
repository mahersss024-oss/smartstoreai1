'use client';

import { AdminPageHeading } from '@/components/admin/page-heading';
import { RecordDetails, TechnicalDetails } from '@/components/admin/record-details';
import { useAdminRequest } from '@/components/admin/use-admin-request';

import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';

import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '../use-admin-access';

type AuditRecord = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  admin: { id: string; name: string | null; email: string } | null;
};

const actionLabels: Record<string, string> = {
  manage_evidence: 'إدارة أدلة قضية',
  approve_listing: 'نشر أو تعديل إعلان',
  update_listing: 'تعديل حالة أو بيانات إعلان',
  reject_listing: 'رفض أو إيقاف إعلان',
  delete_listing: 'حذف إعلان',
  review_report: 'معالجة بلاغ',
  dismiss_report: 'إغلاق أو حذف بلاغ',
  update_commission: 'تحديث رسوم المنصة',
  update_user: 'تحديث مستخدم أو صلاحية',
  delete_user: 'حذف مستخدم',
  warn_user: 'تحذير مستخدم',
  restrict_conversation: 'تقييد محادثة',
  maintenance_cleanup: 'تنظيف وصيانة',
  update_site_message: 'تحديث رسائل التطبيق',
};

const entityLabels: Record<string, string> = {
  evidence_case: 'أدلة قضية',
  listing: 'إعلان', report: 'بلاغ إعلان', user_report: 'بلاغ محادثة',
  user: 'مستخدم', commission: 'رسوم', maintenance: 'صيانة', site_message: 'رسائل التطبيق',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value));
}

export default function AdminAuditLogPage() {
  const { adminAccessNotice, isAdminAccessAllowed, verifyAdminAccess } = useAdminAccess('admin');
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [query, setQuery] = useState('');
  const [admin, setAdmin] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState({ query: '', admin: '', action: '', targetType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const { begin: beginLoad } = useAdminRequest(isAdminAccessAllowed, JSON.stringify([filters, page]));

  const loadRecords = useCallback(async () => {
    const request = beginLoad();
    setLoading(true);
    setNotice('');
    try {
      if (!(await verifyAdminAccess()) || !request.isCurrent()) return;
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      for (const key of ['query', 'admin', 'action', 'targetType', 'from', 'to'] as const) {
        if (filters[key].trim()) params.set(key, filters[key].trim());
      }
      const response = await fetch(`/api/admin/audit-log?${params}`, { cache: 'no-store', signal: request.signal });
      if (!request.isCurrent()) return;
      if (!response.ok) {
        setNotice(response.status === 403 ? 'لا تملك صلاحية عرض السجل.' : response.status === 400 ? 'اختر نطاق تاريخ صحيحًا بتوقيت السعودية.' : 'تعذر تحميل سجل الإدارة.');
        return;
      }
      const payload = await response.json() as {
        records: AuditRecord[];
        pagination: { total: number; hasMore: boolean };
      };
      if (!request.isCurrent()) return;
      setRecords(payload.records);
      setPagination(payload.pagination);
    } catch {
      if (request.isCurrent()) setNotice('تعذر الاتصال لتحميل سجل الإدارة. حاول مجددًا.');
    } finally {
      if (request.isCurrent()) setLoading(false);
    }
  }, [filters, page, verifyAdminAccess, beginLoad]);

  useEffect(() => {
    if (isAdminAccessAllowed) { void loadRecords(); return; }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setRecords([]); setPagination({ total: 0, hasMore: false }); } });
    return () => { cancelled = true; };
  }, [isAdminAccessAllowed, loadRecords]);

  if (!isAdminAccessAllowed) return <main dir="rtl"><div className="admin-page"><AdminPageHeading title="سجل الإدارة" /><p role="status">{adminAccessNotice || 'جارٍ التحقق من الصلاحية…'}</p></div></main>;

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="admin-page">
        <AdminPageHeading title="سجل الإدارة" />

        {(adminAccessNotice || notice) && <p className="text-sm text-muted-foreground">{adminAccessNotice || notice}</p>}

        <section className="admin-filterbar">
          <form className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" onSubmit={event => {
            event.preventDefault();
            const next = { query, admin, action, targetType, from, to };
            if (page === 1 && JSON.stringify(next) === JSON.stringify(filters)) void loadRecords();
            else { setPage(1); setFilters(next); }
          }}>
            <Input aria-label="معرف أو نوع الكيان" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="معرف أو نوع الكيان" />
            <Input aria-label="المشرف: اسم أو بريد" value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="المشرف: اسم أو بريد" />
            <select aria-label="نوع العملية" className="h-10 rounded-md border bg-background px-3 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">كل العمليات</option>
              {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Input aria-label="نوع الكيان" value={targetType} onChange={(e) => setTargetType(e.target.value)} placeholder="نوع الكيان" />
            <label className="admin-field">من تاريخ (توقيت السعودية)<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="admin-field">إلى تاريخ (توقيت السعودية)<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            <Button type="submit"><Search className="size-4" />بحث</Button>
          </form>
        </section>

        <div className="min-h-4 text-xs text-muted-foreground">{new Intl.NumberFormat('ar-SA').format(pagination.total)} عملية</div>
        <div className="relative grid min-h-[22rem] content-start divide-y divide-slate-300/70 dark:divide-slate-700/70" aria-busy={loading}>
          {loading ? (
            <>
              {Array.from({ length: 4 }, (_, index) => (
                <article
                  aria-hidden="true"
                  className="grid min-h-[7.5rem] gap-2 py-4 opacity-0 sm:grid-cols-[1fr_auto] sm:items-start"
                  key={`audit-log-loading-${index}`}
                >
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold">تحميل سجل الإدارة</h2>
                    <p className="mt-1 break-all text-xs text-muted-foreground">listing: loading-placeholder</p>
                    <p className="mt-2 text-xs">admin@example.com</p>
                    <div className="mt-3 text-xs">
                      <span className="cursor-pointer text-blue-700 dark:text-blue-300">عرض التفاصيل</span>
                    </div>
                  </div>
                  <time className="text-xs text-muted-foreground">١٣ أكتوبر ٢٠٢٦، ٨:٠٠ ص</time>
                </article>
              ))}
            </>
          ) : (
            <>
            {records.map((record) => (
              <article key={record.id} className="grid min-h-[7.5rem] gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <h2 className="min-h-5 text-sm font-bold">{actionLabels[record.action] ?? record.action}</h2>
                  <p className="mt-1 min-h-4 text-xs text-muted-foreground">{entityLabels[record.targetType] ?? record.targetType}</p>
                  <TechnicalDetails title="معرّف السجل" value={{ targetId: record.targetId, targetType: record.targetType }} />
                  <p className="mt-2 min-h-4 text-xs">{record.admin ? record.admin.name || record.admin.email : 'حساب إداري محذوف'}</p>
                  {Object.keys(record.metadata ?? {}).length > 0 && (
                    <details className="mt-3 min-h-4 text-xs">
                      <summary className="cursor-pointer text-blue-700 dark:text-blue-300">عرض التفاصيل</summary>
                      <div className="mt-3"><RecordDetails value={record.metadata} /></div>
                    </details>
                  )}
                </div>
                <time className="min-h-4 text-xs text-muted-foreground" dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
              </article>
            ))}
            {!records.length && <p className="py-10 text-center text-sm text-muted-foreground">لا توجد عمليات مطابقة.</p>}
            </>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={loading || page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</Button>
          <Button variant="outline" disabled={loading || !pagination.hasMore} onClick={() => setPage((value) => value + 1)}>التالي</Button>
        </div>
      </div>
    </main>
  );
}
