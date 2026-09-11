import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = {
  title: 'لا يوجد اتصال | SmartStore AI',
  description: 'SmartStore AI يحتاج اتصالًا بالإنترنت لعرض الإعلانات والمحادثات.',
};

export default function OfflinePage() {
  return (
    <main
      className="grid min-h-screen place-items-center bg-[#e8edf3] px-4 text-[#142033] dark:bg-[#0a111c] dark:text-foreground"
      dir="rtl"
    >
      <div className="grid max-w-md gap-4 rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
        <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
          <WifiOff className="size-7" />
        </div>
        <h1 className="text-xl font-bold">لا يوجد اتصال بالإنترنت</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          تعذّر الوصول إلى سوق SmartStore AI. تحقّق من اتصالك بالشبكة ثم أعد
          المحاولة. لن تُفقد أي بيانات محفوظة أثناء انقطاع الاتصال.
        </p>
        <Link
          className="mx-auto inline-flex h-10 items-center justify-center rounded-md bg-blue-600 px-5 text-sm font-semibold text-white transition hover:bg-blue-700"
          href="/"
        >
          إعادة المحاولة
        </Link>
      </div>
    </main>
  );
}
