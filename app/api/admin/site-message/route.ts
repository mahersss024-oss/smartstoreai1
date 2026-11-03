import { noStoreHeaders } from '@/lib/api/no-store';
import { isPlatformOwner } from '@/lib/auth/authorization';
import { getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { primarySiteMessageId } from '@/lib/site-message';

export const dynamic = 'force-dynamic';
type OwnerAccess = { session: NonNullable<ReturnType<typeof getAuthSession>> } | { response: Response };
function requireOwner(request: Request): OwnerAccess {
  const session = getAuthSession(request);
  if (!session) return { response: Response.json({ error: 'auth_required' }, { status: 401, headers: noStoreHeaders }) };
  if (!isPlatformOwner(session)) return { response: Response.json({ error: 'owner_required' }, { status: 403, headers: noStoreHeaders }) };
  return { session };
}
export async function GET(request: Request) {
  const owner = requireOwner(request); if ('response' in owner) return owner.response;
  if (process.env.SMARTSTORE_MARKETPLACE_STORE !== 'database') return Response.json({ error: 'database_required' }, { status: 503, headers: noStoreHeaders });
  try {
    const siteMessage = await prisma.siteMessage.findUnique({ where: { id: primarySiteMessageId } });
    return Response.json({ siteMessage, monitoringOnly: true }, { headers: noStoreHeaders });
  } catch {
    return Response.json({ error: 'site_message_unavailable' }, { status: 503, headers: noStoreHeaders });
  }
}
function readOnly(request: Request): Response {
  const owner = requireOwner(request); if ('response' in owner) return owner.response;
  return Response.json({ error: 'maintenance_read_only', monitoringOnly: true }, { status: 403, headers: noStoreHeaders });
}
export async function PATCH(request: Request) { return readOnly(request); }
export async function POST(request: Request) { return readOnly(request); }
export async function PUT(request: Request) { return readOnly(request); }
export async function DELETE(request: Request) { return readOnly(request); }
