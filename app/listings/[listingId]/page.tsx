import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getListing } from '@/agent/marketplace/repository';
import { hasVerifiedModeratorAccess } from '@/lib/auth/authorization';
import { getPageSession } from '@/lib/mobile/page-session';
import { CustomerAppGateway } from '@/components/customer-app-gateway';
import { AdminListingPreview } from '@/components/admin/customer-record-preview';

type PageProps = { params: Promise<{ listingId: string }> };
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { listingId } = await params;
  const listing = await getListing(listingId);
  if (!listing || listing.status !== 'published') return { title: 'الإعلان غير متاح', robots: { index: false } };
  const image = listing.images.find(image => image.status === 'approved' && image.isPrimary)
    || listing.images.find(image => image.status === 'approved');
  const url = `/listings/${encodeURIComponent(listing.id)}`;
  const title = `${listing.title || 'إعلان'} | سوق حمد`;
  const description = listing.description?.slice(0, 180);
  const imageUrl = image?.displayUrl || image?.thumbnailUrl;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, images: imageUrl ? [imageUrl] : [] }, twitter: { card: imageUrl ? 'summary_large_image' : 'summary', title, description, images: imageUrl ? [imageUrl] : [] } };
}

export default async function ListingDetailsPage({ params }: PageProps) {
  const { listingId } = await params;
  const [listing, session] = await Promise.all([getListing(listingId), getPageSession()]);
  if (!listing) notFound();
  if (await hasVerifiedModeratorAccess(session)) return <AdminListingPreview listing={listing} />;
  if (listing.status !== 'published') notFound();
  return <CustomerAppGateway path={`/listings/${encodeURIComponent(listing.id)}`} />;
}
