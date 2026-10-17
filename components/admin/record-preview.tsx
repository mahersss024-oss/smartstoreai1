'use client';

import { useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@ui/button';
import { useOverlayViewport } from '@/hooks/use-overlay-viewport';

export function AdminRecordPreview({
  open,
  title,
  children,
  dirty,
  busy,
  onClose,
  onPrevious,
  onNext,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  dirty: boolean;
  busy: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const viewportRef = useOverlayViewport<HTMLDivElement>();
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  function request(action: () => void) {
    if (busy) return;
    if (dirty) setLeave(() => action);
    else action();
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) request(onClose);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="admin-preview-backdrop" />
        <Dialog.Content
          ref={viewportRef}
          className="admin-preview"
          dir="rtl"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <header className="admin-preview-heading">
            <Dialog.Title className="text-base font-bold">{title}</Dialog.Title>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                title="السجل السابق"
                aria-label="السجل السابق"
                disabled={busy || !onPrevious}
                onClick={() => onPrevious && request(onPrevious)}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="السجل التالي"
                aria-label="السجل التالي"
                disabled={busy || !onNext}
                onClick={() => onNext && request(onNext)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="إغلاق المعاينة"
                aria-label="إغلاق المعاينة"
                disabled={busy}
                onClick={() => request(onClose)}
              >
                <X className="size-4" />
              </Button>
            </div>
          </header>
          {dirty && (
            <p className="admin-draft-state" role="status">
              تعديلات غير محفوظة
            </p>
          )}
          {leave && (
            <div className="admin-leave-confirm" role="alert">
              <p>لم تُحفظ التعديلات. ستبقى مسودة في هذه الصفحة.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => setLeave(null)}>
                  العودة للتعديل
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    leave();
                    setLeave(null);
                  }}
                >
                  متابعة دون حفظ
                </Button>
              </div>
            </div>
          )}
          <div className="admin-preview-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
