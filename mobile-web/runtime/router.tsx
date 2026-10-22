'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const serverOrigin = process.env.NEXT_PUBLIC_MOBILE_API_ORIGIN?.trim() || 'https://souqhamad.com';
const mobileRouteKey = '__souq_hamad_route';

const staticRoutes = new Set([
  '/',
  '/account',
  '/account/follows',
  '/account/listings',
  '/account/seller-profile',
  '/admin',
  '/admin/audit-log',
  '/admin/commissions',
  '/admin/listings',
  '/admin/maintenance',
  '/admin/moderation',
  '/admin/users',
  '/commission-agreement',
  '/commission-policy',
  '/commissions',
  '/conversations',
  '/delete-account',
  '/favorites',
  '/listing-policy',
  '/notifications',
  '/offline',
  '/privacy',
  '/terms',
]);

export type MobileRouteState = {
  pathname: string;
  search: string;
  hash: string;
};

type MobileRouter = MobileRouteState & {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
};

const MobileRouterContext = createContext<MobileRouter | null>(null);

function normalizePathname(pathname: string) {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlash || '/';
}

export function isMobileLocalRoute(pathname: string) {
  const normalized = normalizePathname(pathname);
  return staticRoutes.has(normalized) ||
    /^\/listings\/[^/]+$/.test(normalized) ||
    /^\/sellers\/[^/]+$/.test(normalized) ||
    /^\/conversations\/[^/]+$/.test(normalized);
}

export function readMobileRoute(href: string): MobileRouteState {
  const url = new URL(href);
  const routePath = url.searchParams.get(mobileRouteKey);
  url.searchParams.delete(mobileRouteKey);

  return {
    pathname: normalizePathname(routePath || url.pathname),
    search: url.searchParams.size ? `?${url.searchParams.toString()}` : '',
    hash: url.hash,
  };
}

function makeLocalShellUrl(route: MobileRouteState) {
  const localUrl = new URL('/', window.location.origin);
  if (route.pathname !== '/') localUrl.searchParams.set(mobileRouteKey, route.pathname);

  const routeSearch = new URLSearchParams(route.search);
  routeSearch.delete(mobileRouteKey);
  routeSearch.forEach((value, key) => localUrl.searchParams.append(key, value));
  localUrl.hash = route.hash;
  return localUrl.href;
}

function resolveRoute(href: string, current: MobileRouteState) {
  const target = new URL(href, window.location.href);
  const isQueryOnly = href.startsWith('?');
  const isHashOnly = href.startsWith('#');
  const routeParam = target.searchParams.get(mobileRouteKey);
  const pathname = normalizePathname(
    isQueryOnly || isHashOnly ? current.pathname : routeParam || target.pathname,
  );
  const params = isHashOnly ? new URLSearchParams(current.search) : target.searchParams;
  params.delete(mobileRouteKey);

  return {
    target,
    route: {
      pathname,
      search: params.size ? `?${params.toString()}` : '',
      hash: target.hash,
    } satisfies MobileRouteState,
  };
}

function navigateTo(
  href: string,
  replace: boolean,
  current: MobileRouteState,
  setRoute: (route: MobileRouteState) => void,
) {
  const { target, route } = resolveRoute(href, current);
  const localOrCanonicalOrigin = target.origin === window.location.origin ||
    target.origin === 'https://souqhamad.com' ||
    target.origin === 'https://www.souqhamad.com';

  if (!localOrCanonicalOrigin || !isMobileLocalRoute(route.pathname)) {
    if (!localOrCanonicalOrigin) {
      window.location.assign(target.href);
      return;
    }

    const remoteUrl = new URL(`${route.pathname}${route.search}${route.hash}`, serverOrigin);
    window.location.assign(remoteUrl.href);
    return;
  }

  const nextUrl = makeLocalShellUrl(route);
  if (replace) {
    window.history.replaceState({}, '', nextUrl);
  } else {
    window.history.pushState({}, '', nextUrl);
  }
  setRoute(route);
}

export function MobileRouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<MobileRouteState>({ pathname: '/', search: '', hash: '' });

  useEffect(() => {
    const syncRoute = () => setRoute(readMobileRoute(window.location.href));
    syncRoute();
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const push = useCallback((href: string) => navigateTo(href, false, route, setRoute), [route]);
  const replace = useCallback((href: string) => navigateTo(href, true, route, setRoute), [route]);
  const value = useMemo<MobileRouter>(() => ({
    ...route,
    push,
    replace,
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
  }), [route, push, replace]);

  return <MobileRouterContext.Provider value={value}>{children}</MobileRouterContext.Provider>;
}

export function useMobileRouter() {
  const value = useContext(MobileRouterContext);
  if (!value) throw new Error('Mobile router hooks must be used within MobileRouterProvider');
  return value;
}
