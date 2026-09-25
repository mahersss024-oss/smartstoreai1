'use client';

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';

import { Button } from '@ui/button';

type CommissionAgreementDialogProps = {
  open: boolean;
  mode: 'publish' | 'saleAmount';
  onCancel: () => void;
  onConfirm: () => void;
};

const agreementCopy = {
  publish: {
    oath:
      'أتعهد وأقسم بالله أنني إذا أتممت بيع هذا الإعلان، سواء عن طريق منصة سوق حمد أو بسببها، فسأدخل قيمة البيع النهائية الصحيحة، وأدفع رسوم المنصة المستحقة حسب سياسة الرسوم.',
    checkbox: 'أقسم بالله وأتعهد بذلك',
    action: 'استمرار ونشر الإعلان',
  },
  saleAmount: {
    oath:
      'أتعهد وأقسم بالله أن قيمة البيع النهائية التي أدخلتها صحيحة، وأنني سأدفع رسوم منصة سوق حمد وهي 1% من قيمة البيع، سواء تم البيع عن طريق المنصة أو بسببها.',
    checkbox: 'أقسم بالله أن القيمة صحيحة وأتعهد بدفع الرسوم',
    action: 'استمرار وتسجيل الرسوم',
  },
};

export function CommissionAgreementDialog({
  open,
  mode,
  onCancel,
  onConfirm,
}: CommissionAgreementDialogProps) {
  const [accepted, setAccepted] = useState(false);
  const copy = agreementCopy[mode];

  if (!open) {
    return null;
  }

  function cancelAgreement() {
    setAccepted(false);
    onCancel();
  }

  function confirmAgreement() {
    if (!accepted) {
      return;
    }

    setAccepted(false);
    onConfirm();
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
      <section
        aria-modal="true"
        className="w-full max-w-3xl overflow-hidden rounded-2xl border bg-white text-[#142033] shadow-2xl dark:bg-card dark:text-foreground"
        dir="rtl"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <button
            aria-label="رجوع"
            className="grid size-9 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={cancelAgreement}
            type="button"
          >
            <ArrowRight className="size-5" />
          </button>
          <h2 className="text-lg font-black text-slate-600 dark:text-slate-200">
            اتفاقية الرسوم
          </h2>
        </div>

        <div className="grid gap-5 px-5 py-5 text-sm leading-7">
          <div className="grid gap-1 border-b pb-4 text-center text-slate-500 dark:text-slate-300">
            <span>بسم الله الرحمن الرحيم</span>
            <span>
              قال الله تعالى: &quot;وَأَوْفُوا بِعَهْدِ اللَّهِ إِذَا عَاهَدْتُمْ وَلَا تَنْقُضُوا الْأَيْمَانَ بَعْدَ تَوْكِيدِهَا&quot;
            </span>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 font-bold text-slate-700 transition hover:border-blue-300 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
            <input
              checked={accepted}
              className="mt-1 size-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              onChange={(event) => setAccepted(event.target.checked)}
              type="checkbox"
            />
            <span>{copy.oath}</span>
          </label>

          <p className="text-center font-bold text-slate-600 dark:text-slate-200">
            كما أتعهد بدفع الرسوم خلال 10 أيام من استلام كامل مبلغ المبايعة.
          </p>

          <div className="rounded-xl border border-emerald-300/70 bg-emerald-50 px-4 py-3 text-center text-sm font-bold text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-400/10 dark:text-emerald-200">
            <div className="mb-1">ملاحظة بشأن الرسوم</div>
            <div>رسوم المنصة حق على المعلن، وتبقى في ذمته إلا في حال دفعها.</div>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              className="rounded-md"
              onClick={cancelAgreement}
              type="button"
              variant="outline"
            >
              إلغاء
            </Button>
            <Button
              className="rounded-md bg-blue-600 hover:bg-blue-700"
              disabled={!accepted}
              onClick={confirmAgreement}
              type="button"
            >
              {accepted ? copy.action : copy.checkbox}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
