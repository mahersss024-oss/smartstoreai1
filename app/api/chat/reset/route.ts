import { resetMarketplaceSearchState } from '@/agent/marketplace/search-state';
import { resetIncompleteSellerDrafts } from '@/agent/marketplace/repository';
import { getAuthSession } from '@/lib/auth/session';
import { getChatSearchOwnerKey } from '@/lib/chat/search-owner';

export async function POST(request: Request) {
  const session = getAuthSession(request);
  const ownerKey = getChatSearchOwnerKey(session, request);

  await resetMarketplaceSearchState(ownerKey);

  if (session) {
    await resetIncompleteSellerDrafts(session.user.id);
  }

  return Response.json(
    { status: 'reset' },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
