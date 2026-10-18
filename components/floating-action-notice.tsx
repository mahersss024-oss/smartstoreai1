'use client';

import { type ReactNode, useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getArabicCustomerMessage } from '@/lib/customer-language';
import { useOverlayViewport } from '@/hooks/use-overlay-viewport';

type FloatingActionNoticeTone = 'success' | 'warning' | 'danger' | 'info';

const subscribeToClient = () => () => {};

type FloatingActionNoticeProps = {
  action?: ReactNode;
  closeLabel?: string;
  durationMs?: number;
  message?: string;
  onDismiss: () => void;
  open: boolean;
  statusLabel?: string;
  title?: string;
  tone: FloatingActionNoticeTone;
};

const toneClasses: Record<
  FloatingActionNoticeTone,
  {
    accent: string;
    glow: string;
    icon: string;
    iconRing: string;
    status: string;
    title: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    accent: 'from-emerald-500 via-emerald-400 to-blue-500',
    glow: 'shadow-emerald-950/10 dark:shadow-emerald-950/40',
    icon: 'bg-emerald-500 text-white shadow-emerald-700/20 dark:bg-emerald-400 dark:text-emerald-950',
    iconRing: 'bg-emerald-500/10 ring-emerald-500/15 dark:bg-emerald-400/10 dark:ring-emerald-300/15',
    status: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/15 dark:bg-emerald-400/10 dark:text-emerald-200 dark:ring-emerald-300/15',
    title: 'text-foreground',
    Icon: CheckCircle2,
  },
  warning: {
    accent: 'from-amber-500 via-amber-400 to-blue-500',
    glow: 'shadow-amber-950/10 dark:shadow-amber-950/40',
    icon: 'bg-amber-500 text-white shadow-amber-700/20 dark:bg-amber-300 dark:text-amber-950',
    iconRing: 'bg-amber-500/10 ring-amber-500/15 dark:bg-amber-300/10 dark:ring-amber-200/15',
    status: 'bg-amber-500/10 text-amber-800 ring-amber-500/15 dark:bg-amber-300/10 dark:text-amber-100 dark:ring-amber-200/15',
    title: 'text-foreground',
    Icon: AlertTriangle,
  },
  danger: {
    accent: 'from-red-500 via-rose-500 to-blue-500',
    glow: 'shadow-red-950/10 dark:shadow-red-950/40',
    icon: 'bg-red-500 text-white shadow-red-700/20 dark:bg-red-400 dark:text-red-950',
    iconRing: 'bg-red-500/10 ring-red-500/15 dark:bg-red-400/10 dark:ring-red-300/15',
    status: 'bg-red-500/10 text-red-700 ring-red-500/15 dark:bg-red-400/10 dark:text-red-200 dark:ring-red-300/15',
    title: 'text-foreground',
    Icon: XCircle,
  },
  info: {
    accent: 'from-blue-600 via-sky-500 to-emerald-500',
    glow: 'shadow-blue-950/10 dark:shadow-blue-950/40',
    icon: 'bg-blue-600 text-white shadow-blue-700/20 dark:bg-blue-300 dark:text-blue-950',
    iconRing: 'bg-blue-500/10 ring-blue-500/15 dark:bg-blue-300/10 dark:ring-blue-200/15',
    status: 'bg-blue-500/10 text-blue-700 ring-blue-500/15 dark:bg-blue-300/10 dark:text-blue-100 dark:ring-blue-200/15',
    title: 'text-foreground',
    Icon: Info,
  },
};

export function FloatingActionNotice({
  action,
  closeLabel = 'إغلاق رسالة الإجراء',
  durationMs = 10000,
  message,
  onDismiss,
  open,
  statusLabel,
  title,
  tone,
}: FloatingActionNoticeProps) {
  message = message ? getArabicCustomerMessage(message,
    tone === 'success' ? 'تم إكمال الإجراء بنجاح.' : 'تعذر إكمال الإجراء الآن. راجع البيانات وحاول مجددًا.') : message;
  const toneConfig = toneClasses[tone];
  const Icon = toneConfig.Icon;
  const isRichNotice = Boolean(title || action || statusLabel);
  const isClient = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const noticeRef = useOverlayViewport<HTMLDivElement>();

  useEffect(() => {
    if (!open || durationMs <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(onDismiss, durationMs);

    return () => window.clearTimeout(timeoutId);
  }, [durationMs, onDismiss, open]);

  if (!open || !isClient) {
    return null;
  }

  return createPortal(
    <div
      aria-live={tone === 'success' || tone === 'info' ? 'polite' : 'assertive'}
      className="viewport-notice pointer-events-none fixed inset-x-0 top-1/2 z-[2147483647] grid -translate-y-1/2 place-items-center px-4 [padding-bottom:env(safe-area-inset-bottom)] [padding-top:env(safe-area-inset-top)]"
      ref={noticeRef}
      dir="rtl"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      role={tone === 'success' || tone === 'info' ? 'status' : 'alert'}
    >
      <section
        className={cn(
          'pointer-events-auto relative isolate max-h-[calc(var(--overlay-height,100dvh)-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full overflow-x-hidden overflow-y-auto rounded-lg border border-border/80 bg-card/95 text-card-foreground shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-card/95',
          'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
          toneConfig.glow,
          isRichNotice
            ? 'grid max-w-[23rem] gap-4 px-4 pb-4 pt-5 text-center sm:max-w-[25rem]'
            : 'grid max-w-[24rem] grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-3 text-right',
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            'absolute inset-x-0 top-0 h-1 bg-gradient-to-l',
            toneConfig.accent,
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            'absolute -top-20 right-1/2 size-36 translate-x-1/2 rounded-full bg-gradient-to-br opacity-10 blur-2xl',
            toneConfig.accent,
          )}
        />
        <button
          aria-label={closeLabel}
          className={cn(
            'grid size-9 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            isRichNotice ? 'absolute left-2 top-2' : 'relative',
          )}
          onClick={onDismiss}
          type="button"
        >
          <X className="size-5" />
        </button>
        <div
          className={cn(
            'grid place-items-center rounded-full ring-1',
            toneConfig.iconRing,
            isRichNotice ? 'mx-auto size-20' : 'size-12',
          )}
        >
          <span
            className={cn(
              'grid place-items-center rounded-full shadow-lg',
              toneConfig.icon,
              isRichNotice ? 'size-14' : 'size-8',
            )}
          >
            <Icon className={isRichNotice ? 'size-8' : 'size-5'} />
          </span>
        </div>
        <div
          className={cn(
            'min-w-0',
            isRichNotice ? 'grid gap-2 px-8' : 'grid gap-0.5',
          )}
        >
          <div
            className={cn(
              'flex min-w-0 gap-2',
              isRichNotice ? 'flex-col items-center' : 'items-center',
            )}
          >
            {title && (
              <h3
                className={cn(
                  'min-w-0 font-black leading-7 tracking-normal',
                  isRichNotice ? 'text-lg' : 'truncate text-sm',
                  toneConfig.title,
                )}
              >
                {title}
              </h3>
            )}
            {statusLabel && (
              <span
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1',
                  toneConfig.status,
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-current"
                />
                <span className="truncate">الحالة: {statusLabel}</span>
              </span>
            )}
          </div>
          {message && (
            <p
              className={cn(
                'font-semibold text-muted-foreground',
                isRichNotice
                  ? 'text-sm leading-7'
                  : 'line-clamp-2 text-xs leading-5',
              )}
            >
              {message}
            </p>
          )}
        </div>
        {action && (
          <div className="mx-auto w-full max-w-xs pt-1 [&_.action-feedback-button]:h-11 [&_.action-feedback-button]:text-sm [&_.action-feedback-button]:font-bold">
            {action}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
