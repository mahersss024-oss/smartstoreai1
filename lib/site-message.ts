import { prisma } from '@/lib/db/prisma';
import { runOptionalTask } from '@/lib/optional-task';

export const primarySiteMessageId = 'primary';

export function isSiteMessageVisible(
  message: { isEnabled: boolean; expiresAt: Date | null },
  now = new Date(),
) {
  return message.isEnabled && (!message.expiresAt || message.expiresAt > now);
}

export async function getActiveSiteMessage(now = new Date()) {
  if (
    process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database' ||
    !process.env.DATABASE_URL?.trim()
  ) {
    return null;
  }

  return runOptionalTask('site_message', () => prisma.siteMessage.findFirst({
      where: {
        id: primarySiteMessageId,
        isEnabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { message: true, type: true, expiresAt: true },
  }));
}
