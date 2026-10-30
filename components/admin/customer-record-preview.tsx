import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ListingRecord } from '@/agent/marketplace/store';
import type { PublicSellerProfile } from '@/agent/marketplace/repository';
import { ListingImageGallery } from '@/app/listings/[listingId]/listing-image-gallery';
import { formatMarketplaceCategory } from '@/lib/marketplace/categories';
import { formatAttributeLabel, formatAttributeValue, formatCondition, formatPrice } from '@/lib/marketplace/listing-presentation';
import { AdminRecordAccess } from './admin-record-access';

function PreviewFrame({ children, back, requiredRole = 'admin' }: { children: ReactNode; back: string; requiredRole?: 'admin' | 'moderator' }) {
  return <AdminRecordAccess requiredRole={requiredRole}><main dir="rtl" className="min-h-dvh bg-background p-4 text-foreground" data-admin-record-preview>
    <div className="mx-auto grid max-w-3xl gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <span className="font-bold">معاينة الإدارة</span>
        <Link href={back} prefetch={false} className="rounded-lg border px-4 py-2 text-sm">العودة إلى الإدارة</Link>
      </header>
      {children}
    </div>
  </main></AdminRecordAccess>;
}

export function AdminListingPreview({ listing }: { listing: ListingRecord }) {
  const images = listing.images.filter(image => image.status === 'approved').flatMap(image => {
    const displayUrl = image.displayUrl || image.originalUrl;
    if (!displayUrl) return [];
    return [{ originalUrl: displayUrl, displayUrl, thumbnailUrl: image.thumbnailUrl || displayUrl }];
  });
  return <PreviewFrame back="/admin/listings" requiredRole="moderator">
    <h1 className="text-xl font-bold">{listing.title || 'إعلان بدون عنوان'}</h1>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {Object.entries({ 'معرف الإعلان': listing.id, 'حالة الإعلان': listing.status, 'التصنيف': formatMarketplaceCategory(listing.category), 'السعر': formatPrice(listing.price), 'المدينة': listing.city, 'حالة المنتج': formatCondition(listing.condition) }).map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border p-3"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words">{value || '—'}</dd></div>)}
    </dl>
    <p className="whitespace-pre-wrap break-words text-sm leading-7">{listing.description}</p>
    <dl className="grid gap-2 text-sm">{Object.entries(listing.attributes || {}).map(([key, value]) => <div key={key} className="flex flex-wrap justify-between gap-3 border-b py-2"><dt>{formatAttributeLabel(key)}</dt><dd className="max-w-full break-words">{formatAttributeValue(key, value)}</dd></div>)}</dl>
    <ListingImageGallery images={images} title={listing.title || 'صور الإعلان'} />
    <p className="break-words text-sm">معرف المعلن: {listing.sellerId}</p>
  </PreviewFrame>;
}

export function AdminSellerPreview({ seller }: { seller: PublicSellerProfile }) {
  return <PreviewFrame back="/admin/users">
    <h1 className="text-xl font-bold">{seller.name}</h1>
    <p className="break-words text-sm">معرف المعلن: {seller.id}</p>
    <h2 className="font-bold">الإعلانات المنشورة ({seller.publishedListingCount})</h2>
    <div className="grid gap-2">{seller.listings.map(listing => <Link key={listing.id} href={`/listings/${encodeURIComponent(listing.id)}`} prefetch={false} className="grid gap-2 rounded-lg border p-4 text-sm"><strong>{listing.title || 'إعلان بدون عنوان'}</strong><span>{formatPrice(listing.price)} · {listing.city}</span></Link>)}</div>
  </PreviewFrame>;
}
