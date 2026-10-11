'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Trash2 } from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { Button } from '@ui/button';

type Notice = {
  tone: 'success' | 'danger' | 'info';
  message: string;
};

export function DeleteAccountAction() {
  const router = useRouter();
  const [acknowledged, setAcknowledged] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const deleteAccount = async () => {
    setIsDeleting(true);
    setNotice(null);

    try {
      const response = await fetch('/api/account/profile', {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        setIsConfirmOpen(false);
        setNotice({
          tone: 'danger',
          message: 'سجل الدخول إلى حسابك أولًا ثم ارجع إلى صفحة حذف الحساب.',
        });
        return;
      }

      if (!response.ok) {
        setIsConfirmOpen(false);
        setNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر حذف الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      setIsConfirmOpen(false);
      setNotice({
        tone: 'success',
        message: 'تم حذف الحساب وتسجيل الخروج.',
      });
      router.replace('/');
      router.refresh();
    } catch {
      setIsConfirmOpen(false);
      setNotice({
        tone: 'danger',
        message: 'تعذر حذف الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-md border border-red-300/70 bg-red-50/80 p-5 text-red-950 shadow-sm dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-100">
      <FloatingActionNotice
        message={notice?.message}
        onDismiss={() => setNotice(null)}
        open={Boolean(notice)}
        tone={notice?.tone ?? 'info'}
      />
      <ActionConfirmDialog
        confirmLabel="تأكيد حذف الحساب"
        description="سيتم تنفيذ طلب حذف الحساب باستخدام الجلسة الحالية. هذا الإجراء سيخرجك من الحساب بعد نجاح الحذف."
        loading={isDeleting}
        loadingText="جاري حذف الحساب..."
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          void deleteAccount();
        }}
        open={isConfirmOpen}
        title="تأكيد حذف الحساب"
        tone="danger"
      />
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-md bg-red-100 text-red-700 dark:bg-red-300/15 dark:text-red-100">
          <AlertTriangle className="size-5" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 className="text-lg font-black">تنفيذ حذف الحساب</h2>
          <p className="text-sm leading-7 text-red-800/85 dark:text-red-100/80">
            هذا الزر مخصص لصاحب الحساب المسجل دخوله حاليًا. اقرأ تفاصيل الحذف أعلاه ثم فعّل التأكيد قبل المتابعة.
          </p>
        </div>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-red-200/80 bg-white/70 p-3 text-sm leading-7 dark:border-red-400/20 dark:bg-background/30">
        <input
          checked={acknowledged}
          className="mt-2 size-4 shrink-0 accent-red-600"
          onChange={(event) => setAcknowledged(event.target.checked)}
          type="checkbox"
        />
        <span>
          أفهم أن حذف الحساب قد يؤدي إلى فقدان الوصول إلى بيانات الحساب والإعلانات والمحادثات والمفضلة المرتبطة به.
        </span>
      </label>
      <Button
        className="h-11 rounded-md"
        disabled={!acknowledged}
        onClick={() => setIsConfirmOpen(true)}
        type="button"
        variant="destructive"
      >
        <Trash2 className="size-4" />
        حذف الحساب
      </Button>
    </section>
  );
}
