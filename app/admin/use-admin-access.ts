'use client';

import { useCallback } from 'react';
import { useAuthSession } from '@/hooks/use-auth-session';

type AdminAccessRole = 'owner' | 'admin' | 'moderator';

function hasRequiredRole(role: string | undefined, requiredRole: AdminAccessRole) {
  if (requiredRole === 'moderator') {
    return role === 'owner' || role === 'admin' || role === 'moderator';
  }

  if (requiredRole === 'admin') {
    return role === 'owner' || role === 'admin';
  }

  // requiredRole === 'owner'
  return role === 'owner';
}

export function useAdminAccess(requiredRole: AdminAccessRole = 'admin') {
  const { session, isSessionLoading, verifySession } = useAuthSession();
  const allowed = session.authenticated && hasRequiredRole(session.user?.role, requiredRole);
  const verifyAdminAccess = useCallback(async () => {
    const next = await verifySession();
    return next.authenticated && hasRequiredRole(next.user?.role, requiredRole);
  }, [verifySession, requiredRole]);

  return {
    adminAccessRole: allowed ? session.user?.role as AdminAccessRole : null,
    isAdminAccessAllowed: allowed && !isSessionLoading,
    isAdminAccessChecking: isSessionLoading,
    adminAccessNotice:
      !isSessionLoading && !allowed
          ? requiredRole === 'owner'
            ? 'هذه الصفحة مخصصة لمالك المنصة فقط.'
            : 'هذه الصفحة مخصصة للإدارة فقط.'
          : '',
    verifyAdminAccess,
  };
}
