'use client';

import { useCallback, useState } from 'react';

type AdminAccessRole = 'admin' | 'moderator';

type AuthSessionPayload = {
  authenticated: boolean;
  user: {
    role?: string;
  } | null;
};

type AdminAccessStatus = 'idle' | 'checking' | 'allowed' | 'forbidden' | 'error';

function hasRequiredRole(role: string | undefined, requiredRole: AdminAccessRole) {
  if (requiredRole === 'moderator') {
    return role === 'admin' || role === 'moderator';
  }

  return role === 'admin';
}

export function useAdminAccess(requiredRole: AdminAccessRole = 'admin') {
  const [status, setStatus] = useState<AdminAccessStatus>('idle');
  const [role, setRole] = useState<AdminAccessRole | null>(null);

  const verifyAdminAccess = useCallback(async () => {
    setStatus('checking');
    setRole(null);

    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });

      if (!response.ok) {
        setStatus('error');
        return false;
      }

      const session = (await response.json()) as AuthSessionPayload;

      if (!session.authenticated) {
        setStatus('forbidden');
        window.location.assign(
          new URL('/api/auth/google/start', window.location.origin),
        );
        return false;
      }

      if (!hasRequiredRole(session.user?.role, requiredRole)) {
        setStatus('forbidden');
        return false;
      }

      setRole(session.user?.role as AdminAccessRole);
      setStatus('allowed');
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, [requiredRole]);

  return {
    adminAccessRole: role,
    isAdminAccessAllowed: status === 'allowed',
    isAdminAccessChecking: status === 'checking' || status === 'idle',
    adminAccessNotice:
      status === 'error'
        ? 'تعذر التحقق من صلاحيات الإدارة الآن. حاول مرة أخرى.'
        : status === 'forbidden'
          ? 'هذه الصفحة مخصصة للإدارة فقط.'
        : '',
    verifyAdminAccess,
  };
}
