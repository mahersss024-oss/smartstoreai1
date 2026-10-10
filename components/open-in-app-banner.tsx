'use client';

import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';

import { isInsideNativeApp } from '@/lib/native/app-bridge';

type MobilePlatform = 'android' | 'ios';

const dismissedKey = 'souq-hamad-open-app-banner-dismissed-v1';

function detectMobilePlatform(): MobilePlatform | null {
  const userAgent = navigator.userAgent;

  if (/android/i.test(userAgent)) {
    return 'android';
  }

  if (/iphone|ipad|ipod/i.test(userAgent)) {
    return 'ios';
  }

  return null;
}

function getCurrentNextPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function OpenInAppBanner() {
  const [platform, setPlatform] = useState<MobilePlatform | null>(null);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    if (isInsideNativeApp()) {
      return;
    }

    const mobilePlatform = detectMobilePlatform();

    if (!mobilePlatform) {
      return;
    }

    if (window.localStorage.getItem(dismissedKey) === '1') {
      return;
    }

    setPlatform(mobilePlatform);
  }, []);

  if (!platform) {
    return null;
  }

  const closeBanner = () => {
    window.localStorage.setItem(dismissedKey, '1');
    setPlatform(null);
  };

  const openInApp = async () => {
    if (isOpening) {
      return;
    }

    setIsOpening(true);

    try {
      const params = new URLSearchParams({
        platform,
        next: getCurrentNextPath(),
      });
      const response = await fetch(`/api/auth/mobile/open?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error('Unable to prepare app link.');
      }

      const payload = (await response.json()) as {
        launchUrl?: string;
        storeUrl?: string | null;
      };

      if (!payload.launchUrl) {
        throw new Error('Missing app launch URL.');
      }

      if (platform === 'ios' && payload.storeUrl) {
        const startedAt = Date.now();
        window.setTimeout(() => {
          if (document.visibilityState === 'visible' && Date.now() - startedAt > 900) {
            window.location.href = payload.storeUrl as string;
          }
        }, 1200);
      }

      window.location.href = payload.launchUrl;
    } catch {
      setIsOpening(false);
    }
  };

  return (
    <div className="sticky inset-x-0 top-0 z-[50] bg-white/90 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-sky-200/80 bg-white/95 px-3 py-2 text-slate-900 shadow-lg shadow-sky-950/10">
        <button
          type="button"
          onClick={closeBanner}
          className="grid size-8 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          aria-label="إغلاق شريط فتح التطبيق"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={openInApp}
          disabled={isOpening}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-sky-50 px-3 py-2 text-right transition hover:bg-sky-100 disabled:opacity-70"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">فتح في التطبيق</span>
            <span className="block truncate text-xs text-slate-500">
              تجربة أسرع مع نفس حسابك
            </span>
          </span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-500 text-white">
            <Smartphone className="size-4" aria-hidden="true" />
          </span>
        </button>
      </div>
    </div>
  );
}
