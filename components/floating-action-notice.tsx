'use client';

import { type ReactNode, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

type FloatingActionNoticeTone = 'success' | 'warning' | 'danger' | 'info';

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
    card: string;
    icon: string;
    title: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    card: 'border-emerald-200 bg-white text-slate-900 shadow-emerald-950/10 dark:border-emerald-400/20 dark:bg-card dark:text-foreground',
    icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-200',
    title: 'text-emerald-700 dark:text-emerald-200',
    Icon: CheckCircle2,
  },
  warning: {
    card: 'border-amber-200 bg-white text-slate-900 shadow-amber-950/10 dark:border-amber-400/20 dark:bg-card dark:text-foreground',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-100',
    title: 'text-amber-800 dark:text-amber-100',
    Icon: AlertTriangle,
  },
  danger: {
    card: 'border-red-200 bg-white text-slate-900 shadow-red-950/10 dark:border-red-400/20 dark:bg-card dark:text-foreground',
    icon: 'bg-red-100 text-red-600 dark:bg-red-400/15 dark:text-red-200',
    title: 'text-red-700 dark:text-red-200',
    Icon: XCircle,
  },
  info: {
    card: 'border-blue-200 bg-white text-slate-900 shadow-blue-950/10 dark:border-blue-400/20 dark:bg-card dark:text-foreground',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-100',
    title: 'text-blue-800 dark:text-blue-100',
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
  const toneConfig = toneClasses[tone];
  const Icon = toneConfig.Icon;

  useEffect(() => {
    if (!open || durationMs <= 0) {
      return;
    }

    const timeoutId = window.setTimeout(onDismiss, durationMs);

    return () => window.clearTimeout(timeoutId);
  }, [durationMs, onDismiss, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      aria-live={tone === 'success' || tone === 'info' ? 'polite' : 'assertive'}
      className="pointer-events-none fixed inset-x-0 top-1/2 z-[70] grid -translate-y-1/2 place-items-center px-4 [padding-bottom:env(safe-area-inset-bottom)] [padding-top:env(safe-area-inset-top)]"
      dir="rtl"
      role={tone === 'success' || tone === 'info' ? 'status' : 'alert'}
    >
      <section
        className={cn(
          'pointer-events-auto relative grid w-full max-w-[22rem] gap-3 rounded-lg border px-4 pb-4 pt-5 text-center shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-white/95 dark:supports-[backdrop-filter]:bg-card/95',
          'motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200',
          toneConfig.card,
        )}
      >
        <button
          aria-label={closeLabel}
          className="absolute left-2 top-2 grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
          onClick={onDismiss}
          type="button"
        >
          <X className="size-5" />
        </button>
        <div
          className={cn(
            'mx-auto grid size-14 place-items-center rounded-full shadow-inner',
            toneConfig.icon,
          )}
        >
          <Icon className="size-8" />
        </div>
        <div className="grid gap-1 px-8">
          {title && (
            <h3 className={cn('text-base font-black', toneConfig.title)}>
              {title}
            </h3>
          )}
          {statusLabel && (
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              الحالة: {statusLabel}
            </p>
          )}
          {message && (
            <p className="text-xs font-semibold leading-6 text-muted-foreground">
              {message}
            </p>
          )}
        </div>
        {action && <div className="mx-auto w-full max-w-xs">{action}</div>}
      </section>
    </div>
  );
}
