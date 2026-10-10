import { NextResponse } from 'next/server';

import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { noStoreHeaders } from '@/lib/api/no-store';
import { getAppBaseUrl } from '@/lib/app-url';
import { createMobileAuthTicket } from '@/lib/auth/mobile-oauth';
import { getAuthSession } from '@/lib/auth/session';

const androidPackageName = 'com.souqhamad.app';
const androidStoreUrl = `https://play.google.com/store/apps/details?id=${androidPackageName}`;

function getIosStoreUrl() {
  const url = process.env.NEXT_PUBLIC_IOS_APP_STORE_URL?.trim();

  return url && /^https:\/\/apps\.apple\.com\//i.test(url) ? url : null;
}

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

function createAndroidAuthIntent(ticket: string, nextPath: string) {
  const params = new URLSearchParams({ ticket, next: nextPath });

  return (
    `intent://auth?${params.toString()}` +
    `#Intent;scheme=smartstore;package=${androidPackageName};` +
    `S.browser_fallback_url=${encodeURIComponent(androidStoreUrl)};end`
  );
}

function createAndroidWebIntent(webUrl: string) {
  const url = new URL(webUrl);

  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    `#Intent;scheme=https;package=${androidPackageName};` +
    `S.browser_fallback_url=${encodeURIComponent(androidStoreUrl)};end`
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
  const launchUrl =
    platform === 'android'
      ? ticket
        ? createAndroidAuthIntent(ticket, nextPath)
        : createAndroidWebIntent(webUrl)
      : ticket
        ? createMobileAuthUrl(ticket, nextPath)
        : webUrl;

  return NextResponse.json(
    {
      platform,
      launchUrl,
      storeUrl: platform === 'android' ? androidStoreUrl : getIosStoreUrl(),
      webUrl,
      hasSession: Boolean(session),
    },
    { headers: noStoreHeaders },
  );
}
