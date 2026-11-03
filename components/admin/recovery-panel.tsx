'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { Button } from '@ui/button';
import { useAdminAccess } from '@/app/admin/use-admin-access';
import { useAuthSession } from '@/hooks/use-auth-session';

const endpoint = '/api/admin/recovery';
type ReadStatus = 'available' | 'not_configured' | 'unavailable';
type Source = { identifier: string; status: string; engineVersion: string; retentionDays: number;
  earliestRestoreTime: string | null; latestRestoreTime: string | null };
type Snapshot = { id: string; createdAt: string; status: string };
type Target = { targetId: string; status: string; createdAt: string | null };
type MediaRun = { id: string; kind: 'backup' | 'quarantine_restore'; status: string; createdAt: string;
  objects: number; bytes: number; errors: number };
type RecoveryStatus = {
  rds: { configured: boolean; readStatus: ReadStatus; source: Source | null; snapshots: Snapshot[]; targets: Target[] };
  media: { configured: boolean; readStatus: ReadStatus; runs: MediaRun[] };
  emergencyPlanDownloadPath?: string;
};
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function number(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function readStatus(value: unknown): value is ReadStatus { return ['available', 'not_configured', 'unavailable'].includes(String(value)); }
function optionalDate(value: unknown) { return value === null || typeof value === 'string'; }
function validSource(value: unknown): value is Source {
  return object(value) && typeof value.identifier === 'string' && typeof value.status === 'string' &&
    typeof value.engineVersion === 'string' && number(value.retentionDays) &&
    optionalDate(value.earliestRestoreTime) && optionalDate(value.latestRestoreTime);
}
function validStatus(value: unknown): value is RecoveryStatus {
  if (!object(value) || !object(value.rds) || !object(value.media)) return false;
  const rds = value.rds; const media = value.media;
  return typeof rds.configured === 'boolean' && readStatus(rds.readStatus) && (rds.source === null || validSource(rds.source)) &&
    Array.isArray(rds.snapshots) && rds.snapshots.length <= 20 && rds.snapshots.every(item => object(item) &&
      typeof item.id === 'string' && typeof item.createdAt === 'string' && typeof item.status === 'string') &&
    Array.isArray(rds.targets) && rds.targets.length <= 20 && rds.targets.every(item => object(item) &&
      typeof item.targetId === 'string' && typeof item.status === 'string' && optionalDate(item.createdAt)) &&
    typeof media.configured === 'boolean' && readStatus(media.readStatus) && Array.isArray(media.runs) && media.runs.length <= 20 &&
    media.runs.every(item => object(item) && typeof item.id === 'string' && typeof item.createdAt === 'string' &&
      ['backup', 'quarantine_restore'].includes(String(item.kind)) && typeof item.status === 'string' &&
      number(item.objects) && number(item.bytes) && number(item.errors));
}
function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function count(value: number) { return new Intl.NumberFormat('ar-SA').format(value); }
function state(value: string) {
  const labels: Record<string, string> = { available: 'متاحة', creating: 'قيد التجهيز', backing_up: 'جارٍ النسخ',
    queued: 'في الانتظار', running: 'قيد التنفيذ', completed: 'مكتملة', failed: 'تحتاج مراجعة' };
  return labels[value] ?? 'غير معروفة';
}
function failure(status?: number) {
  if (status === 401) return 'انتهت جلسة الدخول. سجّل الدخول إلى الإدارة مجددًا.';
  if (status === 403) return 'هذه الصفحة متاحة لمالك المنصة فقط.';
  if (status === 429) return 'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.';
  return 'تعذّر قراءة حالة النسخ الاحتياطي. أعد المحاولة.';
}

export function RecoveryPanel() {
  const { session, verifySession } = useAuthSession();
  const { isAdminAccessAllowed } = useAdminAccess('owner');
  const ownerId = session.user?.id;
  const verifyOwner = useCallback(async () => {
    const current = await verifySession();
    return current.authenticated && current.user?.role === 'owner' && current.user.id === ownerId;
  }, [ownerId, verifySession]);
  if (!isAdminAccessAllowed || !ownerId) return null;
  return <OwnerRecoveryMonitor key={ownerId} verifyOwner={verifyOwner} />;
}

function OwnerRecoveryMonitor({ verifyOwner }: { verifyOwner: () => Promise<boolean> }) {
  const [data, setData] = useState<RecoveryStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const load = async () => {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setBusy(true); setError(''); setData(null);
    try {
      if (!(await verifyOwner())) { if (current()) setError(failure(403)); return; }
      if (!current()) return;
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) { setError(failure(response.status)); return; }
      if (!validStatus(payload)) { setError(failure()); return; }
      setData(payload);
    } catch { if (current()) setError(failure()); }
    finally { if (current()) { request.current = null; setBusy(false); } }
  };
  const downloadPlan = async () => {
    if (request.current || data?.emergencyPlanDownloadPath !== `${endpoint}?download=plan`) return;
    const controller = new AbortController(); request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setBusy(true); setError('');
    try {
      if (!(await verifyOwner())) { if (current()) { setData(null); setError(failure(403)); } return; }
      if (!current()) return;
      const response = await fetch(`${endpoint}?download=plan`, { cache: 'no-store', signal: controller.signal });
      const contents = await response.text();
      if (!current()) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setData(null);
        setError(failure(response.status)); return;
      }
      if (contents.length > 1_000_000) throw new Error();
      const plan: unknown = JSON.parse(contents);
      if (!object(plan)) throw new Error();
      const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'souqhamad-emergency-recovery-plan.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { if (current()) setError('تعذّر تنزيل خطة الطوارئ.'); }
    finally { if (current()) { request.current = null; setBusy(false); } }
  };

  return <details className="admin-section grid gap-3" data-recovery>
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold"><DatabaseBackup className="size-4" />حالة النسخ الاحتياطي</summary>
    <div className="mt-3 grid min-w-0 gap-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className="size-4" />تحديث حالة الاسترجاع</Button>
        {data?.emergencyPlanDownloadPath === `${endpoint}?download=plan` && <Button size="sm" variant="outline" disabled={busy} onClick={() => void downloadPlan()}><Download className="size-4" />تنزيل خطة الطوارئ</Button>}
      </div>
      <p className="text-xs text-muted-foreground">عرض حالة النسخ فقط. تُدار الاستعادة من AWS.</p>
      {busy && <p role="status" className="text-xs text-muted-foreground">جارٍ قراءة بيانات النسخ الاحتياطي...</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</p>}
      {data && <>
        <section className="grid gap-3 rounded-md border p-3" aria-label="نسخ قاعدة البيانات">
          <h3 className="font-bold">قاعدة البيانات</h3>
          {data.rds.source ? <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">المصدر</dt><dd><bdi className="break-all">{data.rds.source.identifier}</bdi></dd></div>
            <div><dt className="text-muted-foreground">الإصدار</dt><dd><bdi>{data.rds.source.engineVersion}</bdi></dd></div>
            <div><dt className="text-muted-foreground">الاحتفاظ التلقائي</dt><dd>{count(data.rds.source.retentionDays)} أيام</dd></div>
            <div><dt className="text-muted-foreground">آخر وقت متاح</dt><dd>{date(data.rds.source.latestRestoreTime)}</dd></div>
            <div><dt className="text-muted-foreground">أقدم وقت متاح</dt><dd>{date(data.rds.source.earliestRestoreTime)}</dd></div>
            <div><dt className="text-muted-foreground">اللقطات المعروضة</dt><dd>{count(data.rds.snapshots.length)}</dd></div>
          </dl> : <p className="text-xs text-muted-foreground">{data.rds.readStatus === 'not_configured' ? 'مراقبة RDS غير مجهزة على السيرفر.' : 'تعذّرت قراءة حالة RDS. أعد تحديث الحالة.'}</p>}
          {data.rds.snapshots.length > 0 && <div className="grid gap-2 border-t pt-3"><h4 className="text-xs font-bold">النسخ المحفوظة</h4>{data.rds.snapshots.map(item => <div key={item.id} className="grid min-w-0 gap-1 rounded-md border p-2 text-xs">
            <bdi className="break-all">{item.id}</bdi><p>{date(item.createdAt)} — {state(item.status)}</p>
          </div>)}</div>}
          {data.rds.targets.length > 0 && <div className="grid gap-2 border-t pt-3"><h4 className="text-xs font-bold">قواعد الاستعادة المنفصلة</h4>{data.rds.targets.map(item => <div key={item.targetId} className="grid min-w-0 gap-1 rounded-md border p-2 text-xs">
            <bdi className="break-all">{item.targetId}</bdi><p>{date(item.createdAt)} — {state(item.status)}</p>
          </div>)}</div>}
        </section>
        <section className="grid gap-3 rounded-md border p-3" aria-label="حالة نسخ الملفات">
          <h3 className="font-bold">نسخ الصور والأدلة</h3>
          <p className="text-xs text-muted-foreground">{data.media.readStatus === 'available'
            ? data.media.runs.length ? 'آخر المهام المسجلة:' : 'لا توجد مهام نسخ مسجلة.'
            : data.media.readStatus === 'not_configured' ? 'مراقبة نسخ الملفات غير مجهزة.' : 'تعذّرت قراءة حالة نسخ الملفات.'}</p>
          {data.media.runs.map(item => <div key={item.id} className="grid min-w-0 gap-1 rounded-md border p-2 text-xs">
            <p>{item.kind === 'backup' ? 'نسخ ملفات' : 'استعادة إلى العزل'} — {state(item.status)}</p>
            <bdi className="break-all">{item.id}</bdi><p>{date(item.createdAt)}</p>
            <p>{count(item.objects)} ملف — {count(item.bytes)} بايت — {count(item.errors)} ملاحظة</p>
          </div>)}
        </section>
      </>}
    </div>
  </details>;
}
