'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useAuthSession } from '@/hooks/use-auth-session';

/** The server authorizes the record before rendering this guard. It also hides
 * already-open previews when another tab signs out or the session expires. */
export function AdminRecordAccess({ children, requiredRole }: {
  children: ReactNode;
  requiredRole: 'admin' | 'moderator';
}) {
  const { session, isSessionLoading } = useAuthSession();
  if (isSessionLoading) return <p role="status" className="p-6 text-center">جارٍ التحقق من الدخول…</p>;
  const role = session.user?.role;
  const allowed = session.authenticated && (role === 'owner' || role === 'admin' || (requiredRole === 'moderator' && role === 'moderator'));
  if (!allowed) return <main dir="rtl" className="grid min-h-dvh place-items-center p-6" data-admin-record-denied>
    <Link href="/admin" className="rounded-lg border px-5 py-3 text-sm">تسجيل الدخول إلى الإدارة</Link>
  </main>;
  return children;
}
