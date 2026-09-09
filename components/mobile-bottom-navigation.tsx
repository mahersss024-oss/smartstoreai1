'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid2X2, Heart, Home, Store, User } from 'lucide-react';

function isActive(pathname: string, href: string) {
  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileBottomNavigation() {
  const pathname = usePathname();

  if (pathname.startsWith('/admin') || pathname.startsWith('/api')) {
    return null;
  }

  const moreActive = [
    '/terms',
    '/privacy',
    '/listing-policy',
    '/commission-policy',
  ].some((href) => isActive(pathname, href));

  const items = [
    { href: '/account', label: 'حسابي', icon: User },
    { href: '/favorites', label: 'المفضلة', icon: Heart },
    { href: '/', label: 'الرئيسية', icon: Home, primary: true },
    {
      href: '/#suggested-listings',
      label: 'الإعلانات',
      icon: Store,
      onClick: () => {
        window.dispatchEvent(new Event('smartstore:collapse-assistant'));
      },
    },
    { href: '/terms', label: 'المزيد', icon: Grid2X2, active: moreActive },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 grid h-[4.5rem] grid-cols-5 border-t bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 text-[11px] font-semibold text-slate-500 shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur dark:bg-card/95 dark:text-slate-400 lg:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.active ?? isActive(pathname, item.href);

        return (
          <Link
            key={item.label}
            className={`grid place-items-center gap-1 rounded-md transition-colors ${
              active ? 'text-emerald-600 dark:text-emerald-300' : ''
            }`}
            href={item.href}
            onClick={item.onClick}
          >
            {item.primary ? (
              <span className="grid size-10 place-items-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/25">
                <Icon className="size-5" />
              </span>
            ) : (
              <Icon className="size-5" />
            )}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
