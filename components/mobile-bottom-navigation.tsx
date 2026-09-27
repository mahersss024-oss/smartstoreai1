'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
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
    ['/', '/account', '/conversations'].forEach((href) => {
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
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api')
  ) {
    return null;
  }

  const items: NavItem[] = [
    { href: '/account', label: 'حسابي', icon: User },
    {
      href: '/',
      label: 'الرئيسية',
      icon: Home,
      primary: true,
      active: pathname === '/',
    },
    {
      href: '/conversations',
      label: 'محادثاتي',
      icon: MessageCircle,
      alert: hasConversationAlert,
    },
  ];

  const activeIndex = items.findIndex(
    (item) => item.active ?? isActive(pathname, item.href),
  );
  const indicatorIndex = activeIndex >= 0 ? activeIndex : 1;

  function navigate(href: string) {
    closeAssistantViewForPrimaryNavigation(href);
    setPendingHref(href);
    startTransition(() => {
      router.push(href);
    });
  }

  return (
    <nav
      className={`marketplace-bottom-nav fixed inset-x-0 bottom-0 z-50 border-t bg-white/95 px-6 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur transition-all duration-200 dark:bg-card/95 lg:hidden ${
        isKeyboardOpen
          ? 'pointer-events-none translate-y-full opacity-0'
          : 'translate-y-0 opacity-100'
      }`}
    >
      <div
        className="pointer-events-none absolute top-0 h-0.5 w-1/3 rounded-full bg-blue-500 transition-[right] duration-300 ease-out"
        style={{ right: `${indicatorIndex * (100 / 3)}%` }}
      />
      <div className="grid h-16 grid-cols-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
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
              className={`relative grid min-w-0 place-items-center gap-1 rounded-2xl transition duration-200 active:scale-95 ${
                active
                  ? 'text-blue-600 dark:text-blue-300'
                  : 'hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              onClick={() => navigate(item.href)}
              type="button"
            >
              <span
                className={`relative grid place-items-center rounded-full transition-all duration-200 ${
                  active
                    ? 'size-10 bg-blue-600 text-white shadow-lg shadow-blue-500/25'
                    : showAlert
                      ? 'size-9 bg-rose-500/10 text-rose-500 shadow-[0_0_18px_rgba(244,63,94,0.55)] ring-1 ring-rose-400/60 dark:bg-rose-400/15 dark:text-rose-200 dark:shadow-[0_0_22px_rgba(251,113,133,0.5)]'
                    : item.primary
                      ? 'size-10 bg-transparent text-current'
                    : 'size-8 bg-transparent text-current'
                }`}
              >
                {showAlert && (
                  <>
                    <span className="pointer-events-none absolute top-2 h-7 w-7 rounded-full bg-rose-500/25 blur-md" />
                    <span className="absolute top-2.5 h-2 w-2 rounded-full bg-gradient-to-br from-rose-300 to-red-600 shadow-[0_0_10px_rgba(244,63,94,0.95)]" />
                  </>
                )}
                <Icon className="relative z-10 size-5" />
              </span>
              <span className="truncate">{pending ? '...' : item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
