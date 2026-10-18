import Link from 'next/link';
import { ArrowRight, SearchX } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-16 text-foreground" dir="rtl">
      <div className="grid max-w-md justify-items-center gap-4 text-center">
        <SearchX aria-hidden="true" className="size-10 text-muted-foreground" />
        <h1 className="text-xl font-bold">الصفحة غير موجودة</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          تعذر العثور على الصفحة المطلوبة. ربما أُزيلت أو تغيّر رابطها.
        </p>
        <Link
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/"
        >
          <ArrowRight aria-hidden="true" className="size-4" />
          العودة للسوق
        </Link>
      </div>
    </main>
  );
}
