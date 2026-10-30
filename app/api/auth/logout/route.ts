import { NextResponse } from 'next/server';

import { clearSessionCookie } from '@/lib/auth/session';
import { noStoreHeaders } from '@/lib/api/no-store';

export async function POST() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...noStoreHeaders,
      'Set-Cookie': clearSessionCookie(),
    },
  });
}
