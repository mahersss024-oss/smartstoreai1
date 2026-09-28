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
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href={returnHref}>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white dark:bg-card">
              <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.jpeg" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">صفحة المعلن</h1>
              <p className="truncate text-xs text-muted-foreground">بيانات عامة وإعلانات منشورة</p>
            </div>
          </div>
        </header>

        <section className="overflow-hidden bg-white dark:bg-card">
          <div className="h-28 bg-[linear-gradient(135deg,#0f766e,#0f172a_55%,#1d4ed8)] sm:h-36" />
          <div className="-mt-12 grid gap-4 px-4 pb-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end sm:px-6">
            <div className="grid size-24 place-items-center overflow-hidden rounded-md border-4 border-white bg-[#0f766e] text-3xl font-bold text-white shadow-sm dark:border-card">
              <SellerAvatar
                alt={seller.name}
                className="size-full object-cover"
                picture={seller.picture}
              />
            </div>

            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-bold">{seller.name}</h2>
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <BadgeCheck className="size-3.5" />
                  معلن موثق داخل سوق حمد
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>{formatJoinDate(seller.joinedAt)}</span>
                <span>{seller.publishedListingCount} إعلان منشور</span>
              </div>
            </div>

            <SellerProfileActions
              sellerId={seller.id}
              sellerName={seller.name}
              initialFollowerCount={seller.followerCount}
              initialRatingAverage={seller.ratingAverage}
              initialRatingCount={seller.ratingCount}
            />
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3 px-1 py-2">
            <h2 className="text-base font-bold">إعلانات المعلن</h2>
            <span className="text-xs font-semibold text-muted-foreground">
              {seller.publishedListingCount} إعلان منشور
            </span>
          </div>

          {seller.listings.length ? (
            <div className="grid gap-1.5">
              {seller.listings.map((listing) => (
                <Link
                  key={listing.id}
                  href={getSellerListingHref(listing.id, seller.id, resolvedSearchParams)}
                  className="group grid grid-cols-[6.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-sm transition hover:border-blue-300 hover:bg-blue-50/35 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10 sm:grid-cols-[7.25rem_minmax(0,1fr)]"
                >
                  <div className="aspect-square min-h-[6.25rem] overflow-hidden bg-[#0b1220] sm:min-h-[7.25rem]">
                    <img
                      alt={listing.title ?? 'صورة الإعلان'}
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      src={getPrimaryImageUrl(listing)}
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
        </section>
      </div>
    </main>
  );
}
