'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '@/app/admin/use-admin-access';
import { useAuthSession } from '@/hooks/use-auth-session';

const confirmationPhrase = 'حذف بيانات السوق والإبقاء على المستخدمين';
const endpoint = '/api/admin/maintenance';

type ResetPreview = {
  previewToken: string;
  expiresAt: string;
  counts: Array<{ kind: string; label: string; count: number; mode: 'delete' | 'cleanup' }>;
  preserved: { users: number; profileImages: number };
  blockers: Array<{ code: string; count: number }>;
  protectedData: { evidenceCases: number; heldEvidenceCases: number; commissions: number };
  maxRows: number;
  totalRows: number;
  canExecute: boolean;
};

type ResetResult = {
  status: 'completed';
  operationId: string;
  deleted: Record<string, number>;
  preservedUsers: number;
  pendingStorageJobs: number;
};

function number(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPreview(value: unknown): value is ResetPreview {
  if (!value || typeof value !== 'object') return false;
  const view = value as ResetPreview;
  return typeof view.previewToken === 'string' && view.previewToken.length > 0 &&
    typeof view.expiresAt === 'string' && Number.isFinite(Date.parse(view.expiresAt)) &&
    typeof view.canExecute === 'boolean' && count(view.maxRows) && count(view.totalRows) &&
    !!view.preserved && count(view.preserved.users) && count(view.preserved.profileImages) &&
    !!view.protectedData && count(view.protectedData.evidenceCases) &&
    count(view.protectedData.heldEvidenceCases) && count(view.protectedData.commissions) &&
    Array.isArray(view.counts) && view.counts.length > 0 && view.counts.every(row => row &&
      typeof row.kind === 'string' && typeof row.label === 'string' && count(row.count) &&
      (row.mode === 'delete' || row.mode === 'cleanup')) &&
    Array.isArray(view.blockers) && view.blockers.every(row => row &&
      typeof row.code === 'string' && count(row.count));
}

function validResult(value: unknown): value is ResetResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as ResetResult;
  return result.status === 'completed' && typeof result.operationId === 'string' &&
    result.operationId.length > 0 && count(result.preservedUsers) && count(result.pendingStorageJobs) &&
    !!result.deleted && typeof result.deleted === 'object' && !Array.isArray(result.deleted) &&
    Object.values(result.deleted).every(count);
}

function failureMessage(code: string | undefined, status?: number) {
  if (status === 401 || code === 'auth_required') return 'انتهت جلسة الدخول. سجّل الدخول إلى الإدارة مجددًا.';
  if (status === 403 || code === 'owner_required' || code === 'owner_not_found') return 'هذه العملية متاحة لمالك المنصة فقط.';
  if (status === 429) return 'طلبات كثيرة. انتظر قليلًا ثم حدّث المعاينة.';
  switch (code) {
    case 'preview_stale':
    case 'preview_invalid': return 'تغيّرت البيانات أو انتهت المعاينة. حدّث المعاينة وأكّدها من جديد.';
    case 'reset_busy': return 'توجد عمليات جارية. انتظر اكتمالها ثم حدّث المعاينة.';
    case 'reset_too_large': return 'يتجاوز حجم البيانات الحد الآمن لهذه العملية. يلزم تجهيز إعادة الضبط على دفعات.';
    case 'reset_schema_changed': return 'تغيّر مخطط قاعدة البيانات. يلزم مراجعة نطاق الحذف قبل التنفيذ.';
    case 'database_required': return 'إعادة الضبط تتطلب الاتصال بقاعدة بيانات المشروع.';
    case 'invalid_reset_request': return 'راجع سبب الإجراء والإقرارين وعبارة التأكيد، ثم اطلب معاينة جديدة.';
    default: return 'تعذّر إكمال الطلب. حدّث المعاينة قبل المحاولة مجددًا.';
  }
}

export function MarketResetPanel({ onCompleted }: { onCompleted: () => void }) {
  const { session, verifySession } = useAuthSession();
  const { isAdminAccessAllowed } = useAdminAccess('owner');
  const ownerId = session.user?.id;
  const verifyOwner = useCallback(async () => {
    const current = await verifySession();
    return current.authenticated && current.user?.role === 'owner' && current.user.id === ownerId;
  }, [ownerId, verifySession]);

  if (!isAdminAccessAllowed || !ownerId) return null;
  return <OwnerResetPanel key={ownerId} verifyOwner={verifyOwner} onCompleted={onCompleted} />;
}

function OwnerResetPanel({ verifyOwner, onCompleted }: {
  verifyOwner: () => Promise<boolean>;
  onCompleted: () => void;
}) {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [expired, setExpired] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [includeProtectedData, setIncludeProtectedData] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'preview' | 'execute'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResetResult | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const busy = phase !== 'idle';

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

  const clearConfirmation = () => {
    setConfirmation('');
    setReason('');
    setBackupConfirmed(false);
    setIncludeProtectedData(false);
  };

  const loadPreview = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => mounted.current && request.current === controller && !controller.signal.aborted;
    setPhase('preview');
    setError('');
    setPreview(null);
    setResult(null);
    setExpired(false);
    clearConfirmation();
    try {
      if (!(await verifyOwner())) {
        if (current()) setError(failureMessage('owner_required'));
        return;
      }
      if (!current()) return;
      const response = await fetch(`${endpoint}?resource=market_reset`, { cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => null) as { preview?: unknown; error?: string } | null;
      if (!current()) return;
      if (!response.ok) { setError(failureMessage(payload?.error, response.status)); return; }
      if (!validPreview(payload?.preview)) { setError('تعذّر قراءة المعاينة. لم يُنفّذ أي حذف.'); return; }
      setPreview(payload.preview);
      setExpired(Date.parse(payload.preview.expiresAt) <= Date.now());
    } catch {
      if (current()) setError('تعذّر تحميل المعاينة. لم يُنفّذ أي حذف.');
    } finally {
      if (current()) { request.current = null; setPhase('idle'); }
    }
  };

  const execute = async () => {
    if (request.current || !preview || !preview.canExecute || preview.blockers.length || expired ||
      Date.parse(preview.expiresAt) <= Date.now() || confirmation !== confirmationPhrase ||
      reason.trim().length < 5 || reason.trim().length > 500 || !backupConfirmed || !includeProtectedData) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => mounted.current && request.current === controller && !controller.signal.aborted;
    const body = { action: 'market_reset', previewToken: preview.previewToken, reason: reason.trim(),
      confirmation, backupConfirmed, includeProtectedData };
    let submitted = false;
    setPhase('execute');
    setError('');
    setResult(null);
    setPreview(null);
    clearConfirmation();
    try {
      if (!(await verifyOwner())) {
        if (current()) setError(failureMessage('owner_required'));
        return;
      }
      if (!current()) return;
      submitted = true;
      const response = await fetch(endpoint, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!current()) return;
      if (!response.ok) {
        const code = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' ? payload.error : undefined;
        setError(failureMessage(code, response.status));
        return;
      }
      if (!validResult(payload)) throw new Error('unconfirmed_result');
      setResult(payload);
      onCompleted();
    } catch {
      if (current()) setError(submitted
        ? 'تعذّر تأكيد نتيجة إعادة الضبط. لا تعاود التنفيذ قبل مراجعة البيانات وسجل الإدارة؛ قد يكون الحذف قد اكتمل.'
        : 'تعذّر التحقق من الصلاحية. لم يُرسل طلب الحذف.');
    } finally {
      if (current()) { request.current = null; setPhase('idle'); }
    }
  };

  const canExecute = !busy && !!preview?.canExecute && !preview.blockers.length && !expired &&
    confirmation === confirmationPhrase && reason.trim().length >= 5 && backupConfirmed && includeProtectedData;

  return <details className="admin-section admin-danger-zone" data-market-reset>
    <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold">
      <AlertTriangle className="size-4 text-red-600 dark:text-red-300" />
      إعادة ضبط السوق بالكامل
    </summary>
    <div className="mt-4 grid gap-4">
      <p className="text-sm text-muted-foreground">
        يحذف بيانات السوق، بما فيها الإعلانات والمحادثات والبلاغات والأدلة والرسوم والإشعارات ورسالة الموقع وسجل الإدارة السابق.
        تبقى حسابات المستخدمين وبياناتها وصورها فقط، مع مهام تنظيف الملفات وسجل العملية الجديدة.
      </p>
      <Button variant="outline" size="sm" className="w-fit" disabled={busy} onClick={() => void loadPreview()}>
        <RefreshCw className={`size-4${phase === 'preview' ? ' animate-spin' : ''}`} />
        معاينة إعادة ضبط السوق
      </Button>
      {phase === 'preview' && <p role="status" className="text-xs text-muted-foreground">جارٍ حساب أثر إعادة الضبط…</p>}
      {error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
      {preview && <>
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/20" role="status">
          يبقى {number(preview.preserved.users)} حساب مستخدم، منها {number(preview.preserved.profileImages)} بصورة حساب.
        </div>
        <div className="grid gap-2 sm:grid-cols-2" aria-label="أثر إعادة ضبط السوق">
          {preview.counts.map(row => <div key={row.kind} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-xs">
            <span>{row.label}{row.mode === 'cleanup' ? ' · تُستكمل مهام حذف الملفات' : ''}</span><strong>{number(row.count)}</strong>
          </div>)}
        </div>
        <p className="text-xs text-destructive">
          يشمل الحذف {number(preview.protectedData.evidenceCases)} قضية أدلة، منها {number(preview.protectedData.heldEvidenceCases)} معلّقة الإتلاف،
          و{number(preview.protectedData.commissions)} سجل رسوم وعمولات. لا يمكن التراجع من لوحة الإدارة.
        </p>
        <p className="text-xs text-muted-foreground">تنتهي المعاينة: {new Date(preview.expiresAt).toLocaleString('ar-SA')}</p>
        {expired && <p role="alert" className="text-sm text-destructive">انتهت المعاينة. اطلب معاينة جديدة قبل التنفيذ.</p>}
        {preview.blockers.map(blocker => <p key={blocker.code} role="alert" className="text-sm text-destructive">
          {failureMessage(blocker.code)} ({number(blocker.count)})
        </p>)}
        {!preview.canExecute && !preview.blockers.length && <p role="alert" className="text-sm text-destructive">التنفيذ غير متاح لهذه المعاينة.</p>}
        <label className="grid gap-1 text-sm">
          سبب إعادة ضبط السوق
          <Input name="marketResetReason" value={reason} onChange={event => setReason(event.target.value)} minLength={5} maxLength={500} disabled={busy} placeholder="اكتب سببًا واضحًا" />
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input name="marketResetBackup" type="checkbox" checked={backupConfirmed} onChange={event => setBackupConfirmed(event.target.checked)} disabled={busy} className="mt-1 size-4 shrink-0 accent-red-600" />
          أخذت نسخة احتياطية قابلة للاستعادة قبل الحذف.
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input name="marketResetProtectedData" type="checkbox" checked={includeProtectedData} onChange={event => setIncludeProtectedData(event.target.checked)} disabled={busy} className="mt-1 size-4 shrink-0 accent-red-600" />
          أقرّ بالحذف النهائي لجميع بيانات السوق، بما فيها الأدلة المعلّقة والرسوم والعمولات وسجل الإدارة السابق.
        </label>
        <label className="grid gap-2 text-sm">
          اكتب للتأكيد: {confirmationPhrase}
          <Input name="marketResetConfirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" spellCheck={false} />
        </label>
        <Button className="w-fit rounded-md bg-red-600 hover:bg-red-700" disabled={!canExecute} onClick={() => void execute()}>
          <Trash2 className="size-4" />حذف بيانات السوق نهائيًا
        </Button>
      </>}
      {phase === 'execute' && <p role="status" className="text-sm">جارٍ تنفيذ إعادة الضبط. انتظر النتيجة ولا تكرر الطلب.</p>}
      {result && <div role="status" className="grid gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/20">
        <p>اكتملت إعادة ضبط السوق. حُذف {number(Object.values(result.deleted).reduce((sum, value) => sum + value, 0))} سجل، وبقي {number(result.preservedUsers)} حساب مستخدم.</p>
        <p>{result.pendingStorageJobs > 0 ? `تتبقى ${number(result.pendingStorageJobs)} مهمة لحذف الملفات. حذف بيانات السوق لا يعني اكتمال حذف الملفات بعد.` : 'لا توجد مهام حذف ملفات معلّقة.'}</p>
        <p className="text-xs text-muted-foreground">مرجع العملية: <code className="break-all" dir="ltr">{result.operationId}</code></p>
      </div>}
    </div>
  </details>;
}
