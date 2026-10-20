import { getPublicSellerProfile } from '@/agent/marketplace/repository';
import { noStoreHeaders } from '@/lib/api/no-store';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{userId: string}>;
};

export async function GET(_request: Request, context: RouteContext) {
  const {userId} = await context.params;
  const seller = await getPublicSellerProfile(decodeURIComponent(userId));

  if (!seller) {
    return Response.json({error: 'seller_not_found'}, {status: 404, headers: noStoreHeaders});
  }

  const publicSeller = {...seller};
  delete publicSeller.phoneNumber;
  return Response.json({seller: publicSeller}, {headers: noStoreHeaders});
}
