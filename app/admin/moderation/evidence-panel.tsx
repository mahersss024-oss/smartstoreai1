'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Archive, ChevronLeft, ChevronRight, Clock, LockKeyhole, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@ui/button';

type Row = Record<string, unknown>;
type EvidenceView = {
  evidenceCase: { id: string; status: string; captureStatus: string; snapshotHash: string; retainUntil: string | null; legalHold: boolean; snapshot: { listing?: Row; report?: Row; participants?: Row[]; messages?: Row[]; conversations?: Row[]; commissions?: Row[] } };
  assets: Array<{ id: string; status: string; lastError: string | null }>;
  events: Array<{ id: string; action: string; actorId: string | null; createdAt: string; payload: unknown }>;
  page: number;
  hasMore: boolean;
};

const text = (value: unknown) => value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const date = (value: unknown) => typeof value === 'string' ? new Date(value).toLocaleString('ar-SA') : '';
const statusLabels: Record<string, string> = { open: 'مفتوحة', closed: 'مغلقة', disposing: 'الإتلاف غير مكتمل', disposed: 'أُتلفت الأدلة', pending: 'جارٍ حفظ الأدلة', complete: 'الأدلة مكتملة', incomplete: 'حفظ الأدلة غير مكتمل', stored: 'محفوظة', copying: 'جارٍ النسخ', failed: 'تعذّر الحفظ' };

export function EvidencePanel({ reportId, sourceType, canManage }: { reportId: string; sourceType: 'Report' | 'UserReport'; canManage: boolean }) {
  const endpoint = `/api/admin/moderation/${sourceType === 'Report' ? 'reports' : 'user-reports'}/${encodeURIComponent(reportId)}`;
  const [data, setData] = useState<EvidenceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(180);
  const [confirmation, setConfirmation] = useState('');
  async function load(page = 1) {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${endpoint}?page=${page}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('تعذّر عرض الأدلة المحفوظة.');
      setData(await response.json());
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر الاتصال.'); }
    finally { setBusy(false); }
  }
  async function act(action: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason, days, confirmation }) });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error === 'evidence_retention_protected' ? 'الإتلاف محمي: راجع حالة القضية ومدة الاحتفاظ والنزاعات والمستحقات واكتمال الحفظ.' : result.error === 'evidence_disposal_incomplete' ? 'تعذّر إكمال إتلاف الملفات. يمكن إعادة المحاولة دون فقد سجل القضية.' : 'لم ينفّذ الإجراء. تحقق من الصلاحية والسبب والتأكيد.');
      }
      await load();
      setConfirmation('');
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر الاتصال.'); }
    finally { setBusy(false); }
  }
  const current = data?.evidenceCase;
  const listing = current?.snapshot.listing;
  return <div className="grid min-w-0 gap-3 border-t pt-3 text-sm" dir="rtl">
    <Button type="button" variant="outline" className="justify-self-start" disabled={busy} onClick={() => void load()}><ShieldCheck className="size-4" />{busy ? 'جارٍ التحميل...' : 'الأدلة المحفوظة'}</Button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {data && current && <>
      {data.events.some(event => event.action === 'case.opened' && (event.payload as { legacy?: boolean } | null)?.legacy) && <p className="text-xs text-amber-700 dark:text-amber-300">حُفظت هذه القضية القديمة من البيانات المتبقية وقت الترحيل، وليست نسخة مؤكدة من وقت البلاغ الأصلي.</p>}
      <div className="flex flex-wrap gap-3 text-xs"><span>القضية: {statusLabels[current.status] ?? current.status}</span><span role="status">{statusLabels[current.captureStatus] ?? current.captureStatus}</span>{current.retainUntil && <span>الاحتفاظ حتى: {date(current.retainUntil)}</span>}{current.legalHold && <span>الإتلاف معلّق</span>}</div>
      {current.status !== 'disposed' && <>
        <details><summary className="cursor-pointer font-bold">الإعلان وقت البلاغ</summary>
          {listing ? <dl className="mt-2 grid min-w-0 gap-2 break-words">{Object.entries(listing).map(([key, value]) => <div key={key}><dt className="text-xs text-muted-foreground">{({ title: 'العنوان', description: 'الوصف', price: 'السعر', category: 'التصنيف', city: 'المدينة', sellerId: 'صاحب الإعلان', status: 'الحالة' } as Record<string, string>)[key] ?? key}</dt><dd className="whitespace-pre-wrap">{text(value)}</dd></div>)}</dl> : <p>لا يوجد إعلان مرتبط.</p>}
        </details>
        <details><summary className="cursor-pointer font-bold">الصور المحفوظة ({data.assets.length})</summary><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{data.assets.map(asset => <div key={asset.id} className="min-w-0">{asset.status === 'stored' ? <Image src={`${endpoint}?asset=${encodeURIComponent(asset.id)}`} alt="صورة محفوظة ضمن الأدلة" width={240} height={180} unoptimized className="aspect-[4/3] w-full rounded object-contain" /> : <p className="text-xs">{statusLabels[asset.status] ?? asset.status}</p>}</div>)}</div></details>
        <details><summary className="cursor-pointer font-bold">المحادثة المحفوظة</summary><div className="mt-2 grid gap-3">{current.snapshot.messages?.map(message => <div key={text(message.id)} className="min-w-0 border-b pb-2"><p className="break-all text-xs text-muted-foreground">{text(message.senderId)} · {date(message.createdAt)}</p><p className="whitespace-pre-wrap break-words">{text(message.body)}</p></div>)}</div></details>
        <details><summary className="cursor-pointer font-bold">الأطراف وبيانات البلاغ</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{JSON.stringify({ report: current.snapshot.report, participants: current.snapshot.participants, commissions: current.snapshot.commissions }, null, 2)}</pre></details>
      </>}
      <details><summary className="cursor-pointer font-bold">سجل القضية</summary><div className="mt-2 grid gap-3">{data.events.map(event => <div key={event.id} className="min-w-0 border-b pb-2 text-xs"><p>{event.action} · {date(event.createdAt)}</p><p className="break-all">{event.actorId}</p><pre className="whitespace-pre-wrap break-all">{JSON.stringify(event.payload, null, 2)}</pre></div>)}</div></details>
      <div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" aria-label="الصفحة السابقة للأدلة" disabled={busy || data.page <= 1} onClick={() => void load(data.page - 1)}><ChevronRight className="size-4" /></Button><span>{data.page}</span><Button type="button" variant="outline" size="icon" aria-label="الصفحة التالية للأدلة" disabled={busy || !data.hasMore} onClick={() => void load(data.page + 1)}><ChevronLeft className="size-4" /></Button></div>
      {current.status !== 'disposed' && <>
        <Button type="button" variant="outline" disabled={busy || current.status === 'disposing'} onClick={() => void act('evidence_retry')}><RefreshCw className="size-4" />إعادة محاولة حفظ الصور</Button>
        {canManage && <details><summary className="cursor-pointer font-bold">إدارة الاحتفاظ والإتلاف</summary><div className="mt-3 grid gap-3">
          <label className="grid gap-1">سبب الإجراء<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} className="min-h-20 rounded border bg-background p-2" /></label>
          <label className="grid gap-1">التمديد بالأيام<input type="number" min={1} max={3650} value={days} onChange={event => setDays(Number(event.target.value))} className="h-10 rounded border bg-background px-2" /></label>
          <Button type="button" variant="outline" disabled={busy || reason.trim().length < 5} onClick={() => void act('evidence_extend')}><Clock className="size-4" />تمديد الاحتفاظ</Button>
          <Button type="button" variant="outline" disabled={busy || reason.trim().length < 5} onClick={() => void act(current.legalHold ? 'evidence_release' : 'evidence_hold')}><LockKeyhole className="size-4" />{current.legalHold ? 'رفع تعليق الإتلاف' : 'تعليق الإتلاف'}</Button>
          <label className="grid gap-1">تأكيد الإتلاف: إتلاف الأدلة<input value={confirmation} onChange={event => setConfirmation(event.target.value)} className="h-10 rounded border bg-background px-2" /></label>
          <Button type="button" variant="outline" className="text-red-600" disabled={busy || reason.trim().length < 5 || confirmation !== 'إتلاف الأدلة'} onClick={() => void act('evidence_dispose')}><Trash2 className="size-4" />{current.status === 'disposing' ? 'استكمال الإتلاف' : 'إتلاف الأدلة'}</Button>
        </div></details>}
      </>}
      {current.snapshotHash && <p className="break-all text-[10px] text-muted-foreground"><Archive className="mr-1 inline size-3" />SHA-256: {current.snapshotHash}</p>}
    </>}
  </div>;
}
