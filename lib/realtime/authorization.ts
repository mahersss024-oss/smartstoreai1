import { prisma } from '@/lib/db/prisma';
import { hasVerifiedAdminAccess, isPlatformOwner, shouldVerifyRoleFromDatabase } from '@/lib/auth/authorization';
import type { AuthSession } from '@/lib/auth/session';
import type { RealtimeSubscriberContext } from './events';

/** Re-read account state before sending private data over an existing stream. */
export async function resolveRealtimeSubscriberContext(
  session: AuthSession | null,
): Promise<RealtimeSubscriberContext | null> {
  if (!session) return { userId: null, isAdmin: false };
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) return null;

  if (!shouldVerifyRoleFromDatabase()) {
    return { userId: session.user.id, isAdmin: await hasVerifiedAdminAccess(session) };
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error('realtime_authorization_unavailable');

  try {
    // Even the configured owner needs an active account. Other roles come
    // from the current row, never the role captured in an old session token.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id }, select: { role: true, deletedAt: true },
    });
    if (!user || user.deletedAt || session.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return {
      userId: session.user.id,
      isAdmin: isPlatformOwner(session) || user.role === 'admin',
    };
  } catch {
    console.warn('[realtime] authorization_lookup_failed');
    throw new Error('realtime_authorization_unavailable');
  }
}
