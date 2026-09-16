import { NextResponse } from 'next/server';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { getAppBaseUrl } from '@/lib/app-url';
import {
  createAppleClientSecret,
  getAppleClientId,
  isAppleAuthConfigured,
  verifyAppleIdentityToken,
} from '@/lib/auth/apple';
import {
  clearOauthStateCookie,
  commissionPolicyVersion,
  commissionAgreementVersion,
  createSessionCookie,
  getCommissionAgreement,
  getConfiguredRoleForEmail,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
  getOauthState,
  type AuthSessionUser,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type AppleTokenResponse = {
  id_token?: string;
  error?: string;
};

type AppleUserPayload = {
  name?: {
    firstName?: string;
    lastName?: string;
  };
  email?: string;
};

const maxAppleCallbackRequestBytes = 16 * 1024;

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

function parseAppleUserName(value: string | null) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as AppleUserPayload;
    const name = [parsed.name?.firstName, parsed.name?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    return name || undefined;
  } catch {
    return undefined;
  }
}

async function readCallbackParams(request: Request) {
  if (request.method === 'POST') {
    const form = await request.formData();

    return {
      code: String(form.get('code') ?? ''),
      state: String(form.get('state') ?? ''),
      idToken: String(form.get('id_token') ?? ''),
      name: parseAppleUserName(String(form.get('user') ?? '') || null),
    };
  }

  const url = new URL(request.url);

  return {
    code: url.searchParams.get('code') ?? '',
    state: url.searchParams.get('state') ?? '',
    idToken: url.searchParams.get('id_token') ?? '',
    name: parseAppleUserName(url.searchParams.get('user')),
  };
}

async function persistAppleUserRegistration(
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

  if (existingUserByEmail && existingUserByEmail.id !== user.id) {
    const updatedUser = await prisma.user.update({
      where: { email: user.email },
      data: registrationData,
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
    update: registrationData,
  });

  return {
    id: updatedUser.id,
    email: updatedUser.email,
    name: updatedUser.name ?? undefined,
    picture: updatedUser.picture ?? undefined,
    role: updatedUser.role,
  };
}

async function handleAppleCallback(request: Request) {
  const oversizedRequest = rejectOversizedRequest(
    request,
    maxAppleCallbackRequestBytes,
    'Apple sign-in callback request body is too large.',
  );

  if (oversizedRequest) {
    return oversizedRequest;
  }

  let callbackParams: Awaited<ReturnType<typeof readCallbackParams>>;

  try {
    callbackParams = await readCallbackParams(request);
  } catch {
    return new Response('Invalid Apple sign-in callback.', { status: 400 });
  }

  const { code, idToken, name, state } = callbackParams;
  const storedState = getOauthState(request);

  if (!code || !idToken || !state || !storedState || state !== storedState) {
    return new Response('Invalid Apple sign-in state.', { status: 400 });
  }

  const rateLimitResponse = await enforceApiRateLimit(request, {
    namespace: 'auth_apple_callback',
    maxRequests: 60,
    windowMs: 60_000,
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (!isAppleAuthConfigured()) {
    console.warn('[apple_auth] callback_unavailable=missing_config');
    return new Response('Apple sign-in is temporarily unavailable.', {
      status: 503,
    });
  }

  const clientId = getAppleClientId();
  const redirectUri = new URL(
    '/api/auth/apple/callback',
    getAppBaseUrl(request),
  );
  let tokenResponse: Response;

  try {
    tokenResponse = await fetchWithTimeout('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: createAppleClientSecret(),
        redirect_uri: redirectUri.toString(),
        grant_type: 'authorization_code',
      }),
    });
  } catch {
    return new Response('Apple token exchange failed.', { status: 502 });
  }

  const tokenJson = (await tokenResponse.json().catch(() => null)) as
    | AppleTokenResponse
    | null;

  if (!tokenResponse.ok || tokenJson?.error) {
    return new Response('Apple token exchange failed.', { status: 502 });
  }

  const identity = await verifyAppleIdentityToken(
    tokenJson?.id_token ?? idToken,
    clientId,
  );

  if (!identity) {
    return new Response('Apple account email could not be verified.', {
      status: 502,
    });
  }

  const user: AuthSessionUser = {
    id: `apple:${identity.sub}`,
    email: identity.email,
    name,
  };
  let registeredUser = user;

  try {
    registeredUser = await persistAppleUserRegistration(request, user);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.error(`[apple_auth] registration_failed=${errorName}`);

    return new Response('Apple registration could not be completed.', {
      status: 502,
    });
  }

  return redirectToHome(request, createSessionCookie(registeredUser));
}

export async function GET(request: Request) {
  return handleAppleCallback(request);
}

export async function POST(request: Request) {
  return handleAppleCallback(request);
}
