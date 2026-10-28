import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type AuthSessionUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  phoneNumber?: string;
  role?: 'user' | 'moderator' | 'admin' | string;
};

export type AuthSession = {
  user: AuthSessionUser;
  issuedAt: number;
  expiresAt: number;
};

const sessionCookieName = 'smartstore_session';
const oauthStateCookieName = 'smartstore_oauth_state';
const commissionAgreementCookieName = 'smartstore_commission_agreement';
const oauthStateMaxAgeSeconds = 60 * 10;
export const platformAgreementVersion = 'platform-agreement-2026-09-16-v1';
export const termsVersion = 'terms-2026-09-16-v1';
export const privacyPolicyVersion = 'privacy-2026-09-16-v1';
export const listingPolicyVersion = 'listing-policy-2026-09-16-v1';
export const commissionPolicyVersion = 'commission-policy-2026-09-16-v1';
export const commissionAgreementVersion = platformAgreementVersion;
export const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;
export const authenticatedUserActiveWindowMs = sessionMaxAgeSeconds * 1000;
const commissionAgreementMaxAgeSeconds = 60 * 60 * 24 * 365;

export type CommissionAgreement = {
  version: typeof commissionAgreementVersion;
  platformAgreementVersion: typeof platformAgreementVersion;
  termsVersion: typeof termsVersion;
  privacyPolicyVersion: typeof privacyPolicyVersion;
  listingPolicyVersion: typeof listingPolicyVersion;
  commissionPolicyVersion: typeof commissionPolicyVersion;
  commissionRatePercent: 1;
  acceptedAt: number;
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

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
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

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
  } = {},
) {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path ?? '/'}`,
    `SameSite=${options.sameSite ?? 'Lax'}`,
  ];

  if (options.httpOnly ?? true) {
    parts.push('HttpOnly');
  }

  if (options.secure ?? process.env.NODE_ENV === 'production') {
    parts.push('Secure');
  }

  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join('; ');
}

export function createSignedSession(user: AuthSessionUser) {
  const now = Math.floor(Date.now() / 1000);
  const session: AuthSession = {
    user,
    issuedAt: now,
    expiresAt: now + sessionMaxAgeSeconds,
  };
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function parseSignedSession(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split('.');

  if (!payload || !signature || !safeEqual(signPayload(payload), signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as AuthSession;

    if (
      !parsed.user?.id ||
      !parsed.user.email ||
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

export function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const match = cookies.find((cookie) => cookie.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

export function getAuthSession(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const bearerPrefix = 'Bearer ';
  const bearerToken = authorization.startsWith(bearerPrefix)
    ? authorization.slice(bearerPrefix.length).trim()
    : '';

  return parseSignedSession(
    getCookieValue(request, sessionCookieName) ?? bearerToken,
  );
}

export function createSessionCookie(user: AuthSessionUser) {
  return serializeCookie(
    sessionCookieName,
    encodeURIComponent(createSignedSession(user)),
    { maxAge: sessionMaxAgeSeconds },
  );
}

export function clearSessionCookie() {
  return serializeCookie(sessionCookieName, '', { maxAge: 0 });
}

export function createCommissionAgreementToken() {
  const agreement: CommissionAgreement = {
    version: commissionAgreementVersion,
    platformAgreementVersion,
    termsVersion,
    privacyPolicyVersion,
    listingPolicyVersion,
    commissionPolicyVersion,
    commissionRatePercent: 1,
    acceptedAt: Math.floor(Date.now() / 1000),
  };
  const payload = base64UrlEncode(JSON.stringify(agreement));
  const signature = signPayload(payload);

  return `${payload}.${signature}`;
}

export function createCommissionAgreementCookie() {
  return serializeCookie(
    commissionAgreementCookieName,
    encodeURIComponent(createCommissionAgreementToken()),
    { maxAge: commissionAgreementMaxAgeSeconds },
  );
}

export function parseCommissionAgreement(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split('.');

  if (!payload || !signature || !safeEqual(signPayload(payload), signature)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<CommissionAgreement>;

    if (
      parsed.version !== commissionAgreementVersion ||
      parsed.platformAgreementVersion !== platformAgreementVersion ||
      parsed.termsVersion !== termsVersion ||
      parsed.privacyPolicyVersion !== privacyPolicyVersion ||
      parsed.listingPolicyVersion !== listingPolicyVersion ||
      parsed.commissionPolicyVersion !== commissionPolicyVersion ||
      parsed.commissionRatePercent !== 1 ||
      typeof parsed.acceptedAt !== 'number'
    ) {
      return null;
    }

    return parsed as CommissionAgreement;
  } catch {
    return null;
  }
}

export function getCommissionAgreement(request: Request) {
  const headerAgreement = request.headers.get('x-souq-hamad-commission-agreement');

  return parseCommissionAgreement(
    getCookieValue(request, commissionAgreementCookieName) ?? headerAgreement,
  );
}

export function hasCommissionAgreement(request: Request) {
  return Boolean(getCommissionAgreement(request));
}

function getConfiguredAdminEmails() {
  return (process.env.SMARTSTORE_ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isConfiguredAdminEmail(email: string) {
  return getConfiguredAdminEmails().includes(email.toLowerCase());
}

export function getConfiguredRoleForEmail(email: string) {
  return isConfiguredAdminEmail(email) ? 'admin' : 'user';
}

export function isAdminSession(session: AuthSession | null) {
  if (!session) {
    return false;
  }

  return (
    session.user.role === 'admin' ||
    isConfiguredAdminEmail(session.user.email)
  );
}

export function isModeratorSession(session: AuthSession | null) {
  if (!session) {
    return false;
  }

  return (
    session.user.role === 'moderator' ||
    session.user.role === 'admin' ||
    isAdminSession(session)
  );
}

export function createOauthState() {
  const now = Math.floor(Date.now() / 1000);
  const state = {
    nonce: randomBytes(24).toString('base64url'),
    issuedAt: now,
    expiresAt: now + oauthStateMaxAgeSeconds,
  };
  const payload = base64UrlEncode(JSON.stringify(state));
  const signature = signPayload(`oauth-state:${payload}`);

  return `state:${payload}.${signature}`;
}

export function parseOauthState(value: string | null | undefined) {
  if (!value?.startsWith('state:')) {
    return null;
  }

  const [payload, signature] = value.slice('state:'.length).split('.');

  if (
    !payload ||
    !signature ||
    !safeEqual(signPayload(`oauth-state:${payload}`), signature)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as Partial<{
      nonce: string;
      expiresAt: number;
    }>;

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

export function isOauthStateValid(
  state: string | null | undefined,
  storedState: string | undefined,
) {
  // The signature proves the state came from this server, not that the browser
  // presenting it initiated this login. Require both halves of the browser flow.
  return Boolean(state && storedState && safeEqual(state, storedState) && parseOauthState(state));
}

export function createOauthStateCookie(
  state: string,
  options: {
    sameSite?: 'Lax' | 'Strict' | 'None';
    secure?: boolean;
  } = {},
) {
  return serializeCookie(oauthStateCookieName, encodeURIComponent(state), {
    maxAge: oauthStateMaxAgeSeconds,
    sameSite: options.sameSite,
    secure: options.secure,
  });
}

export function clearOauthStateCookie() {
  return serializeCookie(oauthStateCookieName, '', { maxAge: 0 });
}

export function getOauthState(request: Request) {
  return getCookieValue(request, oauthStateCookieName);
}
