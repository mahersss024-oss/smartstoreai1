'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Megaphone, RefreshCw } from 'lucide-react';

import { FloatingActionNotice } from '@/components/floating-action-notice';
import { AdminPageHeading } from '@/components/admin/page-heading';
import { useAdminRequest } from '@/components/admin/use-admin-request';
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

type SavedSiteMessage = Omit<SiteMessageDraft, 'expiresAt'> & { expiresAt: string | null };

function toDraft(message: SavedSiteMessage | null): SiteMessageDraft {
  return message ? {
    message: message.message, type: message.type, isEnabled: message.isEnabled,
    expiresAt: toLocalDateTimeInput(message.expiresAt),
  } : emptyDraft;
}

export default function AdminSiteMessagePage() {
  const { adminAccessNotice, isAdminAccessAllowed, verifyAdminAccess } = useAdminAccess('owner');
  const [siteMessage, setSiteMessage] = useState<SiteMessageDraft>(emptyDraft);
  const dirty = useRef(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const { begin: beginRequest } = useAdminRequest(isAdminAccessAllowed);

  const loadSiteMessage = useCallback(async () => {
    if (!isAdminAccessAllowed) return;
    const request = beginRequest();
    setIsLoading(true);
    setNotice('');
    try {
      if (!(await verifyAdminAccess())) return;
      if (!request.isCurrent()) return;
      const response = await fetch('/api/admin/site-message', { cache: 'no-store', signal: request.signal });
      if (!request.isCurrent()) return;
      if (!response.ok) {
        setNotice(response.status === 503
          ? 'تخزين بيانات التطبيق غير متاح حاليًا.'
          : 'تعذر تحميل رسائل التطبيق.');
        return;
      }

      const payload = await response.json() as { siteMessage: SavedSiteMessage | null };
      if (!request.isCurrent()) return;
      setHasLoaded(true);
      if (dirty.current) setNotice('تم التحديث مع الاحتفاظ بتعديلاتك غير المحفوظة.');
      else setSiteMessage(toDraft(payload.siteMessage));
    } catch {
      if (request.isCurrent()) setNotice('تعذر الاتصال لتحميل رسائل التطبيق.');
    } finally {
      if (request.isCurrent()) setIsLoading(false);
    }
  }, [isAdminAccessAllowed, beginRequest, verifyAdminAccess]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (isAdminAccessAllowed) void loadSiteMessage();
      else {
        dirty.current = false;
        setSiteMessage(emptyDraft);
        setHasLoaded(false);
        setIsLoading(false);
        setIsSaving(false);
      }
    });
    return () => { cancelled = true; };
  }, [isAdminAccessAllowed, loadSiteMessage]);

  const updateDraft = (changes: Partial<SiteMessageDraft>) => {
    dirty.current = true;
    setSiteMessage(current => ({ ...current, ...changes }));
  };

  const saveSiteMessage = async () => {
    if (!isAdminAccessAllowed || !hasLoaded || isLoading || isSaving || !siteMessage.message.trim()) return;
    const request = beginRequest();
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
      const payload = await response.json().catch(() => null) as { error?: string; siteMessage?: SavedSiteMessage } | null;
      if (!request.isCurrent()) return;
      if (!response.ok) {
        setNotice(payload?.error === 'expiration_must_be_future'
          ? 'وقت انتهاء الرسالة يجب أن يكون في المستقبل.'
          : 'تعذر حفظ رسائل التطبيق.');
        return;
      }
      if (!payload?.siteMessage) {
        setNotice('تعذر تأكيد بيانات الرسالة المحفوظة. بقيت تعديلاتك؛ حدّث البيانات للتحقق.');
        return;
      }
      dirty.current = false;
      setSiteMessage(toDraft(payload.siteMessage));
      setNotice(payload.siteMessage.isEnabled
        ? 'تم حفظ رسائل التطبيق وتفعيلها.'
        : 'تم حفظ رسائل التطبيق وإيقافها.');
    } catch {
      if (request.isCurrent()) setNotice('تعذر الاتصال لحفظ رسائل التطبيق. بقيت تعديلاتك ويمكن إعادة المحاولة.');
    } finally {
      if (request.isCurrent()) setIsSaving(false);
    }
  };
  const fieldsDisabled = !isAdminAccessAllowed || !hasLoaded || isLoading || isSaving;

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء رسائل التطبيق"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <div className="admin-page">
        <AdminPageHeading title="رسائل التطبيق" />
        {adminAccessNotice && (
          <p role="status" className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice}
          </p>
        )}

        <section className="admin-section grid gap-4" hidden={!isAdminAccessAllowed} aria-busy={isLoading || isSaving}>
          <div className="flex items-start gap-3">
            <Megaphone className="mt-0.5 size-5 text-blue-700 dark:text-blue-300" />
            <div>
              <h2 className="text-sm font-bold">رسائل التطبيق</h2>
              <p className="mt-1 text-xs text-muted-foreground">رسالة عامة تظهر داخل التطبيق دون إيقاف عمله.</p>
            </div>
          </div>

          <Textarea
            disabled={fieldsDisabled}
            value={siteMessage.message}
            onChange={(event) => updateDraft({ message: event.target.value })}
            maxLength={500}
            placeholder="اكتب رسالة واضحة ومختصرة"
            aria-label="نص رسائل التطبيق"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              نوع الرسالة
              <select
                disabled={fieldsDisabled}
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={siteMessage.type}
                onChange={(event) => updateDraft({ type: event.target.value as SiteMessageDraft['type'] })}
              >
                <option value="info">معلومة</option>
                <option value="warning">تنبيه</option>
                <option value="maintenance">صيانة</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              وقت الانتهاء الاختياري
              <Input
                disabled={fieldsDisabled}
                type="datetime-local"
                value={siteMessage.expiresAt}
                onChange={(event) => updateDraft({ expiresAt: event.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              disabled={fieldsDisabled}
              type="checkbox"
              checked={siteMessage.isEnabled}
              onChange={(event) => updateDraft({ isEnabled: event.target.checked })}
            />
            تفعيل رسائل التطبيق
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button className="w-fit" disabled={fieldsDisabled || !siteMessage.message.trim()} onClick={() => void saveSiteMessage()}>
              {isSaving ? 'جارٍ الحفظ…' : 'حفظ رسائل التطبيق'}
            </Button>
            <Button variant="outline" className="w-fit" disabled={!isAdminAccessAllowed || isLoading || isSaving} onClick={() => void loadSiteMessage()}>
              <RefreshCw className="size-4" /> تحديث
            </Button>
            {isLoading && <span role="status" className="text-xs text-muted-foreground">جارٍ تحميل الإعداد الحالي…</span>}
          </div>
        </section>
      </div>
    </main>
  );
}
