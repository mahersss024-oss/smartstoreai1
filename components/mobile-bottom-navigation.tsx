'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  BadgePlus,
  Heart,
  Home,
  MessageCircle,
  type LucideIcon,
  User,
} from 'lucide-react';

import { useConversationMessageAlert } from '@/hooks/use-conversation-message-alert';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  active?: boolean;
  alert?: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/';
  }

  if (href === '/account') {
    return pathname === '/account';
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
  const { hasConversationAlert } = useConversationMessageAlert();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [isAssistantChatViewOpen, setIsAssistantChatViewOpen] = useState(false);

  useEffect(() => {
    ['/', '/account', '/account/listings', '/favorites', '/conversations'].forEach((href) => {
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
    pathname.startsWith('/conversations/') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api')
  ) {
    return null;
  }

  const items: NavItem[] = [
    { href: '/account/listings', label: 'إعلاناتي', icon: BadgePlus },
    {
      href: '/conversations',
      label: 'محادثاتي',
      icon: MessageCircle,
      alert: hasConversationAlert,
    },
    {
      href: '/',
      label: 'الرئيسية',
      icon: Home,
      primary: true,
      active: pathname === '/',
    },
    { href: '/favorites', label: 'المفضلة', icon: Heart },
    { href: '/account', label: 'حسابي', icon: User },
  ];
  const activeIndex = items.findIndex(
    (item) => item.active ?? isActive(pathname, item.href),
  );
  const indicatorIndex = activeIndex >= 0 ? activeIndex : 2;

  function navigate(href: string) {
    closeAssistantViewForPrimaryNavigation(href);
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <nav
      className={`marketplace-bottom-nav fixed inset-x-3 bottom-[calc(0.45rem+env(safe-area-inset-bottom))] z-50 overflow-visible rounded-full border px-3 py-1.5 transition-all duration-200 lg:hidden ${
        isKeyboardOpen
          ? 'pointer-events-none translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
    >
      <div className="pointer-events-none absolute -inset-x-5 top-full h-[calc(2.4rem+env(safe-area-inset-bottom))] rounded-b-[2.25rem] bg-white/14 backdrop-blur-[32px] backdrop-saturate-[170%] [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.72)_36%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.72)_36%,transparent_100%)] dark:bg-slate-950/28" />
      <div
        className="pointer-events-none absolute -top-px h-0.5 w-1/5 rounded-full bg-blue-500 transition-[right] duration-300 ease-out"
        style={{ right: `${indicatorIndex * (100 / 5)}%` }}
      />
      <div className="relative z-10 grid h-14 grid-cols-5 text-[13px] font-bold text-slate-600 dark:text-slate-300">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.active ?? isActive(pathname, item.href);
          const pending = isPending && pendingHref === item.href;
          const showAlert = Boolean(item.alert && !active);

          return (
            <button
              key={item.label}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              className={`relative grid min-w-0 place-items-center gap-0.5 rounded-2xl transition duration-200 active:scale-95 ${
                active
                  ? 'text-blue-700 dark:text-blue-200'
                  : 'hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              onClick={() => navigate(item.href)}
              type="button"
            >
              <span
                className={`relative grid place-items-center rounded-full transition-all duration-200 ${
                  active
                    ? item.primary
                      ? 'size-10 bg-blue-600 text-white shadow-xl shadow-blue-500/35 ring-4 ring-blue-500/15'
                      : 'size-8 bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                    : showAlert
                      ? 'size-8 bg-rose-500/10 text-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.55)] ring-1 ring-rose-400/60 dark:bg-rose-400/15 dark:text-rose-200 dark:shadow-[0_0_22px_rgba(251,113,133,0.5)]'
                    : item.primary
                      ? 'size-8 bg-blue-50/60 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200'
                    : 'size-8 bg-transparent text-current'
                }`}
              >
                {showAlert && (
                  <>
                    <span className="pointer-events-none absolute top-1.5 h-6 w-6 rounded-full bg-rose-500/25 blur-md" />
                    <span className="absolute top-2 h-2 w-2 rounded-full bg-gradient-to-br from-rose-300 to-red-600 shadow-[0_0_10px_rgba(244,63,94,0.95)]" />
                  </>
                )}
                <Icon className={`relative z-10 ${active && item.primary ? 'size-[1.35rem]' : 'size-[1.1rem]'}`} />
              </span>
              <span className={`truncate leading-4 ${active ? 'font-black' : 'font-bold'}`}>
                {pending ? '...' : item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
