'use client';

import { usePathname } from 'next/navigation';
import { startTransition, use, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthSession } from '@/hooks/use-auth-session';
import {
  cancelPageTransition,
  commitPageTransition,
  subscribePageTransitions,
  type PendingPageTransition,
} from '@/lib/navigation/page-transition';

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuthSession();
  const owner = session.user?.id ?? null;
  const previousOwner = useRef(owner);
  const [pending, setPending] = useState<PendingPageTransition | null>(null);

  useLayoutEffect(() => subscribePageTransitions(next => {
    startTransition(() => setPending(next));
  }), []);

  // Hold only the DOM commit until the browser has captured the previous page.
  // The router retains ownership of history, data loading and cached page state.
  if (pending && pathname !== pending.fromPathname) use(pending.captured);

  useLayoutEffect(() => { commitPageTransition(pathname); }, [pathname, pending]);
  useLayoutEffect(() => {
    if (previousOwner.current !== owner) cancelPageTransition();
    previousOwner.current = owner;
  }, [owner]);

  return <div className="page-transition-content">{children}</div>;
}
