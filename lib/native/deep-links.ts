import { appUrl } from '@/lib/app-url';

// Maps between public HTTP URLs and the SmartStore AI custom scheme used by
// native shells (smartstore://). Also exposes a helper to detect in-app
// browser limitations so we can route to the native app or the system browser.

export const appCustomScheme = 'smartstore';

const productionHost = 'www.smartstore-ai.com';

function getTrustedHosts() {
  const hosts = new Set<string>([productionHost]);
  try {
    hosts.add(new URL(appUrl).host);
  } catch {
    // Ignore malformed configured URL.
  }

  return hosts;
}

const knownDeepLinkPaths = new Set([
  '/',
  '/account',
  '/favorites',
  '/conversations',
  '/commissions',
  '/commission-agreement',
  '/terms',
  '/privacy',
  '/listing-policy',
  '/commission-policy',
]);

export function isSafeInternalPath(pathname: string): boolean {
  if (!pathname.startsWith('/')) {
    return false;
  }

  // Reject protocol-relative and backslash tricks.
  if (pathname.startsWith('//') || pathname.includes('\\')) {
    return false;
  }

  const [base] = pathname.split('?');

  if (base === undefined) {
    return false;
  }

  if (knownDeepLinkPaths.has(base)) {
    return true;
  }

  // Dynamic routes: /listings/:id and /conversations/:id.
  return /^\/(listings|conversations)\/[A-Za-z0-9_-]+$/.test(base);
}
export function toAppDeepLink(internalUrl: string): string | null {
  let path = internalUrl;

  try {
    if (/^https?:\/\//i.test(internalUrl)) {
      const url = new URL(internalUrl);

      // Only map URLs that belong to our own app origin.
      if (!getTrustedHosts().has(url.host)) {
    return null;
  }

      path = `${url.pathname}${url.search}`;
  }
  } catch {
    return null;
  }

  const [pathname, search] = path.split('?');

  if (!pathname || !isSafeInternalPath(pathname)) {
    return null;
}

  const query = search ? `?${search}` : '';

  return `${appCustomScheme}://${pathname.replace(/^\//, '')}${query}`;
}

export function toAbsoluteAppUrl(internalUrl: string): string {
  try {
    return new URL(internalUrl, appUrl).toString();
  } catch {
    return appUrl;
  }
}

const inAppBrowserPatterns = [
  /FBAN|FBAV/i, // Facebook
  /Instagram/i,
  /Twitter/i,
  /Line\//i,
  /MicroMessenger/i, // WeChat
];

export function isLikelyInAppBrowser(userAgent: string): boolean {
  return inAppBrowserPatterns.some((pattern) => pattern.test(userAgent));
}


