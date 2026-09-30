import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import {
  clearOauthStateCookie,
  commissionPolicyVersion,
  commissionAgreementVersion,
  createSessionCookie,
  getConfiguredRoleForEmail,
  getCommissionAgreement,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
  getOauthState,
  type AuthSessionUser,
} from '@/lib/auth/session';
import {
  createMobileAuthCallbackUrl,
  createMobileAuthTicket,
  parseMobileAuthState,
} from '@/lib/auth/mobile-oauth';
import { getAppBaseUrl } from '@/lib/app-url';
import { prisma } from '@/lib/db/prisma';

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

function redirectToHome(request: Request, cookie?: string) {
  const response = NextResponse.redirect(new URL('/', getAppBaseUrl(request)));

  if (cookie) {
    response.headers.append('Set-Cookie', cookie);
  }

  response.headers.append('Set-Cookie', clearOauthStateCookie());
  return response;
}

function shouldPersistUserRegistration() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

async function persistGoogleUserRegistration(
  request: Request,
  user: AuthSessionUser,
) {
  if (!shouldPersistUserRegistration()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_USER_REGISTRATION_REQUIRED');
    }

    return user;
  }

  const commissionAgreement = getCommissionAgreement(request);
  const registrationData = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    commissionAgreementVersion: commissionAgreement
      ? commissionAgreementVersion
      : undefined,
    commissionAgreementAccepted: commissionAgreement
      ? new Date(commissionAgreement.acceptedAt * 1000)
      : undefined,
    platformAgreementVersion: commissionAgreement
      ? platformAgreementVersion
      : undefined,
    platformAgreementAccepted: commissionAgreement
      ? new Date(commissionAgreement.acceptedAt * 1000)
      : undefined,
    termsVersion: commissionAgreement ? termsVersion : undefined,
    privacyPolicyVersion: commissionAgreement ? privacyPolicyVersion : undefined,
    listingPolicyVersion: commissionAgreement ? listingPolicyVersion : undefined,
    commissionPolicyVersion: commissionAgreement
      ? commissionPolicyVersion
      : undefined,
  };

    const existingUserByEmail = await prisma.user.findUnique({
    where: { email: user.email },
  });

  if (existingUserByEmail?.deletedAt) {
    throw new Error('ACCOUNT_SOFT_DELETED');
  }

  if (existingUserByEmail && existingUserByEmail.id !== user.id) {
    const updatedUser = await prisma.user.update({
      where: { email: user.email },
      data: {
        ...registrationData,
        name: existingUserByEmail.name ?? user.name,
        picture: existingUserByEmail.picture ?? user.picture,
      },
    });

    return {
      id: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name ?? undefined,
      picture: updatedUser.picture ?? undefined,
      role: updatedUser.role,
    };
  }

  const updatedUser = await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      role: getConfiguredRoleForEmail(user.email),
      ...registrationData,
    },
    update: {
      ...registrationData,
      name: existingUserByEmail?.name ?? user.name,
      picture: existingUserByEmail?.picture ?? user.picture,
    },
  });

  return {
    id: updatedUser.id,
    email: updatedUser.email,
    name: updatedUser.name ?? undefined,
    picture: updatedUser.picture ?? undefined,
    role: updatedUser.role,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const mobileState = parseMobileAuthState(state);
  const storedState = getOauthState(request);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!code || !state || (!mobileState && (!storedState || state !== storedState))) {
    return new Response('Invalid Google sign-in state.', { status: 400 });
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
  } catch {
    return new Response('Google token exchange failed.', { status: 502 });
  }

  const tokenJson = (await tokenResponse.json().catch(() => null)) as
    | GoogleTokenResponse
    | null;

  if (!tokenResponse.ok || !tokenJson?.access_token) {
    return new Response('Google token exchange failed.', { status: 502 });
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
    return new Response('Google account email could not be verified.', {
      status: 502,
    });
  }

  const user: AuthSessionUser = {
    id: `google:${userInfo.sub}`,
    email: userInfo.email,
    name: userInfo.name,
    picture: userInfo.picture,
  };
  let registeredUser = user;

    try {
    registeredUser = await persistGoogleUserRegistration(request, user);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'UnknownError';

    if (errorMessage === 'ACCOUNT_SOFT_DELETED') {
      return new Response('This account has been deactivated.', {
        status: 403,
      });
    }

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[google_auth] registration_failed=${errorName}`);

    return new Response('Google registration could not be completed.', {
      status: 502,
    });
  }

  if (mobileState) {
    const response = NextResponse.redirect(
      createMobileAuthCallbackUrl(createMobileAuthTicket(registeredUser)),
    );

    response.headers.append('Set-Cookie', clearOauthStateCookie());
    return response;
  }

  return redirectToHome(request, createSessionCookie(registeredUser));
}
