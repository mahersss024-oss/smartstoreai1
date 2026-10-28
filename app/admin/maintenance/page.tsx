'use client';

import { AdminPageHeading } from '@/components/admin/page-heading';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Megaphone, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '@ui/button';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { Input } from '@ui/input';
import { Textarea } from '@ui/textarea';
import { useAdminAccess } from '../use-admin-access';
import { DatabaseExplorer } from '@/components/admin/database-explorer';

type MaintenanceCounts = {
  deletedListings: number;
  deletedListingImages: number;
  closedReports: number;
  closedUserReports: number;
  searchStates: number;
  idempotencyKeys: number;
  modelReviews: number;
};

type CleanupScope =
  | 'closed_reports'
  | 'closed_user_reports'
  | 'search_state'
  | 'purge_deleted_listings'
  | 'old_model_reviews';

type CleanupPreview = {
  scope: CleanupScope;
  label: string;
  total: number;
  eligible: number;
  protected: number;
  reasonCounts: Record<string, number>;
  batchCount: number;
  affectedIds: Array<{ id: string; kind: string }>;
  previewToken: string;
  expiresAt: string;
};

type SiteMessageDraft = {
  message: string;
  type: 'info' | 'warning' | 'maintenance';
  isEnabled: boolean;
  expiresAt: string;
};

const cleanupScopes: Array<{
  value: CleanupScope;
  label: string;
  description: string;
}> = [
  {
    value: 'closed_reports',
    label: 'حذف بلاغات الإعلانات المغلقة',
    description: 'يحذف بلاغات الإعلانات التي تمت مراجعتها أو إغلاقها فقط.',
  },
  {
    value: 'closed_user_reports',
    label: 'حذف بلاغات المستخدمين المغلقة',
    description: 'يحذف بلاغات المستخدمين التي تمت مراجعتها أو إغلاقها فقط.',
  },
  {
    value: 'search_state',
    label: 'تنظيف ذاكرة البحث والطلبات',
    description: 'يحذف ذاكرة البحث المؤقتة ومفاتيح منع تكرار الطلبات.',
  },
  {
    value: 'purge_deleted_listings',
    label: 'حذف نهائي للإعلانات المحذوفة من العملاء',
    description:
      'يحذف الإعلانات المحذوفة الأقدم من 30 يومًا بعد استثناء القضايا والعمولات والبلاغات والمحادثات النشطة. تُدرج صورها في طابور حذف قابل لإعادة المحاولة.',
  },
  {
    value: 'old_model_reviews',
    label: 'تنظيف ملاحظات النماذج القديمة',
    description: 'يحذف ملاحظات النماذج القديمة فقط، ولا يمس سجل إجراءات الإدارة.',
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

export default function AdminMaintenancePage() {
  const router = useRouter();
  const { adminAccessNotice, verifyAdminAccess } = useAdminAccess('owner');
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [scope, setScope] = useState<CleanupScope>('closed_reports');
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [siteMessage, setSiteMessage] = useState<SiteMessageDraft>({
    message: '', type: 'info', isEnabled: false, expiresAt: '',
  });
  const [isSavingMessage, setIsSavingMessage] = useState(false);

  const selectedScope = useMemo(
    () => cleanupScopes.find((option) => option.value === scope),
    [scope],
  );
  const loadCounts = useCallback(async (selectedScope: CleanupScope) => {
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        setCounts(null);
        setPreview(null);
        return;
      }

      const response = await fetch(`/api/admin/maintenance?scope=${encodeURIComponent(selectedScope)}`, { cache: 'no-store' });

      if (response.status === 401) {
        setCounts(null);
        setPreview(null);
        router.push('/api/auth/google/start?return_to=%2Fadmin%2Fmaintenance');
        return;
      }

      if (response.status === 403) {
        setCounts(null);
        setPreview(null);
        setNotice('هذه الصفحة مخصصة للمالك فقط.');
        return;
      }

      if (!response.ok) {
        setCounts(null);
        setPreview(null);
        setNotice('تعذر تحميل أعداد الصيانة.');
        return;
      }

      const payload = (await response.json()) as { counts: MaintenanceCounts; scopes?: CleanupPreview[] };
      setCounts(payload.counts);
      setPreview(payload.scopes?.[0] ?? null);
    } catch {
      setCounts(null);
      setPreview(null);
      setNotice('تعذر تحميل معاينة الصيانة.');
    } finally {
      setIsLoading(false);
    }
  }, [router, verifyAdminAccess]);

  const loadSiteMessage = useCallback(async () => {
    const response = await fetch('/api/admin/site-message', { cache: 'no-store' });
    if (!response.ok) return;
    const payload = await response.json() as {
      siteMessage: { message: string; type: SiteMessageDraft['type']; isEnabled: boolean; expiresAt: string | null } | null;
    };
    if (!payload.siteMessage) return;
    setSiteMessage({
      message: payload.siteMessage.message,
      type: payload.siteMessage.type,
      isEnabled: payload.siteMessage.isEnabled,
      expiresAt: payload.siteMessage.expiresAt
        ? new Date(payload.siteMessage.expiresAt).toISOString().slice(0, 16)
        : '',
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadCounts(scope);
        void loadSiteMessage();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadCounts, loadSiteMessage, scope]);

  const saveSiteMessage = useCallback(async () => {
    setIsSavingMessage(true);
    setNotice('');
    try {
      const response = await fetch('/api/admin/site-message', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...siteMessage,
          expiresAt: siteMessage.expiresAt
            ? new Date(siteMessage.expiresAt).toISOString()
            : null,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setNotice(payload?.error === 'expiration_must_be_future'
          ? 'وقت انتهاء الرسالة يجب أن يكون في المستقبل.'
          : 'تعذر حفظ رسالة الموقع.');
        return;
      }
      setNotice(siteMessage.isEnabled ? 'تم حفظ رسالة الموقع وتفعيلها.' : 'تم حفظ رسالة الموقع وإيقافها.');
      await loadSiteMessage();
    } finally {
      setIsSavingMessage(false);
    }
  }, [loadSiteMessage, siteMessage]);

  const runCleanup = useCallback(async () => {
    setIsRunning(true);
    setNotice('');

    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, confirmation, reason, previewToken: preview?.previewToken }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { counts?: MaintenanceCounts; error?: string; message?: string }
        | null;

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/api/auth/google/start?return_to=%2Fadmin%2Fmaintenance');
          return;
        }

        if (payload?.error === 'preview_stale' || payload?.error === 'preview_invalid') {
          setNotice('تغيّرت البيانات بعد المعاينة. حدّث المعاينة قبل التنفيذ.');
          await loadCounts(scope);
          return;
        }

        if (payload?.error === 'invalid_cleanup_request') {
          setNotice('أدخل سببًا من 5 أحرف على الأقل، وتأكد من اختيار المعاينة الحالية.');
          return;
        }

        if (payload?.error === 'owner_required') {
          setNotice('هذه العملية مخصصة للمالك فقط.');
          return;
        }

        if (response.status === 429) {
          setNotice('طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.');
          return;
        }

        setNotice(
          payload?.message ??
            'تعذر تنفيذ عملية التنظيف. تحقق من كلمة التأكيد وحاول مجددًا.',
        );
        return;
      }

      setConfirmation('');
      setReason('');
      const deletedTotal = Object.values((payload as { deleted?: Record<string, number> }).deleted ?? {}).reduce((sum, value) => sum + value, 0);
      await loadCounts(scope);
      setNotice(`تم تنفيذ التنظيف. العناصر المتأثرة: ${formatNumber(deletedTotal)}.`);
    } finally {
      setIsRunning(false);
    }
  }, [confirmation, loadCounts, preview?.previewToken, reason, scope, router]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء الصيانة"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <div className="admin-page">
        <AdminPageHeading title="الصيانة والتنظيف" />

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="admin-section grid gap-4">
          <div className="flex items-start gap-3">
            <Megaphone className="mt-0.5 size-5 text-blue-700 dark:text-blue-300" />
            <div>
              <h2 className="text-sm font-bold">رسالة الموقع</h2>
              <p className="mt-1 text-xs text-muted-foreground">شريط عام أعلى الموقع دون إيقاف عمل المنصة.</p>
            </div>
          </div>
          <Textarea
            value={siteMessage.message}
            onChange={(event) => setSiteMessage((current) => ({ ...current, message: event.target.value }))}
            maxLength={500}
            placeholder="اكتب رسالة واضحة ومختصرة"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              نوع الرسالة
              <select className="h-10 rounded-md border bg-background px-3 text-sm" value={siteMessage.type} onChange={(event) => setSiteMessage((current) => ({ ...current, type: event.target.value as SiteMessageDraft['type'] }))}>
                <option value="info">معلومة</option>
                <option value="warning">تنبيه</option>
                <option value="maintenance">صيانة</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              وقت الانتهاء الاختياري
              <Input type="datetime-local" value={siteMessage.expiresAt} onChange={(event) => setSiteMessage((current) => ({ ...current, expiresAt: event.target.value }))} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={siteMessage.isEnabled} onChange={(event) => setSiteMessage((current) => ({ ...current, isEnabled: event.target.checked }))} />
            تفعيل الرسالة على الموقع
          </label>
          <Button className="w-fit" disabled={isSavingMessage || !siteMessage.message.trim()} onClick={() => void saveSiteMessage()}>
            حفظ رسالة الموقع
          </Button>
        </section>

        <DatabaseExplorer />

        <section className="admin-section admin-danger-zone grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">تنفيذ تنظيف</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                المعاينة تعرض أول دفعة محددة. السجلات المحمية مستثناة. اكتب السبب وكلمة التأكيد قبل التنفيذ.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              disabled={isLoading}
              onClick={() => void loadCounts(scope)}
            >
              <RefreshCw className="size-4" />
              تحديث المعاينة
            </Button>
          </div>

          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="cleanupScope"
            value={scope}
            onChange={(event) => {
              const nextScope = event.target.value as CleanupScope;
              setScope(nextScope);
              setConfirmation('');
              setPreview(null);
              void loadCounts(nextScope);
            }}
          >
            {cleanupScopes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{selectedScope?.description}</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">جار حساب أثر العملية...</p>
            ) : counts && preview ? (
              <div className="grid gap-1.5 border-r-2 border-red-500/40 pr-3">
                <p>الإجمالي: <strong>{formatNumber(preview.total)}</strong></p>
                <p>المؤهل للحذف: <strong>{formatNumber(preview.eligible)}</strong></p>
                <p>المحمي أو الحديث: <strong>{formatNumber(preview.protected)}</strong></p>
                <p>عدد العناصر في هذه الدفعة: <strong>{formatNumber(preview.batchCount)}</strong> من أصل حد 50.</p>
                <p className="text-xs text-muted-foreground">تنتهي المعاينة: {new Date(preview.expiresAt).toLocaleString('ar-SA')}</p>
                {Object.entries(preview.reasonCounts).length > 0 && (
                  <p className="text-xs text-muted-foreground">أسباب الاستثناء: {Object.entries(preview.reasonCounts).map(([key, value]) => `${key}: ${formatNumber(value)}`).join('، ')}</p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold">عرض العناصر المحددة لهذه الدفعة ({formatNumber(preview.affectedIds.length)})</summary>
                  <ul className="mt-2 max-h-44 overflow-auto rounded-md border p-2 text-xs" dir="ltr">
                    {preview.affectedIds.map((item) => <li key={`${item.kind}:${item.id}`}>{item.kind}: {item.id}</li>)}
                  </ul>
                </details>
              </div>
            ) : null}
          </div>

          <label className="grid gap-1 text-sm">
            سبب التنظيف (يسجل في سجل الإدارة)
            <Input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={500} placeholder="اكتب سببًا واضحًا" />
          </label>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              name="cleanupConfirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="اكتب: تنظيف"
            />
            <Button
              className="rounded-md bg-red-600 hover:bg-red-700"
              disabled={isRunning || isLoading || confirmation !== 'تنظيف' || reason.trim().length < 5 || !preview?.previewToken || preview.batchCount === 0}
              onClick={() => void runCleanup()}
            >
              <Trash2 className="size-4" />
              تنفيذ التنظيف
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
