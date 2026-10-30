import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthSession } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/authorization';

export default async function MaintenanceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  const request = new Request('https://souqhamad.invalid/admin/maintenance', { headers: requestHeaders });
  const session = getAuthSession(request);

  // The enclosing admin shell renders its sign-in entry on this same URL.
  if (!session) return null;
  if (!isPlatformOwner(session)) notFound();

  return children;
}
