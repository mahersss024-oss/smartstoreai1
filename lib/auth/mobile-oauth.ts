import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import {
  createSignedSession,
  parseSignedSession,
  type AuthSessionUser,
} from '@/lib/auth/session';

const mobileUserAgentMarker = 'SouqHamadCapacitor';
const mobileCallbackScheme = 'smartstore';
const mobileCallbackHost = 'auth';
const mobileTicketMaxAgeSeconds = 60;
const mobileStateMaxAgeSeconds = 10 * 60;

type MobileAuthTicket = {
  session: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

type MobileAuthState = {
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function getAuthSecret() {
  const secret = process.env.AUTH_SECRET?.trim();

  if (secret) {
    return secret;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'development-only-smartstore-auth-secret';
  }

  throw new Error('AUTH_SECRET is required in production.');
}

function signPayload(payload: string) {
  return createHmac('sha256', getAuthSecret()).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function isMobileAppRequest(request: Request) {
  return request.headers
    .get('user-agent')
    ?.includes(mobileUserAgentMarker) ?? false;
}

export function createMobileAuthState() {
  const now = Math.floor(Date.now() / 1000);
  const state: MobileAuthState = {
    nonce: randomBytes(24).toString('base64url'),
    issuedAt: now,
    expiresAt: now + mobileStateMaxAgeSeconds,
  };
  const payload = base64UrlEncode(JSON.stringify(state));
  const signature = signPayload(`mobile-state:${payload}`);

  return `mobile:${payload}.${signature}`;
}

export function parseMobileAuthState(state: string | null | undefined) {
  if (!state?.startsWith('mobile:')) {
    return null;
  }

  const [payload, signature] = state.slice('mobile:'.length).split('.');

  if (
    !payload ||
    !signature ||
    !safeEqual(signPayload(`mobile-state:${payload}`), signature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<MobileAuthState>;

    if (
      !parsed.nonce ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** Browser-based native handoffs retain their own state format and browser binding. */
export function isMobileAuthStateValid(state: string | null | undefined, storedState: string | undefined) {
  return Boolean(state && storedState && safeEqual(state, storedState) && parseMobileAuthState(state));
}

export function createMobileAuthTicket(user: AuthSessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const ticket: MobileAuthTicket = {
    session: createSignedSession(user),
    nonce: randomBytes(16).toString('base64url'),
    issuedAt: now,
    expiresAt: now + mobileTicketMaxAgeSeconds,
  };
  const payload = base64UrlEncode(JSON.stringify(ticket));
  const signature = signPayload(`mobile-auth:${payload}`);

  return `${payload}.${signature}`;
}

export function parseMobileAuthTicket(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split('.');

  if (
    !payload ||
    !signature ||
    !safeEqual(signPayload(`mobile-auth:${payload}`), signature)
  ) {
    return null;
  }

  try {
    const ticket = JSON.parse(base64UrlDecode(payload)) as Partial<MobileAuthTicket>;

    if (
      !ticket.session ||
      !ticket.nonce ||
      typeof ticket.expiresAt !== 'number' ||
      ticket.expiresAt <= Math.floor(Date.now() / 1000) ||
      !parseSignedSession(ticket.session)
    ) {
      return null;
    }

    return ticket.session;
  } catch {
    return null;
  }
}

export function createMobileAuthCallbackUrl(ticket: string) {
  const callbackUrl = new URL(`${mobileCallbackScheme}://${mobileCallbackHost}`);
  callbackUrl.searchParams.set('ticket', ticket);

  return callbackUrl;
}

export function createMobileAuthBridgeUrl(ticket: string, baseUrl: string) {
  const callbackUrl = new URL('/api/auth/mobile/callback', baseUrl);
  callbackUrl.searchParams.set('ticket', ticket);

  return callbackUrl;
}

export function createMobileAuthErrorCallbackUrl(error: string) {
  const callbackUrl = new URL(`${mobileCallbackScheme}://${mobileCallbackHost}`);
  callbackUrl.searchParams.set('error', error);

  return callbackUrl;
}
