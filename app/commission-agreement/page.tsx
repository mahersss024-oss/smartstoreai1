'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Percent, ShieldCheck, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

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

      const provider =
        new URLSearchParams(window.location.search).get('provider') === 'apple'
          ? 'apple'
          : 'google';
      const nativeFallback =
        new URLSearchParams(window.location.search).get('native_fallback') === '1';
      const returnTo = new URLSearchParams(window.location.search).get('return_to');
      const params = new URLSearchParams();
      if (nativeFallback) params.set('native_fallback', '1');
      if (provider === 'google' && returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
        params.set('return_to', returnTo);
      }
      router.push(`/api/auth/${provider}/start${params.size ? `?${params}` : ''}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="commission-agreement-page min-h-screen touch-pan-y overflow-y-auto bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-4xl content-center gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-6">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">إقرار التسجيل</h1>
              <p className="truncate text-xs text-muted-foreground">
                سوق حمد سوق ذكي للتسويق للمنتجات
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-3 p-3 sm:gap-5 sm:p-5 md:grid-cols-[16rem_1fr]">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] content-start items-center gap-3 rounded-md bg-blue-50 p-3 text-blue-950 dark:bg-blue-400/10 dark:text-blue-50 md:grid-cols-1 md:items-start md:gap-4 md:p-4">
            <div className="grid size-10 place-items-center rounded-md bg-white text-blue-700 shadow-sm dark:bg-background dark:text-blue-200 md:size-14">
              <Percent className="size-5 md:size-7" />
            </div>
            <div>
              <div className="text-2xl font-bold md:text-3xl">1%</div>
              <p className="mt-0.5 text-xs leading-5 md:mt-1 md:text-sm md:leading-7">
                رسوم المنصة: 1% من قيمة البيع المكتمل عبر سوق حمد.
              </p>
            </div>
          </div>

          <form className="grid gap-3 md:gap-5" onSubmit={submitAgreement}>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                <ShieldCheck className="size-4" />
                قبل التسجيل
              </div>
              <h2 className="text-xl font-bold leading-7 md:text-2xl md:leading-9">
                إقرار استخدام سوق حمد
              </h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground md:mt-3 md:leading-8">
                اطلعت على السياسات الأربع وأوافق عليها، وأتعهد بدفع 1% من قيمة البيع المكتمل عبر سوق حمد. يلزم الإقرار لإنشاء الحساب، ولا يمنع التصفح أو الأسئلة العامة.
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 md:mt-3">
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/terms" prefetch={false}>
                  شروط الاستخدام
                </Link>
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/privacy" prefetch={false}>
                  سياسة الخصوصية
                </Link>
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/listing-policy" prefetch={false}>
                  سياسة الإعلانات
                </Link>
                <Link className="inline-flex h-9 items-center rounded-md border px-2 hover:bg-blue-50 dark:hover:bg-blue-400/10" href="/commission-policy" prefetch={false}>
                  سياسة رسوم المنصة
                </Link>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-[#f7f9fc] p-3 text-sm leading-6 dark:bg-background md:p-4">
              <input
                checked={accepted}
                className="mt-1 size-4 accent-blue-600"
                id="platform-agreement-accepted"
                name="platformAgreementAccepted"
                onChange={(event) => setAccepted(event.target.checked)}
                type="checkbox"
              />
              <span>
                أقر باطلاعي وموافقتي على السياسات الأربع، وبرسوم المنصة 1% من قيمة البيع المكتمل عبر سوق حمد.
              </span>
            </label>

            <div className="fixed inset-x-0 bottom-0 z-40 mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-200 bg-[#e8edf3]/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-700 dark:bg-[#0a111c]/95 sm:static sm:grid-cols-[1fr_auto] sm:gap-3 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
              <div className="flex items-start gap-2 text-xs leading-4 text-muted-foreground">
                <BadgeCheck className="mt-1 size-4 shrink-0 text-blue-600" />
                يتم حفظ الإقرار قبل تحويلك إلى مزود الدخول المختار.
              </div>
              <Button
                className="w-full rounded-md bg-blue-600 hover:bg-blue-700 sm:w-auto"
                disabled={!accepted || isLoading}
                type="submit"
              >
                <User className="size-4" />
                الموافقة والمتابعة
              </Button>
            </div>

            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </form>
        </section>
      </div>
    </main>
  );
}
