import { noStoreHeaders } from '@/lib/api/no-store';
import {
  getAuthSession,
  getCommissionAgreement,
  isAdminSession,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

function shouldReadUserProfile() {
  return process.env.SMARTSTORE_MARKETPLACE_STORE === 'database';
}

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const commissionAgreement = getCommissionAgreement(request);
  const user = session
    ? {
        ...session.user,
        role: isAdminSession(session) ? 'admin' : session.user.role ?? 'user',
      }
    : null;

  if (user && shouldReadUserProfile()) {
    try {
      const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: { phoneNumber: true, role: true },
      });

      if (profile) {
        user.phoneNumber = profile.phoneNumber ?? undefined;
        user.role = isAdminSession(session) ? 'admin' : profile.role;
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`[auth_session] profile_lookup_failed=${errorName}`);
    }
  }

  return Response.json(
    {
      authenticated: Boolean(session),
      user,
      commissionAgreementAccepted: Boolean(commissionAgreement),
      commissionAgreement,
    },
    { headers: noStoreHeaders },
  );
}
