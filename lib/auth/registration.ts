import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { normalizeAuthEmail } from '@/lib/auth/identity';
import {
  commissionAgreementVersion,
  commissionPolicyVersion,
  getCommissionAgreement,
  getConfiguredRoleForEmail,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
  type AuthSessionUser,
} from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';

export const selfAccountDeletionOperation = 'self_user_delete';

function metadataObject(value: Prisma.JsonValue) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function retiredAccountEmail(id: string) {
  return `deleted.${createHash('sha256').update(id).digest('hex')}@accounts.invalid`;
}

export async function getRegistrationIdentityEmail(
  database: Prisma.TransactionClient,
  user: { id: string; email: string },
) {
  if (user.email !== retiredAccountEmail(user.id)) return normalizeAuthEmail(user.email);
  const deletion = await database.adminAuditLog.findFirst({
    where: {
      action: 'delete_user', targetType: 'user', targetId: user.id,
      metadata: { path: ['operation'], equals: selfAccountDeletionOperation },
    },
    orderBy: { createdAt: 'desc' }, select: { metadata: true },
  });
  const email = deletion && metadataObject(deletion.metadata).email;
  if (typeof email !== 'string' || !email) throw new Error('ACCOUNT_IDENTITY_UNAVAILABLE');
  return normalizeAuthEmail(email);
}

export async function persistUserRegistration(request: Request, identity: AuthSessionUser) {
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') {
    if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_USER_REGISTRATION_REQUIRED');
    return identity;
  }

  const user = { ...identity, email: normalizeAuthEmail(identity.email) };
  const agreement = getCommissionAgreement(request);
  const registrationData = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    commissionAgreementVersion: agreement ? commissionAgreementVersion : undefined,
    commissionAgreementAccepted: agreement ? new Date(agreement.acceptedAt * 1000) : undefined,
    platformAgreementVersion: agreement ? platformAgreementVersion : undefined,
    platformAgreementAccepted: agreement ? new Date(agreement.acceptedAt * 1000) : undefined,
    termsVersion: agreement ? termsVersion : undefined,
    privacyPolicyVersion: agreement ? privacyPolicyVersion : undefined,
    listingPolicyVersion: agreement ? listingPolicyVersion : undefined,
    commissionPolicyVersion: agreement ? commissionPolicyVersion : undefined,
  };

  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async database => {
        const byEmail = await database.user.findUnique({ where: { email: user.email } });
        const byIdentity = byEmail?.id === user.id ? byEmail
          : await database.user.findUnique({ where: { id: user.id } });
        const ids = [...new Set([user.id, byEmail?.id, byIdentity?.id].filter((id): id is string => Boolean(id)))];
        const history = await database.adminAuditLog.findMany({
          where: {
            targetType: 'user', action: { in: ['delete_user', 'update_user'] },
            OR: [
              { targetId: { in: ids } },
              { metadata: { path: ['email'], equals: user.email } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { action: true, targetId: true, metadata: true, createdAt: true },
        });

        // Self-deletion cannot cancel an administrator's decision, including
        // after permanent deletion or a switch of identity provider.
        const checkedAdminDecisions = new Set<string>();
        for (const event of history) {
          if (event.action !== 'delete_user' ||
              metadataObject(event.metadata).operation === selfAccountDeletionOperation ||
              checkedAdminDecisions.has(event.targetId)) continue;
          checkedAdminDecisions.add(event.targetId);
          const restored = await database.adminAuditLog.findFirst({
            where: {
              action: 'update_user', targetType: 'user', targetId: event.targetId,
              createdAt: { gt: event.createdAt },
              metadata: { path: ['updates', 'accountStatus'], equals: 'active' },
            },
            select: { id: true },
          });
          if (!restored) throw new Error('ACCOUNT_SOFT_DELETED');
        }

        for (const existing of [byEmail, byIdentity]) {
          if (!existing?.deletedAt) continue;
          const selfDeleted = history.some(event => {
            const metadata = metadataObject(event.metadata);
            return event.targetId === existing.id && event.action === 'delete_user' &&
              metadata.operation === selfAccountDeletionOperation &&
              metadata.deletedAt === existing.deletedAt!.toISOString();
          });
          if (!selfDeleted) throw new Error('ACCOUNT_SOFT_DELETED');
        }

        const existing = byEmail ?? (byIdentity && !byIdentity.deletedAt ? byIdentity : null);
        if (existing && !existing.deletedAt) {
          const updated = await database.user.update({
            where: { id: existing.id },
            data: {
              ...registrationData,
              name: existing.name ?? user.name,
              picture: existing.picture ?? user.picture,
            },
          });
          return sessionUser(updated);
        }

        const selfDeletion = history.find(event => event.action === 'delete_user' &&
          metadataObject(event.metadata).operation === selfAccountDeletionOperation);
        if (byEmail?.deletedAt) {
          await database.user.update({
            where: { id: byEmail.id }, data: { email: retiredAccountEmail(byEmail.id) },
          });
        }

        // A fresh identity leaves retained records and old session cookies
        // attached to the deleted account, without restoring its privileges.
        const created = await database.user.create({
          data: {
            id: selfDeletion ? `${user.id}:r:${randomUUID()}` : user.id,
            role: getConfiguredRoleForEmail(user.email),
            ...registrationData,
          },
        });
        return sessionUser(created);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (attempt < 2 && (code === 'P2034' || code === 'P2002')) continue;
      throw error;
    }
  }
}

function sessionUser(user: { id: string; email: string; name: string | null; picture: string | null; role: string }) {
  return {
    id: user.id, email: user.email, name: user.name ?? undefined,
    picture: user.picture ?? undefined, role: user.role,
  };
}
