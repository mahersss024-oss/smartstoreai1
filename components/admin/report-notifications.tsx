'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  ExternalLink,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from '@ui/dropdown-menu';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import type { ReportNotification } from '@/lib/admin/report-notifications';
import { EvidencePanel } from '@/app/admin/moderation/evidence-panel';
import { AdminRecordPreview } from './record-preview';
import { displayValue } from './record-details';

type Notification = Omit<ReportNotification, 'createdAt'> & {
  createdAt: string;
};
type Inbox = { notifications: Notification[]; page: number; hasMore: boolean };

export function AdminReportNotifications({
  canManage,
}: {
  canManage: boolean;
}) {
  const [data, setData] = useState<Inbox | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Notification | null>(null);
  const sequence = useRef(0);
  const acknowledged = useRef(new Set<string>());
  const lastLoad = useRef(0);
  const load = useCallback(async (page = 1) => {
    const request = ++sequence.current;
    lastLoad.current = Date.now();
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/moderation?view=notifications&page=${page}&limit=20`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('unavailable');
      const payload = (await response.json()) as Inbox;
      if (!Array.isArray(payload.notifications))
        throw new Error('invalid_response');
      if (request === sequence.current) {
        setData({
          ...payload,
          notifications: payload.notifications.filter(
            (item) => !acknowledged.current.has(item.id),
          ),
        });
        setError('');
      }
    } catch {
      if (request === sequence.current)
        setError('تعذّر تحديث إشعارات البلاغات.');
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const clock = sequence;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30_000);
    return () => {
      clock.current++;
      window.clearInterval(timer);
    };
  }, [load]);
  useSmartstoreRealtime({
    eventTypes: ['moderation_updated'],
    fallbackIntervalMs: 60_000,
    onEvent: () => {
      void load();
    },
    onResync: ({ reason }) => {
      if (reason !== 'event' && Date.now() - lastLoad.current >= 30_000)
        return load();
    },
  });
  async function openNotification(item: Notification) {
    if (busy) return;
    setBusy(item.id);
    setError('');
    try {
      const response = await fetch('/api/admin/moderation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'notification_viewed',
          caseId: item.id,
        }),
      });
      if (!response.ok) throw new Error('acknowledgement_failed');
      acknowledged.current.add(item.id);
      sequence.current++;
      setLoading(false);
      setData((current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.filter(
                (row) => row.id !== item.id,
              ),
            }
          : current,
      );
      setOpen(false);
      setSelected(item);
    } catch {
      setError('لم يُسجّل الاطلاع. الإشعار ما زال في القائمة؛ حاول مجددًا.');
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <DropdownMenu
        dir="rtl"
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) void load();
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="relative shrink-0"
            title="إشعارات البلاغات"
            aria-label="إشعارات البلاغات"
          >
            <Bell className="size-4" />
            {Boolean(data?.notifications.length) && (
              <span className="admin-unread-dot">
                <span className="sr-only">بلاغات لم يُطّلع عليها</span>
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="admin-notification-menu">
          <header className="flex items-center justify-between gap-2 border-b p-3">
            <h2 className="text-sm font-bold">بلاغات الموقع</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="تحديث إشعارات البلاغات"
              title="تحديث إشعارات البلاغات"
              disabled={loading || Boolean(busy)}
              onClick={() => void load()}
            >
              <RefreshCw className="size-4" />
            </Button>
          </header>
          {error && (
            <p role="alert" className="p-3 text-xs text-destructive">
              {error}
            </p>
          )}
          {loading && !data && (
            <p role="status" className="p-4 text-sm">
              جارٍ تحميل البلاغات...
            </p>
          )}
          <div className="max-h-80 overflow-y-auto">
            {data?.notifications.map((item) => (
              <DropdownMenuItem
                key={item.id}
                asChild
                onSelect={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  className="admin-notification-row"
                  disabled={Boolean(busy)}
                  onClick={() => void openNotification(item)}
                >
                  {item.sourceType === 'Report' ? (
                    <ShieldCheck className="size-4 shrink-0 text-primary" />
                  ) : (
                    <MessageCircle className="size-4 shrink-0 text-primary" />
                  )}
                  <span className="grid min-w-0 gap-1 text-start">
                    <strong className="text-sm">
                      {item.sourceType === 'Report'
                        ? 'بلاغ إعلان'
                        : 'بلاغ محادثة'}
                      {item.title ? ` · ${item.title}` : ''}
                    </strong>
                    <span className="text-xs text-muted-foreground">
                      {displayValue(item.reason, 'reason')}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={item.createdAt}
                    >
                      {displayValue(item.createdAt, 'createdAt')}
                    </time>
                  </span>
                </button>
              </DropdownMenuItem>
            ))}
            {data && !data.notifications.length && !error && (
              <p className="p-5 text-sm text-muted-foreground">
                لا توجد إشعارات بلاغات جديدة في هذه الصفحة.
              </p>
            )}
          </div>
          {data && (data.hasMore || data.page > 1) && (
            <div className="flex justify-between gap-2 p-3">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || data.page <= 1}
                onClick={() => void load(data.page - 1)}
              >
                الأحدث
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || !data.hasMore}
                onClick={() => void load(data.page + 1)}
              >
                الأقدم
              </Button>
            </div>
          )}
          <Link
            href="/admin/moderation"
            prefetch={false}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-t p-3 text-sm text-primary"
          >
            كل البلاغات والأدلة
            <ExternalLink className="size-4" />
          </Link>
        </DropdownMenuContent>
      </DropdownMenu>
      {selected && (
        <AdminRecordPreview
          open
          title={
            selected.sourceType === 'Report' ? 'بلاغ إعلان' : 'بلاغ محادثة'
          }
          dirty={false}
          busy={false}
          onClose={() => setSelected(null)}
        >
          <div className="grid gap-4">
            <h2 className="text-base font-bold">
              {selected.title ?? 'البلاغ'}
            </h2>
            <p className="text-sm">{displayValue(selected.reason, 'reason')}</p>
            {selected.details && (
              <p className="whitespace-pre-wrap break-words text-sm">
                {selected.details}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              تم الاطلاع على الإشعار للجميع. حالة البلاغ لم تتغير.
            </p>
            <EvidencePanel
              reportId={selected.sourceId}
              sourceType={selected.sourceType}
              canManage={canManage}
            />
            <div className="admin-actions">
              {selected.listingId && (
                <Button asChild variant="outline">
                  <Link
                    href={`/admin/listings?listingId=${encodeURIComponent(selected.listingId)}`}
                    prefetch={false}
                    onClick={() => setSelected(null)}
                  >
                    فتح الإعلان
                    <ExternalLink className="size-4" />
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link
                  href={`/admin/moderation?reportId=${encodeURIComponent(selected.sourceId)}&sourceType=${selected.sourceType}`}
                  prefetch={false}
                  onClick={() => setSelected(null)}
                >
                  معالجة البلاغ
                  <ShieldCheck className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </AdminRecordPreview>
      )}
    </>
  );
}
