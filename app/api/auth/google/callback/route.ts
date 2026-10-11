import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { normalizeAuthEmail } from '@/lib/auth/identity';
import {
  clearOauthStateCookie,
  createSessionCookie,
  getOauthState,
  isOauthStateValid,
  type AuthSessionUser,
} from '@/lib/auth/session';
import { persistGoogleUserRegistration } from '@/lib/auth/google';
import {
  createMobileAuthBridgeUrl,
  createMobileAuthErrorCallbackUrl,
  createMobileAuthTicket,
  parseMobileAuthState,
} from '@/lib/auth/mobile-oauth';
import { getAppBaseUrl } from '@/lib/app-url';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

const recentGoogleAuthCodeMaxAgeMs = 5 * 60 * 1000;
const recentGoogleAuthCodeSessions = new Map<
  string,
  { expiresAt: number; sessionCookie: string }
>();

function getGoogleAuthCodeFingerprint(code: string) {
  return createHash('sha256').update(code).digest('base64url');
}

function pruneRecentGoogleAuthCodes() {
  const now = Date.now();

  for (const [fingerprint, cached] of recentGoogleAuthCodeSessions) {
    if (cached.expiresAt <= now) {
      recentGoogleAuthCodeSessions.delete(fingerprint);
    }
  }
}

function rememberGoogleAuthCodeSession(code: string, sessionCookie: string) {
  pruneRecentGoogleAuthCodes();
  recentGoogleAuthCodeSessions.set(getGoogleAuthCodeFingerprint(code), {
    expiresAt: Date.now() + recentGoogleAuthCodeMaxAgeMs,
    sessionCookie,
  });
}

function getRememberedGoogleAuthCodeSession(code: string) {
  pruneRecentGoogleAuthCodes();

  const cached = recentGoogleAuthCodeSessions.get(
    getGoogleAuthCodeFingerprint(code),
  );

  if (!cached) {
    return null;
  }

  return cached.sessionCookie;
}

function redirectToHome(request: Request, cookie?: string) {
  const response = NextResponse.redirect(new URL('/', getAppBaseUrl(request)));

  if (cookie) {
    response.headers.append('Set-Cookie', cookie);
  }

  response.headers.append('Set-Cookie', clearOauthStateCookie());
  return response;
}

function redirectToMobileAuthError(error: string) {
  const response = NextResponse.redirect(createMobileAuthErrorCallbackUrl(error));
  response.headers.append('Set-Cookie', clearOauthStateCookie());

  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const mobileState = parseMobileAuthState(state);
  const isMobileStateAttempt = state?.startsWith('mobile:') ?? false;
  const storedState = getOauthState(request);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!code || !state || (!mobileState && !isOauthStateValid(state, storedState))) {
    if (isMobileStateAttempt) {
      return redirectToMobileAuthError('google_invalid_state');
    }

    console.warn('[google_auth] invalid_state');
    return redirectToHome(request);
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_google_callback',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!clientId || !clientSecret) {
    console.warn('[google_auth] callback_unavailable=missing_config');
    return new Response('Google sign-in is temporarily unavailable.', {
      status: 503,
    });
  }

  const redirectUri = new URL('/api/auth/google/callback', getAppBaseUrl(request));
  let tokenResponse: Response;

  try {
    tokenResponse = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri.toString(),
        grant_type: 'authorization_code',
      }),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[google_auth] token_exchange_request_failed=${errorName}`);

    if (mobileState) {
      return redirectToMobileAuthError('google_token_exchange_failed');
    }

    return redirectToHome(request);
  }

  const tokenJson = (await tokenResponse.json().catch(() => null)) as
    | GoogleTokenResponse
    | null;

  if (!tokenResponse.ok || !tokenJson?.access_token) {
    const providerError =
      typeof tokenJson?.error === 'string' ? tokenJson.error : 'unknown';
    const providerDescription =
      typeof tokenJson?.error_description === 'string'
        ? tokenJson.error_description.replace(/[\r\n]+/g, ' ').slice(0, 180)
        : 'none';

    console.warn(
      `[google_auth] token_exchange_failed status=${tokenResponse.status} error=${providerError} description=${providerDescription}`,
    );

    if (providerError === 'invalid_grant') {
      const rememberedSessionCookie = getRememberedGoogleAuthCodeSession(code);

      if (rememberedSessionCookie && !mobileState) {
        console.warn('[google_auth] duplicate_callback_recovered=true');
        return redirectToHome(request, rememberedSessionCookie);
      }
    }

    if (mobileState) {
      return redirectToMobileAuthError(
        providerError === 'invalid_grant'
          ? 'google_sign_in_expired'
          : 'google_token_exchange_failed',
      );
    }

    return redirectToHome(request);
  }

  let userInfoResponse: Response;

  try {
    userInfoResponse = await fetchWithTimeout(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      },
    );
  } catch {
    if (mobileState) {
      return redirectToMobileAuthError('google_profile_failed');
    }

    return new Response('Google account email could not be verified.', {
      status: 502,
    });
  }

  const userInfo = (await userInfoResponse.json().catch(() => null)) as
    | GoogleUserInfo
    | null;

  if (
    !userInfoResponse.ok ||
    !userInfo?.sub ||
    !userInfo.email ||
    userInfo.email_verified === false
  ) {
    if (mobileState) {
      return redirectToMobileAuthError('google_profile_failed');
    }

    return new Response('Google account email could not be verified.', {
      status: 502,
    });
  }

  const user: AuthSessionUser = {
    id: `google:${userInfo.sub}`,
    email: normalizeAuthEmail(userInfo.email),
    name: userInfo.name,
    picture: userInfo.picture,
  };
  let registeredUser = user;

    try {
    registeredUser = await persistGoogleUserRegistration(request, user);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'UnknownError';

    if (errorMessage === 'ACCOUNT_SOFT_DELETED') {
      if (mobileState) {
        return redirectToMobileAuthError('account_deactivated');
      }

      return new Response('This account has been deactivated.', {
        status: 403,
      });
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[google_auth] registration_failed=${errorName}`);

    if (mobileState) {
      return redirectToMobileAuthError('google_registration_failed');
    }

    return new Response('Google registration could not be completed.', {
      status: 502,
    });
  }

  if (mobileState) {
    const response = NextResponse.redirect(
      createMobileAuthBridgeUrl(
        createMobileAuthTicket(registeredUser),
        getAppBaseUrl(request),
      ),
    );

    response.headers.append('Set-Cookie', clearOauthStateCookie());
    return response;
  }

  const sessionCookie = createSessionCookie(registeredUser);
  rememberGoogleAuthCodeSession(code, sessionCookie);

  return redirectToHome(request, sessionCookie);
}
