import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicSellerProfile } from '@/agent/marketplace/repository';
import { hasVerifiedAdminAccess } from '@/lib/auth/authorization';
import { getPageSession } from '@/lib/mobile/page-session';
import { CustomerAppGateway } from '@/components/customer-app-gateway';
import { AdminSellerPreview } from '@/components/admin/customer-record-preview';

type PageProps = { params: Promise<{ sellerId: string }> };
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sellerId } = await params;
  const seller = await getPublicSellerProfile(sellerId, { includeListings: false });
  if (!seller) return { title: 'المعلن غير متاح', robots: { index: false } };
  const title = `${seller.name} | سوق حمد`;
  const url = `/sellers/${encodeURIComponent(seller.id)}`;
  return { title, alternates: { canonical: url }, openGraph: { title, url } };
}

export default async function SellerProfilePage({ params }: PageProps) {
  const { sellerId } = await params;
  const session = await getPageSession();
  const preview = await hasVerifiedAdminAccess(session);
  const seller = await getPublicSellerProfile(sellerId, { includeListings: preview });
  if (!seller) notFound();
  if (preview) return <AdminSellerPreview seller={seller} />;
  return <CustomerAppGateway path={`/sellers/${encodeURIComponent(seller.id)}`} />;
}
