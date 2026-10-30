import { headers } from 'next/headers';
import { getAuthSession } from '@/lib/auth/session';

/** Browser administration keeps its existing verified session and URL contracts. */
export async function getPageSession() {
  return getAuthSession(new Request('https://souqhamad.com/', { headers: await headers() }));
}
