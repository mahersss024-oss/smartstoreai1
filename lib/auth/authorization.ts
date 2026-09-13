import type { AuthSession } from '@/lib/auth/session';
import {
  isAdminSession,
  isConfiguredAdminEmail,
  isModeratorSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

type VerifiedRole = 'user' | 'moderator' | 'admin';

export function shouldVerifyRoleFromDatabase() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

function normalizeRole(role: string | undefined | null): VerifiedRole {
  return role === 'admin' || role === 'moderator' ? role : 'user';
}

export async function getVerifiedRoleForSession(
  session: AuthSession | null,
): Promise<VerifiedRole | null> {
  if (!session) {
    return null;
  }

  if (isConfiguredAdminEmail(session.user.email)) {
    return 'admin';
  }

  if (!shouldVerifyRoleFromDatabase()) {
    return normalizeRole(session.user.role);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    console.warn('[authorization] role_lookup_failed=missing_database_url');
    return null;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });

    return user ? normalizeRole(user.role) : null;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[authorization] role_lookup_failed=${errorName}`);
    return null;
  }
}

export async function hasVerifiedAdminAccess(session: AuthSession | null) {
  if (!shouldVerifyRoleFromDatabase()) {
    return isAdminSession(session);
  }

  return (await getVerifiedRoleForSession(session)) === 'admin';
}

export async function hasVerifiedModeratorAccess(session: AuthSession | null) {
  if (!shouldVerifyRoleFromDatabase()) {
    return isModeratorSession(session);
  }

  const role = await getVerifiedRoleForSession(session);

  return role === 'admin' || role === 'moderator';
}
