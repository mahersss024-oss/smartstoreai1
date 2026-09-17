import type { AuthSession } from '@/lib/auth/session';
import {
  isAdminSession,
  isConfiguredAdminEmail,
  isModeratorSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

/**
 * Verified platform roles, ordered from the highest to the lowest.
 *
 * - `owner`: the platform owner, identified by the server-side
 *   `SMARTSTORE_ADMIN_EMAILS` environment variable. Grants every capability.
 * - `admin`: an appointed administrator. Manages content and (soft) deletes
 *   user accounts, but cannot touch maintenance, commissions or roles.
 * - `moderator`: an appointed moderator. Content review only.
 * - `user`: a regular account.
 */
export type VerifiedRole = 'owner' | 'admin' | 'moderator' | 'user';

export function shouldVerifyRoleFromDatabase() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

/**
 * The platform owner is identified solely by the configured admin email
 * list. This check is synchronous and never depends on the database, so it
 * stays authoritative even if a database row is altered.
 */
export function isPlatformOwner(session: AuthSession | null) {
  if (!session) {
    return false;
  }

  return isConfiguredAdminEmail(session.user.email);
}

function normalizeStoredRole(role: string | undefined | null): VerifiedRole {
  return role === 'admin' || role === 'moderator' ? role : 'user';
}

export async function getVerifiedRoleForSession(
  session: AuthSession | null,
): Promise<VerifiedRole | null> {
  if (!session) {
    return null;
  }

  if (isPlatformOwner(session)) {
    return 'owner';
  }

  if (!shouldVerifyRoleFromDatabase()) {
    return normalizeStoredRole(session.user.role);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.warn('[authorization] role_lookup_failed=missing_database_url');
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
      return null;
    }

    return normalizeStoredRole(user.role);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[authorization] role_lookup_failed=${errorName}`);
    return null;
  }
}

/** The platform owner only. */
export async function hasPlatformOwnerAccess(session: AuthSession | null) {
  if (isPlatformOwner(session)) {
    return true;
  }

  return (await getVerifiedRoleForSession(session)) === 'owner';
}

/** Owner or appointed admin. */
export async function hasVerifiedAdminAccess(session: AuthSession | null) {
  if (isPlatformOwner(session)) {
    return true;
  }

  if (!shouldVerifyRoleFromDatabase()) {
    return isAdminSession(session);
  }

  const role = await getVerifiedRoleForSession(session);

  return role === 'owner' || role === 'admin';
}

/** Owner, appointed admin or appointed moderator. */
export async function hasVerifiedModeratorAccess(session: AuthSession | null) {
  if (isPlatformOwner(session)) {
    return true;
  }

  if (!shouldVerifyRoleFromDatabase()) {
    return isModeratorSession(session);
  }

  const role = await getVerifiedRoleForSession(session);

  return role === 'owner' || role === 'admin' || role === 'moderator';
}
