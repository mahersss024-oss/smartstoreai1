import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getAuthSession } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/authorization';

export default async function MaintenanceLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  const request = new Request('https://souqhamad.invalid/admin/maintenance', { headers: requestHeaders });
  const session = getAuthSession(request);

  if (!session) redirect('/api/auth/google/start?return_to=%2Fadmin%2Fmaintenance');
  if (!isPlatformOwner(session)) notFound();

  return children;
}
