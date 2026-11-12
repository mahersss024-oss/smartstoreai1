import type { Prisma } from '@prisma/client';
import { isPlatformOwner, shouldVerifyRoleFromDatabase } from '@/lib/auth/authorization';
import { isAdminSession, isModeratorSession, isSessionVersionCurrent, type AuthSession } from '@/lib/auth/session';

export type StaffMutationGuard = (tx: Prisma.TransactionClient) => Promise<void>;
export class StaffAuthorizationChangedError extends Error {
  constructor() { super('staff_authorization_changed'); this.name = 'StaffAuthorizationChangedError'; }
}

/** Call inside the mutation transaction after its target locks, before writes.
 * The SHARE lock prevents role/status changes until commit. NOWAIT fails closed
 * instead of deadlocking staff members concurrently editing each other's rows.
 */
export async function assertStaffMutationAccess(
  tx: Prisma.TransactionClient, session: AuthSession,
  capability: 'admin' | 'moderator' | 'owner',
) {
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) throw new StaffAuthorizationChangedError();
  if (!shouldVerifyRoleFromDatabase()) {
    const allowed = capability === 'owner' ? isPlatformOwner(session)
      : capability === 'admin' ? isAdminSession(session) : isModeratorSession(session);
    if (!allowed) throw new StaffAuthorizationChangedError();
    return;
  }
  let account: { role: string; deletedAt: Date | null; sessionVersion: number } | undefined;
  try {
    [account] = await tx.$queryRaw<Array<{ role: string; deletedAt: Date | null; sessionVersion: number }>>`
      SELECT role, "deletedAt", "sessionVersion" FROM "User" WHERE id = ${session.user.id} FOR SHARE NOWAIT`;
  } catch (error) {
    const meta = error && typeof error === 'object' && 'meta' in error ? error.meta as { code?: string } : undefined;
    if (meta?.code === '55P03') throw new StaffAuthorizationChangedError();
    throw error;
  }
  const owner = isPlatformOwner(session);
  const allowed = owner || (capability !== 'owner' && account?.role === 'admin') ||
    (capability === 'moderator' && account?.role === 'moderator');
  if (!account || account.deletedAt || !isSessionVersionCurrent(session, account) || !allowed)
    throw new StaffAuthorizationChangedError();
}

export function withStaffMutationProtection<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T) => {
    try { return await handler(...args); }
    catch (error) {
      if (!(error instanceof StaffAuthorizationChangedError)) throw error;
      return Response.json({ error: 'admin_required' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
  };
}
