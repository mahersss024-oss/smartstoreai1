'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const dismissalStorageKey = 'smartstore_pwa_install_dismissed_at';
const dismissalTtlMs = 1000 * 60 * 60 * 24 * 14;

function isStandaloneDisplay() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function wasRecentlyDismissed() {
  try {
    const raw = window.localStorage.getItem(dismissalStorageKey);

    if (!raw) {
      return false;
    }

    const dismissedAt = Number.parseInt(raw, 10);

    return (
      Number.isFinite(dismissedAt) && Date.now() - dismissedAt < dismissalTtlMs
    );
  } catch {
    return false;
  }
}

export function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isStandaloneDisplay() || wasRecentlyDismissed()) {
      return;
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  function dismiss() {
    setIsVisible(false);
    setDeferredPrompt(null);

    try {
      window.localStorage.setItem(dismissalStorageKey, String(Date.now()));
    } catch {
      // Ignore storage failures.
    }
  }

  async function install() {
    if (!deferredPrompt) {
      return;
    }

    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      dismiss();
    }
  }

  if (!isVisible || !deferredPrompt) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-3 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-2xl border bg-white/98 p-3 shadow-2xl shadow-slate-950/15 backdrop-blur dark:bg-card/98 lg:hidden"
      role="dialog"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
        <Download className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">ثبّت تطبيق SmartStore AI</p>
        <p className="truncate text-xs text-muted-foreground">
          وصول أسرع للسوق من الشاشة الرئيسية.
        </p>
      </div>
      <button
        className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-700"
        onClick={() => void install()}
        type="button"
      >
        تثبيت
      </button>
      <button
        aria-label="إغلاق"
        className="grid size-8 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        onClick={dismiss}
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
