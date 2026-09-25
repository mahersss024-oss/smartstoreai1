'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronDown,
  FileText,
  Grid2X2,
  Home,
  MessageCircle,
  Percent,
  ShieldCheck,
  Store,
  type LucideIcon,
  User,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  active?: boolean;
  action?: 'more';
};

function isActive(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function closeAssistantViewForPrimaryNavigation(href: string) {
  if (href !== '/' && href !== '/account') {
    return;
  }

  window.dispatchEvent(new Event('smartstore:close-assistant-view'));
}

export function MobileBottomNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isAssistantChatViewOpen, setIsAssistantChatViewOpen] = useState(false);

  useEffect(() => {
    ['/', '/account', '/conversations', '/terms'].forEach((href) => {
      router.prefetch(href);
    });
  }, [router]);

  useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
        ),
      );

    const syncKeyboardState = () => {
      setIsKeyboardOpen(isTextEntryTarget(document.activeElement));
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isTextEntryTarget(event.target)) {
        return;
      }

      setIsMoreOpen(false);
      setIsKeyboardOpen(true);
    };

    const handleFocusOut = () => {
      window.setTimeout(syncKeyboardState, 80);
    };

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setIsKeyboardOpen(false);
      setIsMoreOpen(false);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [pathname]);

  useEffect(() => {
    const syncAssistantChatView = () => {
      setIsAssistantChatViewOpen(
        pathname === '/' &&
          new URL(window.location.href).searchParams.get('chat') === '1',
      );
    };

    syncAssistantChatView();
    window.addEventListener('popstate', syncAssistantChatView);
    window.addEventListener(
      'smartstore:assistant-chat-view-change',
      syncAssistantChatView,
    );

    return () => {
      window.removeEventListener('popstate', syncAssistantChatView);
      window.removeEventListener(
        'smartstore:assistant-chat-view-change',
        syncAssistantChatView,
      );
    };
  }, [pathname]);

  if (
    isAssistantChatViewOpen ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api')
  ) {
    return null;
  }

  const moreLinks = [
    { href: '/terms', label: 'الشروط', icon: FileText },
    { href: '/privacy', label: 'الخصوصية', icon: ShieldCheck },
    { href: '/listing-policy', label: 'سياسة الإعلانات', icon: Store },
    { href: '/commission-policy', label: 'سياسة رسوم المنصة', icon: Percent },
  ];

  const moreActive = moreLinks.some((item) => isActive(pathname, item.href));
  const items: NavItem[] = [
    { href: '/account', label: 'حسابي', icon: User },
    {
      href: '/conversations',
      label: 'محادثاتي',
      icon: MessageCircle,
    },
    {
      href: '/',
      label: 'الرئيسية',
      icon: Home,
      primary: true,
      active: pathname === '/',
    },
    {
      href: '/terms',
      label: 'المزيد',
      icon: Grid2X2,
      action: 'more',
      active: moreActive,
    },
  ];

  const activeIndex = items.findIndex(
    (item) => item.active ?? isActive(pathname, item.href),
  );
  const indicatorIndex = activeIndex >= 0 ? activeIndex : 1;

  function navigate(href: string) {
    closeAssistantViewForPrimaryNavigation(href);
    setPendingHref(href);
    setIsMoreOpen(false);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <>
      {isMoreOpen && !isKeyboardOpen && (
        <button
          aria-label="إغلاق المزيد"
          className="fixed inset-0 z-40 bg-slate-950/15 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsMoreOpen(false)}
          type="button"
        />
      )}

      <div
        className={`fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 overflow-hidden rounded-2xl border bg-white/98 p-2 shadow-2xl shadow-slate-950/15 transition-all duration-200 dark:bg-card/98 lg:hidden ${
          isMoreOpen && !isKeyboardOpen
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <div className="mb-2 flex items-center justify-between px-2">
          <span className="text-sm font-bold">المزيد</span>
          <button
            aria-label="إغلاق"
            className="grid size-8 place-items-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            onClick={() => setIsMoreOpen(false)}
            type="button"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {moreLinks.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.href}
                className="flex h-12 items-center gap-2 rounded-xl border bg-slate-50 px-3 text-right text-sm font-semibold transition active:scale-[0.98] dark:bg-background"
                onClick={() => navigate(item.href)}
                type="button"
              >
                <Icon className="size-4 text-blue-600" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <nav
        className={`fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur transition-all duration-200 dark:bg-card/95 lg:hidden ${
          isKeyboardOpen
            ? 'pointer-events-none translate-y-full opacity-0'
            : 'translate-y-0 opacity-100'
        }`}
      >
        <div
          className="pointer-events-none absolute top-0 h-0.5 w-1/4 rounded-full bg-blue-500 transition-[right] duration-300 ease-out"
          style={{ right: `${indicatorIndex * 25}%` }}
        />
        <div className="grid h-16 grid-cols-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {items.map((item) => {
            const Icon = item.icon;
            const active = item.active ?? isActive(pathname, item.href);
            const pending = isPending && pendingHref === item.href;

            return (
              <button
                key={item.label}
                aria-current={active ? 'page' : undefined}
                aria-label={item.label}
                className={`relative grid min-w-0 place-items-center gap-1 rounded-2xl transition duration-200 active:scale-95 ${
                  active
                    ? 'text-blue-600 dark:text-blue-300'
                    : 'hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                onClick={() => {
                  if (item.action === 'more') {
                    setIsMoreOpen((open) => !open);
                    return;
                  }

                  navigate(item.href);
                }}
                type="button"
              >
                {item.primary ? (
                  <span
                    className={`grid size-10 place-items-center rounded-full transition-all duration-200 ${
                      active
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                        : 'bg-transparent text-current'
                    }`}
                  >
                    <Icon className="size-5" />
                  </span>
                ) : (
                  <span
                    className={`grid size-8 place-items-center rounded-full transition-colors ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-400/10'
                        : 'bg-transparent'
                    }`}
                  >
                    <Icon className="size-5" />
                  </span>
                )}
                <span className="truncate">{pending ? '...' : item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
