import { NextResponse } from 'next/server';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getAppBaseUrl } from '@/lib/app-url';
import { createMobileAuthTicket } from '@/lib/auth/mobile-oauth';
import { getAuthSession } from '@/lib/auth/session';
import { getMobileAppStoreUrl } from '@/lib/mobile/app-store-links';

const androidPackageName = 'com.souqhamad.app';

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }

  try {
    const url = new URL(value, 'https://souqhamad.com');

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function createMobileAuthUrl(ticket: string, nextPath: string) {
  const callbackUrl = new URL('smartstore://auth');
  callbackUrl.searchParams.set('ticket', ticket);
  callbackUrl.searchParams.set('next', nextPath);

  return callbackUrl.toString();
}

function createAndroidAuthIntent(ticket: string, nextPath: string, fallbackUrl: string) {
  const params = new URLSearchParams({ ticket, next: nextPath });

  return (
    `intent://auth?${params.toString()}` +
    `#Intent;scheme=smartstore;package=${androidPackageName};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`
  );
}

function createAndroidWebIntent(webUrl: string, fallbackUrl: string) {
  const url = new URL(webUrl);

  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    `#Intent;scheme=https;package=${androidPackageName};` +
    `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`
  );
}

export async function GET(request: Request) {
  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_mobile_open',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') === 'ios' ? 'ios' : 'android';
  const nextPath = normalizeNextPath(url.searchParams.get('next'));
  const webUrl = new URL(nextPath, getAppBaseUrl(request)).toString();
  const session = getAuthSession(request);
  const ticket = session ? createMobileAuthTicket(session.user) : null;
  const storeUrl = getMobileAppStoreUrl(platform);
  const fallbackUrl = storeUrl ?? webUrl;
  const launchUrl =
    platform === 'android'
      ? ticket
        ? createAndroidAuthIntent(ticket, nextPath, fallbackUrl)
        : createAndroidWebIntent(webUrl, fallbackUrl)
      : ticket
        ? createMobileAuthUrl(ticket, nextPath)
        : webUrl;

  return NextResponse.json(
    {
      platform,
      launchUrl,
      storeUrl,
      webUrl,
      hasSession: Boolean(session),
    },
    { headers: noStoreHeaders },
  );
}
