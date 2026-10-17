'use client';

import { useState } from 'react';
import Image from 'next/image';
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Clock,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { Button } from '@ui/button';
import {
  RecordDetails,
  TechnicalDetails,
  evidenceEventLabel,
} from '@/components/admin/record-details';

type Row = Record<string, unknown>;
type EvidenceView = {
  evidenceCase: {
    id: string;
    status: string;
    captureStatus: string;
    snapshotHash: string;
    retainUntil: string | null;
    legalHold: boolean;
    snapshot: {
      listing?: Row;
      report?: Row;
      participants?: Row[];
      messages?: Row[];
      conversations?: Row[];
      commissions?: Row[];
    };
  };
  assets: Array<{ id: string; status: string; lastError: string | null }>;
  events: Array<{
    id: string;
    action: string;
    actorId: string | null;
    createdAt: string;
    payload: unknown;
  }>;
  page: number;
  hasMore: boolean;
};

const text = (value: unknown) =>
  value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
const date = (value: unknown) =>
  typeof value === 'string' ? new Date(value).toLocaleString('ar-SA') : '';
const statusLabels: Record<string, string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
  disposing: 'الإتلاف غير مكتمل',
  disposed: 'أُتلفت الأدلة',
  pending: 'جارٍ حفظ الأدلة',
  complete: 'الأدلة مكتملة',
  incomplete: 'حفظ الأدلة غير مكتمل',
  stored: 'محفوظة',
  copying: 'جارٍ النسخ',
  failed: 'تعذّر الحفظ',
};

export function EvidencePanel({
  reportId,
  sourceType,
  canManage,
}: {
  reportId: string;
  sourceType: 'Report' | 'UserReport';
  canManage: boolean;
}) {
  const endpoint = `/api/admin/moderation/${sourceType === 'Report' ? 'reports' : 'user-reports'}/${encodeURIComponent(reportId)}`;
  const [data, setData] = useState<EvidenceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState(180);
  const [confirmation, setConfirmation] = useState('');
  async function load(page = 1) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${endpoint}?page=${page}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('تعذّر عرض الأدلة المحفوظة.');
      setData(await response.json());
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذّر الاتصال.');
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, days, confirmation }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error === 'evidence_retention_protected'
            ? 'الإتلاف محمي: راجع حالة القضية ومدة الاحتفاظ والنزاعات والمستحقات واكتمال الحفظ.'
            : result.error === 'evidence_disposal_incomplete'
              ? 'تعذّر إكمال إتلاف الملفات. يمكن إعادة المحاولة دون فقد سجل القضية.'
              : 'لم ينفّذ الإجراء. تحقق من الصلاحية والسبب والتأكيد.',
        );
      }
      await load();
      setConfirmation('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذّر الاتصال.');
    } finally {
      setBusy(false);
    }
  }
  const current = data?.evidenceCase;
  const listing = current?.snapshot.listing;
  const participants = current?.snapshot.participants ?? [];
  const person = (id: unknown) => {
    const participant = participants.find((row) => row.id === id);
    return participant
      ? text(participant.name || participant.email) || 'حساب مسجل'
      : id
        ? 'حساب مسجل'
        : 'غير مسجل';
  };
  return (
    <div className="admin-evidence" dir="rtl">
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        disabled={busy}
        onClick={() => void load()}
      >
        <ShieldCheck className="size-4" />
        {busy ? 'جارٍ التحميل...' : 'الأدلة المحفوظة'}
      </Button>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {data && current && (
        <>
          {data.events.some(
            (event) =>
              event.action === 'case.opened' &&
              (event.payload as { legacy?: boolean } | null)?.legacy,
          ) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              حُفظت هذه القضية القديمة من البيانات المتبقية وقت الترحيل، وليست
              نسخة مؤكدة من وقت البلاغ الأصلي.
            </p>
          )}
          <div className="admin-evidence-summary">
            <span className="admin-status">
              القضية: {statusLabels[current.status] ?? current.status}
            </span>
            <span className="admin-status" role="status">
              {statusLabels[current.captureStatus] ?? current.captureStatus}
            </span>
            {current.retainUntil && (
              <span>الاحتفاظ حتى: {date(current.retainUntil)}</span>
            )}
            {current.legalHold && (
              <span className="text-amber-700 dark:text-amber-300">
                الإتلاف معلّق
              </span>
            )}
          </div>
          {current.status !== 'disposed' && (
            <>
              <details className="admin-disclosure">
                <summary>الإعلان وقت البلاغ</summary>
                <div className="admin-disclosure-body">
                  {listing ? (
                    <RecordDetails value={listing} />
                  ) : (
                    <p>لا يوجد إعلان مرتبط.</p>
                  )}
                </div>
              </details>
              <details className="admin-disclosure">
                <summary>الصور المحفوظة ({data.assets.length})</summary>
                <div className="admin-disclosure-body grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {data.assets.map((asset, index) => (
                    <figure key={asset.id} className="min-w-0">
                      {asset.status === 'stored' ? (
                        <Image
                          src={`${endpoint}?asset=${encodeURIComponent(asset.id)}`}
                          alt={`صورة محفوظة ضمن الأدلة ${index + 1}`}
                          width={240}
                          height={180}
                          unoptimized
                          className="aspect-[4/3] w-full rounded-md border bg-background object-contain"
                        />
                      ) : (
                        <div className="grid aspect-[4/3] place-items-center rounded-md border text-xs">
                          {statusLabels[asset.status] ?? asset.status}
                        </div>
                      )}
                      <figcaption className="mt-2 text-xs text-muted-foreground">
                        الصورة {index + 1} ·{' '}
                        {statusLabels[asset.status] ?? asset.status}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </details>
              <details className="admin-disclosure">
                <summary>المحادثة المحفوظة</summary>
                <div className="admin-disclosure-body admin-scroll-records">
                  {current.snapshot.messages?.length ? (
                    current.snapshot.messages.map((message) => (
                      <div key={text(message.id)} className="admin-message">
                        <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                          <strong>{person(message.senderId)}</strong>
                          <time>{date(message.createdAt)}</time>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words">
                          {text(message.body)}
                        </p>
                        <TechnicalDetails
                          title="بيانات الرسالة الأصلية"
                          value={message}
                        />
                      </div>
                    ))
                  ) : (
                    <p className="text-muted-foreground">
                      لا توجد رسائل محفوظة.
                    </p>
                  )}
                </div>
              </details>
              <details className="admin-disclosure">
                <summary>الأطراف وبيانات البلاغ</summary>
                <div className="admin-disclosure-body grid gap-5">
                  <section>
                    <h3 className="mb-3 font-semibold">الأطراف</h3>
                    <RecordDetails value={participants} />
                  </section>
                  <section>
                    <h3 className="mb-3 font-semibold">بيانات البلاغ</h3>
                    <RecordDetails value={current.snapshot.report} />
                  </section>
                  <section>
                    <h3 className="mb-3 font-semibold">العمولات المرتبطة</h3>
                    <RecordDetails
                      value={current.snapshot.commissions}
                      empty="لا توجد عمولات محفوظة ضمن هذه القضية."
                    />
                  </section>
                </div>
              </details>
            </>
          )}
          <details className="admin-disclosure">
            <summary>سجل القضية</summary>
            <ol
              className="admin-disclosure-body admin-scroll-records"
              aria-label="أحداث القضية"
            >
              {data.events.map((event) => (
                <li key={event.id} className="admin-timeline-event">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <strong>{evidenceEventLabel(event.action)}</strong>
                    <time className="text-xs text-muted-foreground">
                      {date(event.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    المنفذ: {person(event.actorId)}
                  </p>
                  {event.action !== 'asset.viewed' &&
                    event.action !== 'case.viewed' && (
                      <div className="mt-3">
                        <RecordDetails value={event.payload} />
                      </div>
                    )}
                  <TechnicalDetails
                    title="بيانات الحدث الأصلية"
                    value={event}
                  />
                </li>
              ))}
            </ol>
          </details>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="الصفحة السابقة للأدلة"
              disabled={busy || data.page <= 1}
              onClick={() => void load(data.page - 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
            <span>{data.page}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="الصفحة التالية للأدلة"
              disabled={busy || !data.hasMore}
              onClick={() => void load(data.page + 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </div>
          {current.status !== 'disposed' && (
            <>
              <Button
                type="button"
                variant="outline"
                className="justify-self-start"
                disabled={busy || current.status === 'disposing'}
                onClick={() => void act('evidence_retry')}
              >
                <RefreshCw className="size-4" />
                إعادة محاولة حفظ الصور
              </Button>
              {canManage && (
                <details className="admin-disclosure admin-danger-zone">
                  <summary>إدارة الاحتفاظ والإتلاف</summary>
                  <div className="admin-disclosure-body grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1">
                      سبب الإجراء
                      <textarea
                        value={reason}
                        maxLength={500}
                        onChange={(event) => setReason(event.target.value)}
                        className="min-h-20 rounded border bg-background p-2"
                      />
                    </label>
                    <label className="grid gap-1">
                      التمديد بالأيام
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={days}
                        onChange={(event) =>
                          setDays(Number(event.target.value))
                        }
                        className="h-10 rounded border bg-background px-2"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() => void act('evidence_extend')}
                    >
                      <Clock className="size-4" />
                      تمديد الاحتفاظ
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || reason.trim().length < 5}
                      onClick={() =>
                        void act(
                          current.legalHold
                            ? 'evidence_release'
                            : 'evidence_hold',
                        )
                      }
                    >
                      <LockKeyhole className="size-4" />
                      {current.legalHold
                        ? 'رفع تعليق الإتلاف'
                        : 'تعليق الإتلاف'}
                    </Button>
                    <label className="grid gap-1">
                      تأكيد الإتلاف: إتلاف الأدلة
                      <input
                        value={confirmation}
                        onChange={(event) =>
                          setConfirmation(event.target.value)
                        }
                        className="h-10 rounded border bg-background px-2"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-red-600"
                      disabled={
                        busy ||
                        reason.trim().length < 5 ||
                        confirmation !== 'إتلاف الأدلة'
                      }
                      onClick={() => void act('evidence_dispose')}
                    >
                      <Trash2 className="size-4" />
                      {current.status === 'disposing'
                        ? 'استكمال الإتلاف'
                        : 'إتلاف الأدلة'}
                    </Button>
                  </div>
                </details>
              )}
            </>
          )}
          {current.snapshotHash && (
            <details className="admin-technical">
              <summary>
                <Archive className="inline size-3" /> بيانات التحقق من سلامة
                الأدلة
              </summary>
              <p className="mt-2 text-xs text-muted-foreground">SHA-256</p>
              <code className="admin-hash" dir="ltr">
                {current.snapshotHash}
              </code>
            </details>
          )}
        </>
      )}
    </div>
  );
}
