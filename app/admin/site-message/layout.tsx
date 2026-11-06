import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthSession } from '@/lib/auth/session';
import { isPlatformOwner } from '@/lib/auth/authorization';

export default async function SiteMessageLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestHeaders = await headers();
  const request = new Request('https://souqhamad.invalid/admin/site-message', { headers: requestHeaders });
  const session = getAuthSession(request);

  if (!session || !isPlatformOwner(session)) notFound();

  return children;
}
