'use client';

import Image from 'next/image';
import { ArrowUpLeft, Check, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';

import type { MobileAppPlatform } from '@/lib/mobile/app-store-links';
import { customerAppDestination } from '@/lib/mobile/customer-destination';
import './app-download-gateway.css';

type AppDownloadGatewayProps = {
  platform: MobileAppPlatform | null;
  androidStoreUrl: string | null;
  iosStoreUrl: string | null;
  targetPath?: string;
};

function StoreOption({ platform, url, recommended }: {
  platform: MobileAppPlatform;
  url: string | null;
  recommended: boolean;
}) {
  const name = platform === 'android' ? 'Android' : 'iPhone';
  const store = platform === 'android' ? 'Google Play'
    : url && new URL(url).hostname === 'testflight.apple.com' ? 'TestFlight' : 'App Store';
  const className = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#102c2c]';

  return <section
    aria-label={`تطبيق ${name}`}
    data-store-platform={platform}
    data-store-state={url ? 'configured' : 'unpublished'}
    className={`rounded-2xl border p-5 ${recommended ? 'border-emerald-200/55 bg-emerald-100/10' : 'border-white/15 bg-white/5'}`}
  >
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-lg font-bold"><Smartphone aria-hidden="true" className="size-5 text-emerald-200" /><span dir="ltr">{name}</span></h2>
      <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-emerald-100">{url ? store : 'قريبًا'}</span>
    </div>
    {url ? <a className={`${className} bg-emerald-200 text-[#0a2525] hover:bg-emerald-100`} href={url} rel="noreferrer">
      الانتقال إلى {store}<ArrowUpLeft aria-hidden="true" className="size-4" />
    </a> : <button className={`${className} cursor-default bg-white/10 text-white/65`} type="button" disabled>
      {name} — قريبًا
    </button>}
    {recommended && <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-100"><Check aria-hidden="true" className="size-3.5" />مناسب لجهازك</p>}
  </section>;
}

export function AppDownloadGateway({ platform, androidStoreUrl, iosStoreUrl, targetPath = '/' }: AppDownloadGatewayProps) {
  const destination = customerAppDestination(targetPath);
  const [openingAttempted, setOpeningAttempted] = useState(false);
  const noStoreLinks = !androidStoreUrl && !iosStoreUrl;

  return <main className="app-download-gateway relative isolate min-h-dvh overflow-hidden bg-[#081b20] px-5 py-9 text-white sm:px-8 sm:py-14" dir="rtl" data-customer-gateway-target={destination.nativePath}>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(28,194,111,0.22),transparent_60%),radial-gradient(ellipse_at_bottom_left,rgba(17,124,139,0.28),transparent_65%)]" />
    <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-5xl flex-col justify-between gap-10 sm:min-h-[calc(100dvh-7rem)]">
      <header className="flex items-center gap-3">
        <Image alt="شعار سوق حمد" src="/hamad-market-logo.webp" width={52} height={52} className="rounded-2xl" priority />
        <span className="text-lg font-bold">سوق حمد</span>
      </header>

      <div className="grid items-center gap-9 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <div className="grid justify-items-start gap-5">
          <p className="text-sm font-semibold text-emerald-200">مكانك للبيع والشراء</p>
          <h1 className="max-w-md text-4xl font-black leading-[1.4] tracking-tight sm:text-5xl">سوق حمد<br />على جوالك</h1>
          <p className="max-w-md text-base leading-8 text-slate-200">تابع إعلاناتك ومحادثاتك، وابحث عمّا تحتاجه من تطبيق سوق حمد على Android وiPhone.</p>
          {platform ? <div className="grid w-full max-w-md gap-3">
            <a href={destination.launchUrl} data-app-launch onClick={() => setOpeningAttempted(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-200 px-5 py-3 font-bold text-[#0a2525] transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#102c2c]">
              فتح التطبيق<ArrowUpLeft aria-hidden="true" className="size-4" />
            </a>
            <p className="text-sm leading-7 text-slate-300" aria-live="polite">{openingAttempted
              ? 'إذا لم يفتح التطبيق، تأكد أنه مثبت على جوالك. ستظهر روابط التحميل الرسمية أدناه عند إتاحتها.'
              : 'إذا كان التطبيق مثبتًا على جوالك، يمكنك فتحه مباشرة.'}</p>
          </div> : <div className="flex max-w-md items-center gap-4 rounded-2xl border border-white/15 bg-white/5 p-4" data-app-download-qr>
            <a href={destination.webUrl} aria-label="رابط سوق حمد للجوال" className="shrink-0 rounded-xl bg-white p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">
              <QRCodeSVG value={destination.webUrl} title="افتح سوق حمد على جوالك" size={104} marginSize={4} fgColor="#0a2525" bgColor="#ffffff" />
            </a>
            <div className="grid gap-1"><h2 className="text-sm font-bold">افتح الصفحة على جوالك</h2><p className="text-xs leading-6 text-slate-300">امسح الرمز بالكاميرا للوصول إلى خيارات Android وiPhone.</p></div>
          </div>}
        </div>

        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <StoreOption platform="android" url={androidStoreUrl} recommended={platform === 'android'} />
            <StoreOption platform="ios" url={iosStoreUrl} recommended={platform === 'ios'} />
          </div>
          <p className="px-1 text-sm leading-7 text-slate-300" role="status">{noStoreLinks
            ? 'روابط التحميل الرسمية ستظهر هنا بعد نشر التطبيق.'
            : 'اختر جهازك للانتقال إلى رابط المتجر الرسمي. إتاحة التنزيل يحددها المتجر.'}</p>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5 text-xs text-slate-300">
        <span>سوق حمد</span>
        <div className="flex gap-5"><a className="hover:text-white" href="/privacy">الخصوصية</a><a className="hover:text-white" href="/terms">الشروط والأحكام</a></div>
      </footer>
    </div>
  </main>;
}
