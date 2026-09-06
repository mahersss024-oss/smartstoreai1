import { NextResponse } from 'next/server';

import {
  clearOauthStateCookie,
  commissionAgreementVersion,
  createSessionCookie,
  getCommissionAgreement,
  getOauthState,
  type AuthSessionUser,
} from '@/lib/auth/session';
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

function getBaseUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || new URL(request.url).origin;
}

function redirectToHome(request: Request, cookie?: string) {
  const response = NextResponse.redirect(new URL('/', getBaseUrl(request)));

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
    return;
  }

  const commissionAgreement = getCommissionAgreement(request);

  await prisma.user.upsert({
    where: { id: user.id },
    create: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      commissionAgreementVersion: commissionAgreement
        ? commissionAgreementVersion
        : undefined,
      commissionAgreementAccepted: commissionAgreement
        ? new Date(commissionAgreement.acceptedAt * 1000)
        : undefined,
    },
    update: {
      email: user.email,
      name: user.name,
      picture: user.picture,
      commissionAgreementVersion: commissionAgreement
        ? commissionAgreementVersion
        : undefined,
      commissionAgreementAccepted: commissionAgreement
        ? new Date(commissionAgreement.acceptedAt * 1000)
        : undefined,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = getOauthState(request);
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!code || !state || !storedState || state !== storedState) {
    return new Response('Invalid Google sign-in state.', { status: 400 });
  }

  if (!clientId || !clientSecret) {
    return new Response('Google OAuth is not configured.', { status: 500 });
  }

  const redirectUri = new URL('/api/auth/google/callback', getBaseUrl(request));
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
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
  const tokenJson = (await tokenResponse.json()) as GoogleTokenResponse;

  if (!tokenResponse.ok || !tokenJson.access_token) {
    return new Response('Google token exchange failed.', { status: 502 });
  }

  const userInfoResponse = await fetch(
    'https://www.googleapis.com/oauth2/v3/userinfo',
    {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    },
  );
  const userInfo = (await userInfoResponse.json()) as GoogleUserInfo;

  if (
    !userInfoResponse.ok ||
    !userInfo.sub ||
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

  try {
    await persistGoogleUserRegistration(request, user);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[google_auth] registration_failed=${errorName}`);

    return new Response('Google registration could not be completed.', {
      status: 502,
    });
  }

  return redirectToHome(request, createSessionCookie(user));
}
