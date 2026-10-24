import Image from 'next/image';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ArrowUpRight, Clock3, Download, Smartphone } from 'lucide-react';

import {
  detectMobileAppPlatform,
  getMobileAppStoreUrl,
  type MobileAppPlatform,
} from '@/lib/mobile/app-store-links';

type AppStoreCardProps = {
  platform: MobileAppPlatform;
  url: string | null;
};

const platformDetails: Record<MobileAppPlatform, { name: string; store: string }> = {
  android: { name: 'Android', store: 'Google Play' },
  ios: { name: 'iPhone', store: 'App Store' },
};

function AppStoreCard({ platform, url }: AppStoreCardProps) {
  const details = platformDetails[platform];
  const storeName =
    platform === 'ios' && url?.includes('testflight.apple.com')
      ? 'TestFlight'
      : details.store;

  return (
    <section
      aria-label={`تطبيق سوق حمد على ${details.name}`}
      className="grid gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Smartphone aria-hidden="true" className="size-6" />
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            url
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-amber-100 text-amber-900'
          }`}
        >
          {url ? (
            <Download aria-hidden="true" className="size-3.5" />
          ) : (
            <Clock3 aria-hidden="true" className="size-3.5" />
          )}
          {url ? 'متاح للتنزيل' : 'قريبًا'}
        </span>
      </div>

      <div className="grid gap-1">
        <h2 className="text-lg font-bold text-card-foreground">{details.name}</h2>
        <p className="text-sm text-muted-foreground">
          {url
            ? `حمّل تطبيق سوق حمد من ${storeName}.`
            : `سيظهر رابط ${details.store} هنا بعد نشر التطبيق.`}
        </p>
      </div>

      {url ? (
        <a
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={url}
          rel="noreferrer"
        >
          الذهاب إلى {storeName}
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </a>
      ) : (
        <div
          aria-disabled="true"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-muted px-4 py-2.5 text-sm font-semibold text-muted-foreground"
        >
          رابط التحميل غير متاح بعد
        </div>
      )}
    </section>
  );
}

export default async function AppDownloadPage() {
  const requestHeaders = await headers();
  const platform = detectMobileAppPlatform(
    requestHeaders.get('user-agent'),
    requestHeaders.get('sec-ch-ua-platform'),
  );
  const androidStoreUrl = getMobileAppStoreUrl('android');
  const iosStoreUrl = getMobileAppStoreUrl('ios');
  const selectedStoreUrl =
    platform === 'android'
      ? androidStoreUrl
      : platform === 'ios'
        ? iosStoreUrl
        : null;

  if (selectedStoreUrl) {
    redirect(selectedStoreUrl);
  }

  return (
    <main
      className="relative isolate min-h-[calc(100dvh-2rem)] overflow-hidden bg-background px-5 py-12 text-foreground sm:px-8 sm:py-16"
      dir="rtl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-80 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-100 via-background to-background"
      />
      <div className="mx-auto grid w-full max-w-5xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-16">
        <header className="grid justify-items-center gap-5 text-center lg:justify-items-start lg:text-right">
          <Image
            alt="شعار سوق حمد"
            className="rounded-2xl shadow-sm"
            height={76}
            priority
            src="/hamad-market-logo.webp"
            width={76}
          />
          <div className="grid gap-3">
            <p className="text-sm font-bold text-primary">سوق حمد</p>
            <h1 className="max-w-xl text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              سوق حمد في تطبيقك
            </h1>
            <p className="max-w-xl text-base leading-8 text-muted-foreground">
              نجهّز تجربة سوق حمد على Android وiPhone. اختر جهازك لمعرفة حالة
              التحميل، وسيوجهك هذا العنوان إلى المتجر المناسب عند توفر التطبيق.
            </p>
          </div>
          {platform && (
            <a
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-bold text-card-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href="smartstore://"
            >
              افتح التطبيق إذا كان مثبتًا
              <ArrowUpRight aria-hidden="true" className="size-4" />
            </a>
          )}
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <AppStoreCard platform="android" url={androidStoreUrl} />
          <AppStoreCard platform="ios" url={iosStoreUrl} />
        </div>
      </div>
      <p className="mx-auto mt-10 max-w-5xl text-center text-xs leading-6 text-muted-foreground">
        روابط المتاجر ستظهر هنا بعد إتاحة النسخ الرسمية للتنزيل.
      </p>
    </main>
  );
}
