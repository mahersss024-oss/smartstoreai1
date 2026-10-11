'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

import { isInsideNativeApp } from '@/lib/native/app-bridge';

type MobilePlatform = 'android' | 'ios';

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

    setPlatform(mobilePlatform);
  }, []);

  if (!platform) {
    return null;
  }

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
    <div className="relative z-[10] border-b border-slate-200/80 bg-white/95 px-3 py-2 text-slate-950 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md items-center gap-3">
        <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-[#013e51]">
          <Image
            alt="سوق حمد"
            className="h-full w-full object-contain"
            height={48}
            src="/hamad-market-logo.webp"
            width={48}
          />
        </div>
        <div className="min-w-0 flex-1 text-right">
          <span className="block truncate text-sm font-bold leading-5">سوق حمد</span>
          <span className="block truncate text-xs leading-5 text-slate-500">
            تجربة أفضل عبر التطبيق
          </span>
        </div>
        <button
          type="button"
          onClick={openInApp}
          disabled={isOpening}
          className="shrink-0 rounded-full bg-blue-600 px-4 py-1.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-70"
          aria-label="فتح سوق حمد في التطبيق"
        >
          فتح
        </button>
      </div>
    </div>
  );
}
