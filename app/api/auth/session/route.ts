import { noStoreHeaders } from '@/lib/api/no-store';
import {
  getVerifiedRoleForSession,
  shouldVerifyRoleFromDatabase,
} from '@/lib/auth/authorization';
import {
  clearSessionCookie,
  getAuthSession,
  getCommissionAgreement,
  isConfiguredAdminEmail,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

function shouldReadUserProfile() {
  return (
    process.env.SMARTSTORE_MARKETPLACE_STORE === 'database' &&
    Boolean(process.env.DATABASE_URL)
  );
}

export async function GET(request: Request) {
  const session = getAuthSession(request);
  const commissionAgreement = getCommissionAgreement(request);
  const verifiedRole = await getVerifiedRoleForSession(session);
  const role = shouldVerifyRoleFromDatabase()
    ? verifiedRole ?? 'user'
    : verifiedRole ?? session?.user.role ?? 'user';
  const user = session
    ? {
        ...session.user,
        role,
      }
    : null;

  if (user && session && shouldReadUserProfile()) {
    try {
      const profile = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          name: true,
          phoneNumber: true,
          picture: true,
          role: true,
          deletedAt: true,
        },
      });

      if (!profile || profile.deletedAt) {
        return Response.json(
          {
            authenticated: false,
            user: null,
            commissionAgreementAccepted: false,
            commissionAgreement: null,
          },
          {
            headers: {
              ...noStoreHeaders,
              'Set-Cookie': clearSessionCookie(),
            },
          },
        );
      }

      if (profile) {
        user.name = profile.name ?? undefined;
        user.picture = profile.picture ?? undefined;
        user.phoneNumber = profile.phoneNumber ?? undefined;
        user.role = isConfiguredAdminEmail(session.user.email)
          ? 'owner'
          : profile.role;
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
