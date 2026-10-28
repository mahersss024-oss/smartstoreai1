import { z } from 'zod';

import { noStoreHeaders } from '@/lib/api/no-store';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';
import { rejectOversizedRequest } from '@/lib/api/request-size';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { primarySiteMessageId } from '@/lib/site-message';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  message: z.string().trim().min(1).max(500),
  type: z.enum(['info', 'warning', 'maintenance']),
  isEnabled: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});

function requireOwner(request: Request) {
  const session = getAuthSession(request);
  if (!session) return { response: Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders }) };
  if (!isPlatformOwner(session)) {
    return { response: Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders }) };
  }
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return { response: Response.json({ error: 'database_required' }, { status: 503, headers: noStoreHeaders }) };
  return { session };
}

export async function GET(request: Request) {
  const owner = requireOwner(request);
  if ('response' in owner) return owner.response;

  const siteMessage = await prisma.siteMessage.findUnique({
    where: { id: primarySiteMessageId },
  });

  return Response.json({ siteMessage }, { headers: noStoreHeaders });
}

export async function PATCH(request: Request) {
  const owner = requireOwner(request);
  if ('response' in owner) return owner.response;

  const rateLimited = await enforceApiRateLimit(request, {
    namespace: 'admin_site_message_update',
    actorId: owner.session.user.id,
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const oversized = rejectOversizedRequest(request, 8 * 1024);
  if (oversized) return oversized;

  const payload = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (parsed.data.isEnabled && expiresAt && expiresAt <= new Date()) {
    return Response.json({ error: 'expiration_must_be_future' }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.siteMessage.findUnique({
      where: { id: primarySiteMessageId },
    });
    const siteMessage = await tx.siteMessage.upsert({
      where: { id: primarySiteMessageId },
      create: {
        id: primarySiteMessageId,
        ...parsed.data,
        expiresAt,
        updatedById: owner.session.user.id,
      },
      update: {
        ...parsed.data,
        expiresAt,
        updatedById: owner.session.user.id,
      },
    });

    await tx.adminAuditLog.create({
      data: {
        adminId: owner.session.user.id,
        action: 'update_site_message',
        targetType: 'site_message',
        targetId: primarySiteMessageId,
        metadata: {
          operation: previous ? 'site_message_update' : 'site_message_create',
          previous: previous
            ? {
                message: previous.message,
                type: previous.type,
                isEnabled: previous.isEnabled,
                expiresAt: previous.expiresAt?.toISOString() ?? null,
              }
            : null,
          next: {
            message: siteMessage.message,
            type: siteMessage.type,
            isEnabled: siteMessage.isEnabled,
            expiresAt: siteMessage.expiresAt?.toISOString() ?? null,
          },
        },
      },
    });

    return siteMessage;
  });

  return Response.json({ siteMessage: result }, { headers: noStoreHeaders });
}
