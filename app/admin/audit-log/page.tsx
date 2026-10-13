'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ClipboardList, Search } from 'lucide-react';

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
  update_site_message: 'تحديث رسالة الموقع',
};

const entityLabels: Record<string, string> = {
  listing: 'إعلان', report: 'بلاغ إعلان', user_report: 'بلاغ محادثة',
  user: 'مستخدم', commission: 'رسوم', maintenance: 'صيانة', site_message: 'رسالة الموقع',
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function AdminAuditLogPage() {
  const { adminAccessNotice, verifyAdminAccess } = useAdminAccess('admin');
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [query, setQuery] = useState('');
  const [admin, setAdmin] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, hasMore: false });
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      if (!(await verifyAdminAccess())) return;
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (query.trim()) params.set('query', query.trim());
      if (admin.trim()) params.set('admin', admin.trim());
      if (action) params.set('action', action);
      if (targetType.trim()) params.set('targetType', targetType.trim());
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await fetch(`/api/admin/audit-log?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        setNotice(response.status === 403 ? 'لا تملك صلاحية عرض السجل.' : 'تعذر تحميل سجل الإدارة.');
        return;
      }
      const payload = await response.json() as {
        records: AuditRecord[];
        pagination: { total: number; hasMore: boolean };
      };
      setRecords(payload.records);
      setPagination(payload.pagination);
    } finally {
      setLoading(false);
    }
  }, [action, admin, from, page, query, targetType, to, verifyAdminAccess]);

  useEffect(() => { void loadRecords(); }, [loadRecords]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 pb-4 dark:border-slate-700/70">
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" size="icon"><Link href="/admin" aria-label="العودة" prefetch={false}><ArrowRight className="size-4" /></Link></Button>
            <ClipboardList className="size-6 text-blue-700 dark:text-blue-300" />
            <div><h1 className="font-bold">سجل الإدارة</h1><p className="text-xs text-muted-foreground">سجل تدقيق للعمليات الإدارية الحساسة</p></div>
          </div>
        </header>

        {(adminAccessNotice || notice) && <p className="text-sm text-muted-foreground">{adminAccessNotice || notice}</p>}

        <section className="grid gap-3 border-b border-slate-300/70 pb-4 dark:border-slate-700/70">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="معرف أو نوع الكيان" />
            <Input value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="المشرف: اسم أو بريد" />
            <select className="h-10 rounded-md border bg-background px-3 text-sm" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">كل العمليات</option>
              {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <Input value={targetType} onChange={(e) => setTargetType(e.target.value)} placeholder="نوع الكيان" />
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="من تاريخ" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="إلى تاريخ" />
            <Button onClick={() => { setPage(1); void loadRecords(); }}><Search className="size-4" />بحث</Button>
          </div>
        </section>

        <div className="text-xs text-muted-foreground">{new Intl.NumberFormat('ar-SA').format(pagination.total)} عملية</div>
        {loading ? <p className="py-10 text-center text-sm text-muted-foreground">جار التحميل...</p> : (
          <div className="grid divide-y divide-slate-300/70 dark:divide-slate-700/70">
            {records.map((record) => (
              <article key={record.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold">{actionLabels[record.action] ?? record.action}</h2>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{entityLabels[record.targetType] ?? record.targetType}: {record.targetId}</p>
                  <p className="mt-2 text-xs">{record.admin ? record.admin.name || record.admin.email : 'حساب إداري محذوف'}</p>
                  {Object.keys(record.metadata ?? {}).length > 0 && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-blue-700 dark:text-blue-300">عرض التفاصيل</summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-100 p-3 text-left text-[11px] leading-5 dark:bg-slate-900" dir="ltr">
                        {JSON.stringify(record.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
                <time className="text-xs text-muted-foreground" dateTime={record.createdAt}>{formatDate(record.createdAt)}</time>
              </article>
            ))}
            {!records.length && <p className="py-10 text-center text-sm text-muted-foreground">لا توجد عمليات مطابقة.</p>}
          </div>
        )}
        <div className="flex justify-between gap-2">
          <Button variant="outline" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>السابق</Button>
          <Button variant="outline" disabled={!pagination.hasMore} onClick={() => setPage((value) => value + 1)}>التالي</Button>
        </div>
      </div>
    </main>
  );
}
