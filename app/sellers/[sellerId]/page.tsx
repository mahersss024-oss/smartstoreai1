/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  Store,
  UserRound,
} from 'lucide-react';

import {
  getPublicSellerProfile,
  type PublicSellerProfile,
} from '@/agent/marketplace/repository';
import type { ListingCondition } from '@/agent/marketplace/types';
import { Button } from '@ui/button';
import { SellerProfileActions } from './seller-profile-actions';

type PageProps = {
  params: Promise<{
    sellerId: string;
  }>;
};

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

export default async function SellerProfilePage({ params }: PageProps) {
  const { sellerId } = await params;
  const seller = await getPublicSellerProfile(sellerId);

  if (!seller) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/40 px-1 py-3 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/">
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
          <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
            <Link href="/">
              <Store className="size-4" />
              العودة للسوق
            </Link>
          </Button>
        </header>

        <section className="overflow-hidden bg-white dark:bg-card">
          <div className="h-28 bg-[linear-gradient(135deg,#0f766e,#0f172a_55%,#1d4ed8)] sm:h-36" />
          <div className="-mt-12 grid gap-4 px-4 pb-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end sm:px-6">
            <div className="grid size-24 place-items-center overflow-hidden rounded-md border-4 border-white bg-[#0f766e] text-3xl font-bold text-white shadow-sm dark:border-card">
              {seller.picture ? (
                <img
                  alt={seller.name}
                  className="size-full object-cover"
                  src={seller.picture}
                />
              ) : (
                <UserRound className="size-10" />
              )}
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
                <span>{seller.followerCount} متابع</span>
              </div>
            </div>

            <SellerProfileActions
              reportListingId={seller.listings[0]?.id}
              sellerName={seller.name}
            />
          </div>
        </section>

        <section className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="border-t border-border/70 pt-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Star className="size-4 text-blue-600" />
              التقييم
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {seller.ratingCount} تقييم، متوسط {seller.ratingAverage.toFixed(1)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 rounded-md"
              disabled
              title="سيتم تفعيل التقييم في مرحلة لاحقة"
            >
              تقييم المعلن
            </Button>
          </div>
          <div className="border-t border-border/70 pt-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <MessageCircle className="size-4 text-blue-600" />
              التواصل
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              يتم فتح المحادثة من داخل الإعلان لحماية سياق البيع.
            </p>
          </div>
          <div className="border-t border-border/70 pt-3">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ShieldCheck className="size-4 text-blue-600" />
              السلامة
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              الإبلاغ والحظر متاحان من المحادثة عند وجود تعامل مباشر.
            </p>
          </div>
        </section>

        <section className="bg-white dark:bg-card">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="border-b-2 border-blue-600 px-1 pb-2 text-sm font-bold text-blue-700 dark:text-blue-300">
                الإعلانات
              </span>
              <span className="px-1 pb-2 text-sm text-muted-foreground">
                التقييمات
              </span>
              <span className="px-1 pb-2 text-sm text-muted-foreground">
                عن المعلن
              </span>
            </div>
          </div>

          {seller.listings.length ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {seller.listings.map((listing) => (
                <Link
                  key={listing.id}
                  href={`/listings/${listing.id}`}
                  className="group overflow-hidden rounded-md bg-[#f8fafc] transition hover:bg-blue-50/70 dark:bg-[#101827] dark:hover:bg-blue-400/10"
                >
                  <div className="aspect-[4/3] overflow-hidden bg-[#0b1220]">
                    <img
                      alt={listing.title ?? 'صورة الإعلان'}
                      className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      src={getPrimaryImageUrl(listing)}
                    />
                  </div>
                  <div className="grid gap-2 p-3">
                    <h3 className="line-clamp-2 min-h-10 text-sm font-bold">
                      {listing.title ?? 'إعلان بدون عنوان'}
                    </h3>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-bold text-blue-700">
                        {formatPrice(listing.price)}
                      </span>
                      <span className="rounded-md bg-white px-2 py-1 text-xs text-muted-foreground dark:bg-[#0b1220]">
                        {formatCondition(listing.condition)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="size-3.5 text-blue-600" />
                      {listing.city ?? 'السعودية'}
                    </div>
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
