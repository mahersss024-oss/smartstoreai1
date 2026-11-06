'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, RefreshCw } from 'lucide-react';

import { FloatingActionNotice } from '@/components/floating-action-notice';
import { AdminPageHeading } from '@/components/admin/page-heading';
import { useAdminAccess } from '@/app/admin/use-admin-access';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { Textarea } from '@ui/textarea';
import { toLocalDateTimeInput } from '@/lib/datetime-local';

type SiteMessageDraft = {
  message: string;
  type: 'info' | 'warning' | 'maintenance';
  isEnabled: boolean;
  expiresAt: string;
};

const emptyDraft: SiteMessageDraft = {
  message: '',
  type: 'info',
  isEnabled: false,
  expiresAt: '',
};

export default function AdminSiteMessagePage() {
  const { adminAccessNotice, verifyAdminAccess } = useAdminAccess('owner');
  const [siteMessage, setSiteMessage] = useState<SiteMessageDraft>(emptyDraft);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const loadSiteMessage = useCallback(async () => {
    setIsLoading(true);
    try {
      if (!(await verifyAdminAccess())) return;
      const response = await fetch('/api/admin/site-message', { cache: 'no-store' });
      if (!response.ok) {
        setNotice(response.status === 503
          ? 'تخزين بيانات الموقع غير متاح حاليًا.'
          : 'تعذر تحميل رسالة الموقع.');
        return;
      }

      const payload = await response.json() as {
        siteMessage: {
          message: string;
          type: SiteMessageDraft['type'];
          isEnabled: boolean;
          expiresAt: string | null;
        } | null;
      };
      if (!payload.siteMessage) {
        setSiteMessage(emptyDraft);
        return;
      }
      setSiteMessage({
        message: payload.siteMessage.message,
        type: payload.siteMessage.type,
        isEnabled: payload.siteMessage.isEnabled,
        expiresAt: toLocalDateTimeInput(payload.siteMessage.expiresAt),
      });
    } catch {
      setNotice('تعذر الاتصال لتحميل رسالة الموقع.');
    } finally {
      setIsLoading(false);
    }
  }, [verifyAdminAccess]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void loadSiteMessage();
  }, [loadSiteMessage]);

  const saveSiteMessage = async () => {
    if (isSaving || !siteMessage.message.trim()) return;
    setIsSaving(true);
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
      setNotice(siteMessage.isEnabled
        ? 'تم حفظ رسالة الموقع وتفعيلها.'
        : 'تم حفظ رسالة الموقع وإيقافها.');
      await loadSiteMessage();
    } catch {
      setNotice('تعذر الاتصال لحفظ رسالة الموقع.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء رسالة الموقع"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <div className="admin-page">
        <AdminPageHeading title="رسالة الموقع" />
        {adminAccessNotice && (
          <p role="status" className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice}
          </p>
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
            aria-label="نص رسالة الموقع"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              نوع الرسالة
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={siteMessage.type}
                onChange={(event) => setSiteMessage((current) => ({ ...current, type: event.target.value as SiteMessageDraft['type'] }))}
              >
                <option value="info">معلومة</option>
                <option value="warning">تنبيه</option>
                <option value="maintenance">صيانة</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              وقت الانتهاء الاختياري
              <Input
                type="datetime-local"
                value={siteMessage.expiresAt}
                onChange={(event) => setSiteMessage((current) => ({ ...current, expiresAt: event.target.value }))}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={siteMessage.isEnabled}
              onChange={(event) => setSiteMessage((current) => ({ ...current, isEnabled: event.target.checked }))}
            />
            تفعيل الرسالة على الموقع
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="w-fit" disabled={isSaving || isLoading || !siteMessage.message.trim()} onClick={() => void saveSiteMessage()}>
              {isSaving ? 'جارٍ الحفظ…' : 'حفظ رسالة الموقع'}
            </Button>
            <Button variant="outline" className="w-fit" disabled={isLoading || isSaving} onClick={() => void loadSiteMessage()}>
              <RefreshCw className="size-4" /> تحديث
            </Button>
            {isLoading && <span role="status" className="text-xs text-muted-foreground">جارٍ تحميل الإعداد الحالي…</span>}
          </div>
        </section>
      </div>
    </main>
  );
}
