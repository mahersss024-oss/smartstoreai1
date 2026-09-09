'use client';
/* eslint-disable @next/next/no-img-element */

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Percent, ShieldCheck, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';

export default function CommissionAgreementPage() {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const submitAgreement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!accepted) {
      setError('يجب الموافقة على الإقرار قبل التسجيل.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/commission-agreement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true }),
      });

      if (!response.ok) {
        setError('تعذر حفظ الإقرار الآن.');
        return;
      }

      router.push('/api/auth/google/start');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-4xl content-center gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">إقرار التسجيل</h1>
              <p className="truncate text-xs text-muted-foreground">
                SmartStore AI سوق ذكي للتسويق للمنتجات
              </p>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        <section className="grid gap-5 rounded-md border bg-white p-5 shadow-sm dark:bg-card md:grid-cols-[16rem_1fr]">
          <div className="grid content-start gap-4 rounded-md bg-blue-50 p-4 text-blue-950 dark:bg-blue-400/10 dark:text-blue-50">
            <div className="grid size-14 place-items-center rounded-md bg-white text-blue-700 shadow-sm dark:bg-background dark:text-blue-200">
              <Percent className="size-7" />
            </div>
            <div>
              <div className="text-3xl font-bold">1%</div>
              <p className="mt-1 text-sm leading-7">
                عمولة مستحقة من قيمة المنتج عند إتمام البيع عن طريق الموقع.
              </p>
            </div>
          </div>

          <form className="grid gap-5" onSubmit={submitAgreement}>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                <ShieldCheck className="size-4" />
                قبل التسجيل
              </div>
              <h2 className="text-2xl font-bold leading-9">
                إقرار عمولة SmartStore AI
              </h2>
              <p className="mt-3 text-sm leading-8 text-muted-foreground">
                أقر بأنني إذا أتممت عملية بيع منتج عن طريق SmartStore AI، فإنني أوافق على دفع عمولة مقدارها 1% من قيمة المنتج. لا تمنع هذه الخطوة التصفح أو السؤال، لكنها مطلوبة قبل إنشاء حساب وتنفيذ العمليات المرتبطة بالحساب.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/terms">
                  شروط الاستخدام
                </Link>
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/commission-policy">
                  سياسة العمولة
                </Link>
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/listing-policy">
                  سياسة الإعلانات
                </Link>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-[#f7f9fc] p-4 text-sm leading-7 dark:bg-background">
              <input
                checked={accepted}
                className="mt-1 size-4 accent-blue-600"
                onChange={(event) => setAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>
                أوافق على إقرار عمولة 1% من قيمة المنتج إذا تمت عملية البيع عن طريق الموقع.
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
                <BadgeCheck className="mt-1 size-4 shrink-0 text-blue-600" />
                يتم حفظ الإقرار قبل تحويلك إلى تسجيل Google.
              </div>
              <Button
                className="rounded-md bg-blue-600 hover:bg-blue-700"
                disabled={!accepted || isLoading}
                type="submit"
              >
                <User className="size-4" />
                الموافقة والمتابعة
              </Button>
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
