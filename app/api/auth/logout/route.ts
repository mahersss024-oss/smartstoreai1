import { NextResponse } from 'next/server';

import { clearSessionCookie } from '@/lib/auth/session';

export async function POST() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Set-Cookie': clearSessionCookie(),
    },
  });
}
