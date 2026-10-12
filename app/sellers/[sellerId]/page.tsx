/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Clock3,
  MapPin,
} from 'lucide-react';

import {
  getPublicSellerProfile,
  type PublicSellerProfile,
} from '@/agent/marketplace/repository';
import type { ListingCondition } from '@/agent/marketplace/types';
import { Button } from '@ui/button';
import { SellerAvatar } from '@/components/seller-avatar';
import { SellerProfileActions } from './seller-profile-actions';
import { SellerProfileIdentity } from './seller-profile-identity';

type PageProps = {
  params: Promise<{
    sellerId: string;
  }>;
  searchParams: Promise<{
    source?: string | string[];
    conversationId?: string | string[];
    listingId?: string | string[];
  }>;
};

export const dynamic = 'force-dynamic';

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22600%22 height=%22400%22 viewBox=%220 0 600 400%22%3E%3Crect width=%22600%22 height=%22400%22 fill=%22%23101827%22/%3E%3Cpath d=%22M230 155h140a24 24 0 0 1 24 24v74a24 24 0 0 1-24 24H230a24 24 0 0 1-24-24v-74a24 24 0 0 1 24-24z%22 fill=%22none%22 stroke=%22%233b82f6%22 stroke-width=%2210%22/%3E%3Ccircle cx=%22262%22 cy=%22202%22 r=%2216%22 fill=%22%233b82f6%22/%3E%3Cpath d=%22m226 260 48-50 38 38 24-25 42 37%22 fill=%22none%22 stroke=%22%233b82f6%22 stroke-width=%2210%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3C/svg%3E';

function formatPrice(price: number | 'bid' | 'negotiable' | undefined) {
  if (typeof price === 'number') {
    return `${new Intl.NumberFormat('ar-SA').format(price)} ر.س`;
  }

  if (price === 'bid') {
    return 'على السوم';
  }

  if (price === 'negotiable') {
    return 'قابل للتفاوض';
  }

  return 'السعر غير محدد';
}

function formatCondition(condition: ListingCondition | undefined) {
  const labels: Record<ListingCondition, string> = {
    new: 'جديد',
    used: 'مستخدم',
    like_new: 'شبه جديد',
    damaged: 'يحتاج صيانة',
  };

  return condition ? labels[condition] : 'غير محددة';
}

function getPrimaryImageUrl(
  listing: PublicSellerProfile['listings'][number],
) {
  const image = listing.images.find((candidate) => candidate.status === 'approved');

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    missingListingImageDataUrl
  );
}

function formatJoinDate(value: string | undefined) {
  if (!value) {
    return 'عضو في سوق حمد';
  }

  return new Intl.DateTimeFormat('ar-SA', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function formatListingRelativeTime(value: string | undefined) {
  if (!value) {
    return 'وقت غير محدد';
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return 'وقت غير محدد';
  }

  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000));

  if (minutes < 60) {
    return `منذ ${minutes} دقيقة`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `منذ ${hours} ساعة`;
  }

  const days = Math.floor(hours / 24);

  if (days < 30) {
    return `منذ ${days} يوم`;
  }

  return new Intl.DateTimeFormat('ar-SA', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(timestamp));
}

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isSafePathSegment(value: string | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]+$/.test(value));
}

function getSellerReturnHref(searchParams: Awaited<PageProps['searchParams']>) {
  const source = getSingleSearchParam(searchParams.source);
  const conversationId = getSingleSearchParam(searchParams.conversationId);
  const listingId = getSingleSearchParam(searchParams.listingId);

  if (source === 'admin-users') {
    return '/admin/users';
  }

  if (source === 'conversation' && isSafePathSegment(conversationId)) {
    return `/conversations/${encodeURIComponent(conversationId)}`;
  }

  if (source === 'listing' && isSafePathSegment(listingId)) {
    return `/listings/${encodeURIComponent(listingId)}`;
  }

  if (source === 'follows') {
    return '/account/follows';
  }

  return '/';
}

function getSellerListingHref(
  listingId: string,
  sellerId: string,
  searchParams: Awaited<PageProps['searchParams']>,
) {
  const query = new URLSearchParams({
    source: 'seller',
    sellerId,
  });
  const source = getSingleSearchParam(searchParams.source);
  const conversationId = getSingleSearchParam(searchParams.conversationId);
  const sourceListingId = getSingleSearchParam(searchParams.listingId);

  if (source === 'admin-users' || source === 'follows') {
    query.set('sellerSource', source);
  }

  if (source === 'conversation' && isSafePathSegment(conversationId)) {
    query.set('sellerSource', source);
    query.set('conversationId', conversationId);
  }

  if (source === 'listing' && isSafePathSegment(sourceListingId)) {
    query.set('sellerSource', source);
    query.set('sourceListingId', sourceListingId);
  }

  return `/listings/${encodeURIComponent(listingId)}?${query.toString()}`;
}

export default async function SellerProfilePage({ params, searchParams }: PageProps) {
  const { sellerId: rawSellerId } = await params;
  const resolvedSearchParams = await searchParams;
  const sellerId = decodeURIComponent(rawSellerId);
  const returnHref = getSellerReturnHref(resolvedSearchParams);
  const seller = await getPublicSellerProfile(sellerId);

  if (!seller) {
    notFound();
  }

  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid h-full min-h-0 max-w-5xl gap-2 px-1.5 py-2 sm:px-3 md:px-4 lg:px-6 lg:py-3">
        <section className="marketplace-panel flex min-h-0 flex-col overflow-hidden rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-[#f7f9fc] px-2 dark:bg-background sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href={returnHref}>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">صفحة المعلن</h1>
              <p className="truncate text-xs text-muted-foreground">بيانات عامة وإعلانات منشورة</p>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/45 p-2 dark:bg-background/55 sm:p-3 lg:p-4">
        <section className="marketplace-home-controls shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-card">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-3">
            <div className="grid size-12 place-items-center overflow-hidden rounded-md border border-white/80 bg-[#0f766e] text-base font-bold text-white shadow-sm dark:border-white/10 sm:size-14">
              <SellerAvatar
                alt={seller.name}
                className="size-full object-cover"
                picture={seller.picture}
              />
            </div>

            <div className="min-w-0">
              <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-bold sm:text-lg">{seller.name}</h2>
                <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <BadgeCheck className="size-3.5" />
                  موثق
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{formatJoinDate(seller.joinedAt)}</span>
                <span>{seller.publishedListingCount} إعلان منشور</span>
              </div>
            </div>

            <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
              <SellerProfileIdentity compact sellerId={seller.id} sellerName={seller.name} />
              <SellerProfileActions
                sellerId={seller.id}
                sellerName={seller.name}
                initialFollowerCount={seller.followerCount}
                initialRatingAverage={seller.ratingAverage}
                initialRatingCount={seller.ratingCount}
              />
            </div>
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 pt-3">
          <div className="shrink-0 flex items-center justify-between gap-3 px-1 py-1">
            <h2 className="text-base font-bold">إعلانات المعلن</h2>
            <span className="text-xs font-semibold text-muted-foreground">
              {seller.publishedListingCount} إعلان منشور
            </span>
          </div>

          <div className="marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--marketplace-bottom-nav-space)] pt-1">
          {seller.listings.length ? (
            <div className="grid min-w-0 gap-1.5">
              {seller.listings.map((listing) => (
                <Link
                  key={listing.id}
                  href={getSellerListingHref(listing.id, seller.id, resolvedSearchParams)}
                  prefetch={false}
                  className="group grid min-w-0 max-w-full grid-cols-[clamp(6.25rem,28vw,7.25rem)_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-sm transition hover:border-blue-300 hover:bg-blue-50/35 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10"
                >
                  <div
                    className="aspect-square shrink-0 overflow-hidden bg-[#0b1220]"
                    style={{
                      maxWidth: '100%',
                      minHeight: 'clamp(6.25rem, 28vw, 7.25rem)',
                      overflow: 'hidden',
                      width: '100%',
                    }}
                  >
                    <img
                      alt={listing.title ?? 'صورة الإعلان'}
                      className="block h-full w-full min-w-0 max-w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      src={getPrimaryImageUrl(listing)}
                      style={{
                        height: '100%',
                        maxWidth: '100%',
                        objectFit: 'cover',
                        width: '100%',
                      }}
                    />
                  </div>
                  <div className="grid min-w-0 content-between gap-1 px-2 py-1.5 sm:px-3 sm:py-2">
                    <h3 className="line-clamp-2 text-[13px] font-bold leading-5 text-emerald-600 dark:text-emerald-300 sm:text-sm">
                      {listing.title ?? 'إعلان بدون عنوان'}
                    </h3>
                    <div className="text-[15px] font-black leading-6 text-slate-900 dark:text-white">
                      {formatPrice(listing.price)}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground">
                      <Clock3 className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {formatListingRelativeTime(listing.createdAt ?? listing.updatedAt)}
                      </span>
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">{listing.city ?? 'السعودية'}</span>
                    </div>
                    <div className="hidden">
                      <span className="font-bold text-blue-700">
                        {formatPrice(listing.price)}
                      </span>
                      <span className="rounded-md bg-white px-2 py-1 text-muted-foreground dark:bg-[#0b1220]">
                        {formatCondition(listing.condition)}
                      </span>
                    </div>
                  </div>
                  <div className="hidden">
                    <span className="font-bold text-blue-700">
                      {formatPrice(listing.price)}
                    </span>
                    <span className="rounded-md bg-white px-2 py-1 text-xs text-muted-foreground dark:bg-[#0b1220]">
                      {formatCondition(listing.condition)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              لا توجد إعلانات منشورة لهذا المعلن حاليًا.
            </p>
          )}
          </div>
        </section>
        </div>
        </section>
      </div>
    </main>
  );
}
