'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Megaphone, RefreshCw } from 'lucide-react';
import { Button } from '@ui/button';
import { AdminPageHeading } from '@/components/admin/page-heading';
import { DatabaseExplorer } from '@/components/admin/database-explorer';
import { RecoveryPanel } from '@/components/admin/recovery-panel';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAdminAccess } from '../use-admin-access';

const countLabels = {
  deletedListings: 'الإعلانات المؤرشفة',
  deletedListingImages: 'صور الإعلانات المؤرشفة',
  closedReports: 'بلاغات الإعلانات المغلقة',
  closedUserReports: 'بلاغات المستخدمين المغلقة',
  searchStates: 'حالات البحث',
  idempotencyKeys: 'طلبات منع التكرار',
  modelReviews: 'ملاحظات المراجعة',
} as const;
type MaintenanceCounts = Record<keyof typeof countLabels, number>;
type SiteMessage = { message: string; type: 'info' | 'warning' | 'maintenance'; isEnabled: boolean; expiresAt: string | null };
function validCounts(value: unknown): value is MaintenanceCounts {
  return !!value && typeof value === 'object' && Object.keys(countLabels).every(key => {
    const count = (value as Record<string, unknown>)[key];
    return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  });
}
function validMessage(value: unknown): value is SiteMessage {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return typeof data.message === 'string' && ['info', 'warning', 'maintenance'].includes(String(data.type)) &&
    typeof data.isEnabled === 'boolean' && (data.expiresAt === null || typeof data.expiresAt === 'string');
}

export default function AdminMaintenancePage() {
  const { session, verifySession } = useAuthSession();
  const { isAdminAccessAllowed, adminAccessNotice } = useAdminAccess('owner');
  const ownerId = session.user?.id;
  const verifyOwner = useCallback(async () => {
    const current = await verifySession();
    return current.authenticated && current.user?.role === 'owner' && current.user.id === ownerId;
  }, [ownerId, verifySession]);
  useEffect(() => { document.documentElement.lang = 'ar'; document.documentElement.dir = 'rtl'; }, []);

  return <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
    <div className="admin-page">
      <AdminPageHeading title="الصيانة والمراقبة" />
      {isAdminAccessAllowed && ownerId
        ? <OwnerMaintenanceMonitor key={ownerId} verifyOwner={verifyOwner} />
        : adminAccessNotice && <p role="alert" className="admin-section text-sm text-muted-foreground">{adminAccessNotice}</p>}
    </div>
  </main>;
}

function OwnerMaintenanceMonitor({ verifyOwner }: { verifyOwner: () => Promise<boolean> }) {
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [siteMessage, setSiteMessage] = useState<SiteMessage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revoked, setRevoked] = useState(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setLoading(true); setError(''); setCounts(null); setSiteMessage(null);
    const deny = () => {
      setRevoked(true); setCounts(null); setSiteMessage(null);
      setError('هذه الصفحة متاحة لمالك المنصة فقط. تحقق من جلسة الدخول.');
    };
    try {
      if (!(await verifyOwner())) { if (current()) deny(); return; }
      if (!current()) return;
      const [overview, message] = await Promise.all([
        fetch('/api/admin/maintenance', { cache: 'no-store', signal: controller.signal }),
        fetch('/api/admin/site-message', { cache: 'no-store', signal: controller.signal }),
      ]);
      if (!current()) return;
      if ([overview.status, message.status].some(status => status === 401 || status === 403)) { deny(); return; }
      if (!overview.ok) throw new Error();
      const payload = await overview.json() as { counts?: unknown };
      const messagePayload = message.ok ? await message.json().catch(() => null) as { siteMessage?: unknown } | null : null;
      if (!current()) return;
      if (!validCounts(payload.counts)) throw new Error();
      setRevoked(false); setCounts(payload.counts);
      setSiteMessage(validMessage(messagePayload?.siteMessage) ? messagePayload.siteMessage : null);
    } catch { if (current()) setError('تعذّر تحميل حالة الصيانة. أعد المحاولة.'); }
    finally { if (current()) { request.current = null; setLoading(false); } }
  }, [verifyOwner]);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; request.current?.abort(); };
  }, [load]);

  return <>
    <section className="admin-section grid gap-3" aria-label="ملخص الصيانة">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2"><Activity className="mt-0.5 size-4 text-muted-foreground" /><div>
          <h2 className="text-sm font-bold">حالة البيانات</h2>
          <p className="mt-1 text-xs text-muted-foreground">مراقبة للقراءة فقط.</p>
        </div></div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className="size-4" />تحديث حالة الصيانة</Button>
      </div>
      {loading && <p role="status" className="text-xs text-muted-foreground">جارٍ قراءة حالة الصيانة...</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {counts && <dl className="grid gap-2 sm:grid-cols-2">{Object.entries(countLabels).map(([key, label]) => <div key={key} className="flex items-center justify-between gap-3 rounded-md border p-3 text-xs">
        <dt>{label}</dt><dd className="font-semibold">{new Intl.NumberFormat('ar-SA').format(counts[key as keyof MaintenanceCounts])}</dd>
      </div>)}</dl>}
    </section>
    {!revoked && <>
      {siteMessage && <section className="admin-section grid gap-2" aria-label="رسالة الموقع الحالية">
        <div className="flex items-center gap-2"><Megaphone className="size-4 text-muted-foreground" /><h2 className="text-sm font-bold">رسالة الموقع الحالية</h2></div>
        <p className="text-xs text-muted-foreground">الحالة: {siteMessage.isEnabled ? 'مفعلة' : 'متوقفة'}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{siteMessage.message || 'لا توجد رسالة.'}</p>
      </section>}
      <DatabaseExplorer />
      <RecoveryPanel />
    </>}
  </>;
}
