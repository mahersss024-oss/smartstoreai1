'use client';

import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';

import { Button } from '@ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';

type ActionConfirmDialogTone = 'default' | 'danger' | 'success';

type ActionConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel: string;
  description: string;
  loading?: boolean;
  loadingText?: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
  tone?: ActionConfirmDialogTone;
};

const toneConfig = {
  default: {
    iconClass: 'bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-100',
    Icon: AlertTriangle,
    variant: 'default' as const,
  },
  danger: {
    iconClass: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-200',
    Icon: Trash2,
    variant: 'destructive' as const,
  },
  success: {
    iconClass:
      'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-100',
    Icon: CheckCircle2,
    variant: 'default' as const,
  },
};

export function ActionConfirmDialog({
  cancelLabel = 'إلغاء',
  confirmLabel,
  description,
  loading = false,
  loadingText = 'جاري التنفيذ...',
  onCancel,
  onConfirm,
  open,
  title,
  tone = 'default',
}: ActionConfirmDialogProps) {
  const config = toneConfig[tone];
  const Icon = config.Icon;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !loading) {
          onCancel();
        }
      }}
    >
      <DialogContent className="max-w-[22rem] rounded-lg p-0 text-right" dir="rtl">
        <div className="grid gap-4 px-5 pb-5 pt-6">
          <DialogHeader className="items-center text-center">
            <div className={`grid size-12 place-items-center rounded-full ${config.iconClass}`}>
              <Icon className="size-6" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-950 dark:text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              {description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid gap-2 sm:grid-cols-2 sm:gap-2">
            <Button
              className="rounded-md"
              loading={loading}
              loadingText={loadingText}
              onClick={onConfirm}
              type="button"
              variant={config.variant}
            >
              {confirmLabel}
            </Button>
            <Button
              className="rounded-md"
              disabled={loading}
              onClick={onCancel}
              type="button"
              variant="outline"
            >
              {cancelLabel}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
