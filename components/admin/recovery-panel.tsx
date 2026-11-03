'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Download, RefreshCw } from 'lucide-react';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '@/app/admin/use-admin-access';
import { useAuthSession } from '@/hooks/use-auth-session';
import { normalizeMaintenanceConfirmation } from '@/lib/admin/maintenance-confirmation';
import { toLocalDateTimeInput } from '@/lib/datetime-local';
import type { RecoveryOperation, RecoveryPreview, RecoveryRdsStatus, RestoredDatabaseReport } from '@/lib/recovery/types';
import type { RecoveryMediaRun, RecoveryMediaStatus } from '@/lib/recovery/media';

const endpoint = '/api/admin/recovery';
const restorePhrase = 'استعادة نسخة منفصلة';
const mediaPhrase = 'استعادة ملفات إلى العزل';
type RecoveryStatus = { rds: RecoveryRdsStatus; media: RecoveryMediaStatus;
  capabilities: { databaseRestore: boolean; mediaBackup: boolean; mediaRestore: boolean; databaseVerify: boolean };
  emergencyPlanDownloadPath: string; requiredConfiguration?: string[] };
type Failure = { error?: string; missingConfiguration?: string[] };

function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'غير متاح';
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
function count(value: number) { return new Intl.NumberFormat('ar-SA').format(value); }
function previewHasExpired(expiresAt: string) { return Date.parse(expiresAt) <= Date.now(); }
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function nonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string'); }
function validMediaRun(value: unknown): value is RecoveryMediaRun {
  return object(value) && typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) &&
    ['backup', 'quarantine_restore'].includes(String(value.kind)) && ['queued', 'running', 'completed', 'failed'].includes(String(value.status)) &&
    typeof value.createdAt === 'string' && nonnegative(value.objects) && nonnegative(value.bytes) && nonnegative(value.errors);
}
function validReport(value: unknown): value is RestoredDatabaseReport {
  if (!object(value) || !object(value.migrations) || !object(value.schema)) return false;
  const migrations = value.migrations;
  return ['passed', 'attention'].includes(String(value.status)) && typeof value.checkedAt === 'string' &&
    typeof value.tlsVerified === 'boolean' && typeof value.readOnly === 'boolean' &&
    nonnegative(migrations.expected) && nonnegative(migrations.applied) &&
    ['pending', 'unknown', 'failed', 'checksumMismatch'].every(key => strings(migrations[key])) &&
    nonnegative(value.schema.tablesChecked) && strings(value.schema.issues) &&
    Array.isArray(value.counts) && value.counts.every(row => object(row) && typeof row.table === 'string' && nonnegative(row.rows)) &&
    Array.isArray(value.foreignKeys) && value.foreignKeys.every(row => object(row) && typeof row.relation === 'string' && nonnegative(row.orphanRows)) &&
    Array.isArray(value.jobs) && value.jobs.every(row => object(row) && typeof row.kind === 'string' && nonnegative(row.pending) && nonnegative(row.failed) && nonnegative(row.expiredLease));
}
function validStatus(value: unknown): value is RecoveryStatus {
  if (!object(value) || !object(value.rds) || !object(value.media) || !object(value.capabilities)) return false;
  const capabilities = value.capabilities;
  return typeof value.rds.configured === 'boolean' && typeof value.rds.enabled === 'boolean' &&
    ['available', 'not_configured', 'unavailable'].includes(String(value.rds.readStatus)) &&
    Array.isArray(value.rds.snapshots) && Array.isArray(value.rds.targets) &&
    typeof value.media.configured === 'boolean' && Array.isArray(value.media.runs) && value.media.runs.every(validMediaRun) &&
    value.media.quarantineOnly === true && value.media.productionCutoverAllowed === false &&
    ['databaseRestore', 'databaseVerify', 'mediaBackup', 'mediaRestore'].every(key => typeof capabilities[key] === 'boolean');
}
function validPreview(value: unknown): value is RecoveryPreview {
  return object(value) && typeof value.previewToken === 'string' && !!value.previewToken &&
    typeof value.expiresAt === 'string' && Number.isFinite(Date.parse(value.expiresAt)) &&
    typeof value.targetId === 'string' && /^souqhamad-recovery-[a-f0-9]{20}$/.test(value.targetId) &&
    typeof value.operationId === 'string' && object(value.selection) && object(value.source) &&
    value.confirmation === restorePhrase && typeof value.costWarning === 'string';
}
function message(code?: string, status?: number) {
  if (status === 401) return 'انتهت جلسة الدخول. سجّل الدخول إلى الإدارة مجددًا.';
  if (status === 403) return 'هذه العملية متاحة لمالك المنصة فقط.';
  if (status === 429) return 'طلبات كثيرة. انتظر قليلًا ثم أعد المحاولة.';
  if (code && /preview|expired|stale/.test(code)) return 'انتهت المعاينة أو تغيّرت إعداداتها. اطلب معاينة جديدة.';
  if (code && /config|disabled/.test(code)) return 'راجع إعدادات الاسترجاع على السيرفر ثم حدّث الحالة.';
  return 'تعذّر إكمال الطلب. حدّث الحالة قبل المحاولة مجددًا.';
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
  return <OwnerRecoveryPanel key={ownerId} verifyOwner={verifyOwner} />;
}

function OwnerRecoveryPanel({ verifyOwner }: { verifyOwner: () => Promise<boolean> }) {
  const [data, setData] = useState<RecoveryStatus | null>(null);
  const [mode, setMode] = useState<'snapshot' | 'point_in_time'>('snapshot');
  const [snapshotId, setSnapshotId] = useState('');
  const [restoreTime, setRestoreTime] = useState('');
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [expired, setExpired] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [costAcknowledged, setCostAcknowledged] = useState(false);
  const [operation, setOperation] = useState<RecoveryOperation | null>(null);
  const [report, setReport] = useState<RestoredDatabaseReport | null>(null);
  const [mediaReason, setMediaReason] = useState('');
  const [mediaConfirmation, setMediaConfirmation] = useState('');
  const [backupId, setBackupId] = useState('');
  const [pendingMedia, setPendingMedia] = useState<{ id: string; status: string; kind: string } | null>(null);
  const [mediaUncertain, setMediaUncertain] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState<string[]>([]);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const granted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const delay = Date.parse(preview.expiresAt) - Date.now();
    if (delay <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), delay);
    return () => window.clearTimeout(timer);
  }, [preview]);

  function clearPreview() {
    setPreview(null); setExpired(false); setReason(''); setConfirmation(''); setCostAcknowledged(false);
  }
  function revoke() {
    granted.current = false;
    setData(null); clearPreview(); setOperation(null); setReport(null); setPendingMedia(null);
    setMediaReason(''); setMediaConfirmation(''); setBackupId(''); setMissing([]); setNotice(''); setMediaUncertain(false);
  }
  async function perform<T>(phase: string, body: Record<string, unknown> | null,
    accept: (payload: T) => void, uncertain = false) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    const current = () => mounted.current && request.current === controller && !controller.signal.aborted;
    setBusy(phase); setError(''); setNotice('');
    try {
      if (!(await verifyOwner())) { if (current()) { revoke(); setError(message(undefined, 403)); } return; }
      if (!current()) return;
      granted.current = true;
      const response = await fetch(endpoint, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const payload = await response.json().catch(() => null) as T & Failure;
      if (!current() || !granted.current) return;
      if (response.status === 401 || response.status === 403) { revoke(); setError(message(payload?.error, response.status)); return; }
      if (!response.ok) {
        setMissing(Array.isArray(payload?.missingConfiguration) ? payload.missingConfiguration.filter(name => /^[A-Z][A-Z0-9_]{1,100}$/.test(name)) : []);
        if (uncertain) { clearPreview(); if (phase.startsWith('media-')) { setMediaUncertain(true); setMediaReason(''); setMediaConfirmation(''); } }
        setError(message(payload?.error, response.status)); return;
      }
      accept(payload);
    } catch {
      if (current()) {
        if (uncertain) { clearPreview(); if (phase.startsWith('media-')) { setMediaUncertain(true); setMediaReason(''); setMediaConfirmation(''); } }
        setError(uncertain ? 'تعذّر تأكيد نتيجة الطلب. قد تكون العملية بدأت؛ حدّث الحالة قبل إرسال طلب جديد.' : 'تعذّر تحميل بيانات الاسترجاع. أعد المحاولة.');
      }
    } finally { if (current()) { request.current = null; setBusy(null); } }
  }
  const load = () => {
    clearPreview(); setReport(null); setMissing([]);
    return perform<unknown>('status', null, payload => {
      if (!validStatus(payload)) { setData(null); setError('تعذّر قراءة حالة الاسترجاع.'); return; }
      setData(payload);
      setMediaUncertain(false);
      const snapshots = payload.rds.snapshots.filter(item => item.status === 'available').sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      setSnapshotId(current => snapshots.some(item => item.id === current) ? current : snapshots[0]?.id ?? '');
      setMissing(payload.rds.readStatus !== 'available' || payload.media.readStatus !== 'available'
        ? (payload.requiredConfiguration ?? []).filter(name => /^[A-Z][A-Z0-9_]{1,100}$/.test(name)) : []);
    });
  };
  const previewRestore = () => {
    if (!data?.capabilities.databaseRestore || busy || (mode === 'snapshot' ? !snapshotId : !restoreTime)) return;
    clearPreview(); setOperation(null); setReport(null);
    return perform<{ preview?: unknown } & RecoveryPreview>('preview', {
      action: 'preview_restore', mode,
      ...(mode === 'snapshot' ? { snapshotId } : { restoreTime: new Date(restoreTime).toISOString() }),
    }, payload => {
      const selected = payload.preview ?? payload;
      if (!validPreview(selected)) { setError('تعذّر قراءة المعاينة. لم يبدأ إنشاء قاعدة.'); return; }
      setPreview(selected); setExpired(Date.parse(selected.expiresAt) <= Date.now());
    });
  };
  const executeRestore = async () => {
    if (!data?.capabilities.databaseRestore || !preview || busy || expired || previewHasExpired(preview.expiresAt) ||
      normalizeMaintenanceConfirmation(confirmation) !== restorePhrase || reason.trim().length < 5 || !costAcknowledged) return;
    const payload = { action: 'restore_database', previewToken: preview.previewToken, confirmation: restorePhrase, reason: reason.trim(), costAcknowledged: true };
    return perform<RecoveryOperation>('restore', payload, result => {
      clearPreview();
      if (!result || typeof result.operationId !== 'string' || result.targetId !== preview.targetId || typeof result.status !== 'string') {
        setError('تعذّر تأكيد نتيجة الاستعادة. حدّث الحالة قبل إرسال طلب جديد.'); return;
      }
      setOperation(result); setNotice('بدأ إنشاء قاعدة منفصلة. حدّث الحالة لمتابعتها.');
    }, true);
  };
  const verify = (targetId: string) => perform<RestoredDatabaseReport>('verify', { action: 'verify_database', targetId }, result => {
    if (!validReport(result) || result.targetId !== targetId) {
      setError('تعذّر قراءة تقرير فحص النسخة.'); return;
    }
    setReport(result); setNotice(result.status === 'passed' ? 'نجح فحص القاعدة المنفصلة.' : 'اكتمل الفحص وتوجد ملاحظات تحتاج مراجعة.');
  });
  const mediaAction = (restore: boolean) => {
    if (busy || mediaUncertain || mediaReason.trim().length < 5 || !data || (restore ? !data.capabilities.mediaRestore || !backupId ||
      normalizeMaintenanceConfirmation(mediaConfirmation) !== mediaPhrase : !data.capabilities.mediaBackup)) return;
    return perform<RecoveryMediaRun>(restore ? 'media-restore' : 'media-backup', {
      action: restore ? 'restore_media' : 'start_media_backup', requestId: crypto.randomUUID(), reason: mediaReason.trim(),
      ...(restore ? { backupId, confirmation: mediaPhrase } : {}),
    }, result => {
      setMediaReason(''); setMediaConfirmation('');
      if (!validMediaRun(result)) { setMediaUncertain(true); setError('تعذّر تأكيد مهمة الملفات. حدّث الحالة.'); return; }
      setPendingMedia({ id: result.id, status: result.status, kind: restore ? 'quarantine_restore' : 'backup' });
      setNotice(restore ? 'أُضيفت مهمة استعادة الملفات إلى العزل.' : 'أُضيفت مهمة نسخ الملفات.');
    }, true);
  };
  const mediaRefresh = (operationId: string, kind: 'backup' | 'quarantine_restore') => perform<RecoveryMediaRun>('media-status', { action: 'media_status', operationId, kind }, result => {
    if (!validMediaRun(result) || result.id !== operationId) { setError('تعذّر قراءة حالة مهمة الملفات.'); return; }
    setPendingMedia({ id: result.id, status: result.status, kind: result.kind });
    setData(current => current ? { ...current, media: { ...current.media, runs: [result, ...current.media.runs.filter(item => item.id !== result.id)] } } : null);
  });
  async function downloadPlan() {
    if (request.current || data?.emergencyPlanDownloadPath !== `${endpoint}?download=plan`) return;
    const controller = new AbortController(); request.current = controller; setBusy('download'); setError('');
    try {
      if (!(await verifyOwner())) { if (mounted.current) { revoke(); setError(message(undefined, 403)); } return; }
      if (!mounted.current || controller.signal.aborted) return;
      const response = await fetch(`${endpoint}?download=plan`, { cache: 'no-store', signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (response.status === 401 || response.status === 403) { revoke(); setError(message(undefined, response.status)); return; }
      if (!response.ok) throw new Error();
      const contents = await response.text();
      if (!mounted.current || controller.signal.aborted) return;
      if (contents.length > 1_000_000) throw new Error();
      const json = JSON.parse(contents);
      if (!object(json)) throw new Error();
      const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'souqhamad-emergency-recovery-plan.json'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { if (mounted.current && !controller.signal.aborted) setError('تعذّر تنزيل خطة الطوارئ.'); }
    finally { if (mounted.current && request.current === controller) { request.current = null; setBusy(null); } }
  }

  const availableSnapshots = data?.rds.snapshots.filter(item => item.status === 'available') ?? [];
  const availableBackups = data?.media.runs.filter(item => item.kind === 'backup' && item.status === 'completed') ?? [];
  const targets = [...(data?.rds.targets ?? [])];
  if (operation && !targets.some(item => item.targetId === operation.targetId)) targets.unshift({ ...operation, createdAt: null });
  const canRestore = !!preview && !expired && !busy && reason.trim().length >= 5 && costAcknowledged &&
    normalizeMaintenanceConfirmation(confirmation) === restorePhrase;
  return <details className="admin-section grid gap-3" data-recovery>
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold"><DatabaseBackup className="size-4" />النسخ والاسترجاع</summary>
    <div className="mt-3 grid min-w-0 gap-4 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void load()}><RefreshCw className="size-4" />تحديث حالة الاسترجاع</Button>
        {data?.emergencyPlanDownloadPath === `${endpoint}?download=plan` && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void downloadPlan()}><Download className="size-4" />تنزيل خطة الطوارئ</Button>}
      </div>
      <p className="text-xs text-muted-foreground">تُنشأ قاعدة جديدة ونسخة ملفات معزولة. لا يتغير اتصال التطبيق بقاعدة الإنتاج.</p>
      {busy && <p role="status" className="text-xs text-muted-foreground">{busy === 'status' ? 'جارٍ قراءة حالة الاسترجاع...' : busy === 'preview' ? 'جارٍ إعداد معاينة الاستعادة...' : busy === 'verify' ? 'جارٍ فحص القاعدة المنفصلة...' : 'جارٍ إرسال الطلب...'}</p>}
      {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-xs text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md border p-3 text-xs">{notice}</p>}
      {missing.length > 0 && <div className="rounded-md border p-3 text-xs"><p>إعدادات السيرفر المطلوبة:</p><ul dir="ltr" className="mt-1 break-all">{missing.map(name => <li key={name}>{name}</li>)}</ul></div>}
      {data && <>
        <section className="grid gap-3 rounded-md border p-3" aria-label="نسخ قاعدة البيانات">
          <h3 className="font-bold">قاعدة البيانات</h3>
          {data.rds.source ? <div className="grid gap-1 text-xs sm:grid-cols-2">
            <p>المصدر: <bdi className="break-all">{data.rds.source.identifier}</bdi></p><p>الإصدار: <bdi>{data.rds.source.engineVersion}</bdi></p>
            <p>الاحتفاظ التلقائي: {count(data.rds.source.retentionDays)} أيام</p><p>آخر وقت متاح: {date(data.rds.source.latestRestoreTime)}</p>
            <p>النسخ المحفوظة المتاحة: {count(availableSnapshots.length)}</p>
          </div> : <p className="text-xs text-muted-foreground">{data.rds.readStatus === 'not_configured' ? 'إعدادات RDS غير مكتملة على السيرفر.' : 'تعذّرت قراءة حالة RDS. راجع صلاحيات الخدمة ثم حدّث الحالة.'}</p>}
          {data.capabilities.databaseRestore ? <>
            <label className="grid gap-1 text-xs">مصدر الاستعادة<select className="h-9 w-full min-w-0 rounded-md border bg-background px-2" aria-label="مصدر الاستعادة" value={mode} disabled={!!busy} onChange={event => { setMode(event.target.value as typeof mode); clearPreview(); }}>
              <option value="snapshot">نسخة محفوظة</option><option value="point_in_time">وقت محدد</option>
            </select></label>
            {mode === 'snapshot' ? <label className="grid gap-1 text-xs">النسخة المحفوظة<select className="h-9 w-full min-w-0 rounded-md border bg-background px-2" aria-label="النسخة المحفوظة" value={snapshotId} disabled={!!busy} onChange={event => { setSnapshotId(event.target.value); clearPreview(); }}>
              {!availableSnapshots.length && <option value="">لا توجد نسخة متاحة</option>}{availableSnapshots.map(item => <option key={item.id} value={item.id}>{date(item.createdAt)} — {item.id}</option>)}
            </select></label> : <label className="grid gap-1 text-xs">وقت الاستعادة<Input type="datetime-local" name="recoveryTime" aria-label="وقت الاستعادة" value={restoreTime}
              min={data.rds.source?.earliestRestoreTime ? toLocalDateTimeInput(data.rds.source.earliestRestoreTime) : undefined}
              max={data.rds.source?.latestRestoreTime ? toLocalDateTimeInput(data.rds.source.latestRestoreTime) : undefined}
              disabled={!!busy} onChange={event => { setRestoreTime(event.target.value); clearPreview(); }} />
              <span className="text-muted-foreground">بتوقيت جهازك؛ الفترة المتاحة: {date(data.rds.source?.earliestRestoreTime ?? null)} إلى {date(data.rds.source?.latestRestoreTime ?? null)}.</span></label>}
            <Button size="sm" variant="outline" className="w-fit" disabled={!!busy || (mode === 'snapshot' ? !snapshotId : !restoreTime || !Number.isFinite(Date.parse(restoreTime)))} onClick={() => void previewRestore()}>معاينة استعادة قاعدة منفصلة</Button>
          </> : <p className="text-xs text-muted-foreground">إنشاء قاعدة مستعادة غير مفعّل في إعدادات السيرفر.</p>}
          {preview && <div className="grid gap-3 border-t pt-3" data-recovery-preview>
            <p className="text-xs">القاعدة الجديدة: <bdi className="break-all">{preview.targetId}</bdi></p>
            <p className="text-xs">{preview.costWarning}</p>
            <p className="text-xs text-muted-foreground">تنتهي المعاينة: {date(preview.expiresAt)}</p>
            {expired && <p role="alert" className="text-xs text-destructive">انتهت المعاينة. اطلب معاينة جديدة.</p>}
            <label className="grid gap-1 text-xs">سبب الاستعادة<Input name="recoveryReason" value={reason} maxLength={500} disabled={!!busy || expired} onChange={event => setReason(event.target.value)} /></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" name="recoveryCost" checked={costAcknowledged} disabled={!!busy || expired} onChange={event => setCostAcknowledged(event.target.checked)} />أقر بتكلفة إنشاء وتشغيل قاعدة منفصلة حتى حذفها من AWS.</label>
            <label className="grid gap-1 text-xs">اكتب «{restorePhrase}»<Input name="recoveryConfirmation" value={confirmation} disabled={!!busy || expired} onChange={event => setConfirmation(event.target.value)} /></label>
            <Button size="sm" className="w-fit" disabled={!canRestore} onClick={() => void executeRestore()}>إنشاء القاعدة المنفصلة</Button>
          </div>}
          {targets.length > 0 && <div className="grid gap-2 border-t pt-3"><h4 className="text-xs font-bold">قواعد الاستعادة المنفصلة</h4>{targets.map(target => <div key={target.targetId} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs">
            <div className="min-w-0"><bdi className="break-all">{target.targetId}</bdi><p>الحالة: <bdi>{target.status}</bdi></p></div>
            {data.capabilities.databaseVerify && <Button size="sm" variant="outline" disabled={!!busy || target.status !== 'available'} onClick={() => { setReport(null); void verify(target.targetId); }}>فحص النسخة</Button>}
          </div>)}</div>}
          {report && <div className="grid gap-2 rounded-md border p-3 text-xs" data-recovery-report>
            <p className="font-bold">{report.status === 'passed' ? 'نجح فحص النسخة' : 'تقرير الفحص يحتاج مراجعة'}</p>
            <p>الفحص: {date(report.checkedAt)} — اتصال مشفر: {report.tlsVerified ? 'نعم' : 'غير مؤكد'} — قراءة فقط: {report.readOnly ? 'نعم' : 'غير مؤكد'}</p>
            <p>الترحيلات: {count(report.migrations.applied)} من {count(report.migrations.expected)} — الجداول المفحوصة: {count(report.schema.tablesChecked)}</p>
            <p>ملاحظات المخطط: {count(report.schema.issues.length)} — علاقات بها صفوف يتيمة: {count(report.foreignKeys.filter(item => item.orphanRows > 0).length)}</p>
            <p>ترحيلات معلّقة: {count(report.migrations.pending.length)} — فاشلة: {count(report.migrations.failed.length)} — بصمات مختلفة: {count(report.migrations.checksumMismatch.length)}</p>
            {(report.schema.issues.length > 0 || report.migrations.unknown.length > 0) && <details><summary className="cursor-pointer">ملاحظات الفحص</summary><ul className="mt-2 break-all" dir="ltr">{[...report.schema.issues, ...report.migrations.unknown.map(item => `Unknown migration: ${item}`)].map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
            <details><summary className="cursor-pointer">أعداد السجلات</summary><div className="mt-2 grid gap-1 sm:grid-cols-2">{report.counts.map(item => <p key={item.table}><bdi>{item.table}</bdi>: {count(item.rows)}</p>)}</div></details>
            {report.jobs.length > 0 && <details><summary className="cursor-pointer">حالة مهام الخلفية المستعادة</summary><div className="mt-2 grid gap-1">{report.jobs.map(item => <p key={item.kind}><bdi>{item.kind}</bdi>: {count(item.pending)} معلّقة، {count(item.failed)} فاشلة، {count(item.expiredLease)} بتصريح منتهٍ</p>)}</div></details>}
            <p className="text-muted-foreground">لم تُشغَّل مهام الخلفية ولم تُعرض بيانات العملاء. لا يغيّر الفحص اتصال الإنتاج.</p>
          </div>}
        </section>
        <section className="grid gap-3 rounded-md border p-3" aria-label="نسخ الملفات واستعادتها">
          <h3 className="font-bold">الصور والملفات</h3>
          <p className="text-xs text-muted-foreground">تعمل المهام في الخلفية. الاستعادة تنسخ إلى حاوية عزل خاصة ولا تعيد الصور إلى إعلانات العملاء.</p>
          {!data.media.configured && <p className="text-xs text-muted-foreground">إعدادات نسخ الملفات غير مكتملة على السيرفر.</p>}
          {(data.capabilities.mediaBackup || data.capabilities.mediaRestore) && <label className="grid gap-1 text-xs">سبب إجراء الملفات<Input name="recoveryMediaReason" value={mediaReason} maxLength={500} disabled={!!busy} onChange={event => setMediaReason(event.target.value)} /></label>}
          {mediaUncertain && <p className="text-xs text-muted-foreground">حدّث حالة الاسترجاع للتحقق من المهمة قبل إنشاء طلب ملفات جديد.</p>}
          {data.capabilities.mediaBackup && <Button size="sm" variant="outline" className="w-fit" disabled={!!busy || mediaUncertain || mediaReason.trim().length < 5} onClick={() => void mediaAction(false)}>بدء نسخ الملفات</Button>}
          {data.capabilities.mediaRestore && availableBackups.length > 0 && <div className="grid gap-2 border-t pt-3">
            <label className="grid gap-1 text-xs">نسخة الملفات<select aria-label="نسخة الملفات" className="h-9 w-full min-w-0 rounded-md border bg-background px-2" value={backupId} disabled={!!busy} onChange={event => { setBackupId(event.target.value); setMediaConfirmation(''); }}><option value="">اختر نسخة مكتملة</option>{availableBackups.map(item => <option key={item.id} value={item.id}>{date(item.createdAt)} — {item.id}</option>)}</select></label>
            <label className="grid gap-1 text-xs">اكتب «{mediaPhrase}»<Input name="recoveryMediaConfirmation" value={mediaConfirmation} disabled={!!busy} onChange={event => setMediaConfirmation(event.target.value)} /></label>
            <Button size="sm" variant="outline" className="w-fit" disabled={!!busy || mediaUncertain || !backupId || mediaReason.trim().length < 5 || normalizeMaintenanceConfirmation(mediaConfirmation) !== mediaPhrase} onClick={() => void mediaAction(true)}>استعادة الملفات إلى العزل</Button>
          </div>}
          {pendingMedia && !data.media.runs.some(item => item.id === pendingMedia.id) && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-xs"><p className="min-w-0 break-all"><bdi>{pendingMedia.id}</bdi> — <bdi>{pendingMedia.status}</bdi></p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mediaRefresh(pendingMedia.id, pendingMedia.kind === 'backup' ? 'backup' : 'quarantine_restore')}>تحديث مهمة الملفات</Button></div>}
          {data.media.runs.length > 0 && <div className="grid gap-2">{data.media.runs.map(item => <div key={item.id} className="grid min-w-0 gap-1 rounded-md border p-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><p>{item.kind === 'backup' ? 'نسخ ملفات' : 'استعادة إلى العزل'} — <bdi>{item.status}</bdi></p><Button size="sm" variant="outline" disabled={!!busy} onClick={() => void mediaRefresh(item.id, item.kind)}>تحديث مهمة الملفات</Button></div><bdi className="break-all">{item.id}</bdi><p>{count(item.objects)} ملف — {count(item.bytes)} بايت — {count(item.errors)} خطأ</p></div>)}</div>}
        </section>
      </>}
    </div>
  </details>;
}
