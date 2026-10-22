'use client';

import { useMobileRouter } from './router';

export function usePathname() {
  return useMobileRouter().pathname;
}

export function useRouter() {
  const { push, replace, back, forward, refresh } = useMobileRouter();
  return { push, replace, back, forward, refresh, prefetch: async () => undefined };
}

export function useSearchParams() {
  const { search } = useMobileRouter();
  return new URLSearchParams(search);
}

export function useParams<T = Record<string, string | undefined>>(): T {
  const { pathname } = useMobileRouter();
  const segments = pathname.split('/').filter(Boolean).map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });

  if (segments[0] === 'listings' && segments[1]) return { listingId: segments[1] } as T;
  if (segments[0] === 'sellers' && segments[1]) return { sellerId: segments[1] } as T;
  if (segments[0] === 'conversations' && segments[1]) return { conversationId: segments[1] } as T;
  return {} as T;
}

export function redirect(href: string): never {
  if (typeof window !== 'undefined') window.location.assign(href);
  throw new Error(`Mobile navigation redirect: ${href}`);
}

export function notFound(): never {
  throw new Error('Not found');
}
