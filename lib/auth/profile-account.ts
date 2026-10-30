import type { Prisma } from '@prisma/client';

/** Serialize profile writes with account deletion, without creating identities. */
export async function lockActiveProfileUser(database: Prisma.TransactionClient, userId: string) {
  // Match the User evidence trigger's advisory-before-row lock order.
  await database.$executeRaw`SELECT pg_advisory_xact_lock(771204, hashtext(${'user:' + userId}))`;
  await database.$executeRaw`SELECT 1 FROM "User" WHERE id = ${userId} FOR UPDATE`;
  const current = await database.user.findUnique({ where: { id: userId } });
  return current && !current.deletedAt ? current : null;
}
