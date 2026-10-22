'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Eye,
  MapPin,
  MessageCircle,
  PackageCheck,
  Star,
} from 'lucide-react';
import { formatMarketplaceCategory } from '@/lib/marketplace/categories';
import {
  getListingCarModel,
  getListingCategoryOption,
  marketplaceCategoryOptionAttribute,
} from '@/lib/marketplace/category-options';
import { marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';
import {
  formatAttributeLabel,
  formatAttributeValue,
  formatCondition,
  formatDate,
  formatPrice,
  formatRelativeListingTime,
  formatSaleTerms,
} from '@/lib/marketplace/listing-presentation';
import { useAuthSession } from '@/hooks/use-auth-session';
import { Button } from '@ui/button';
import { SellerAvatar } from '@/components/seller-avatar';
import { ListingCardImage } from '@/components/listing-card-image';
import { ListingShareButton } from '@/components/listing-share-button';
import { ListingContactActions } from '../../app/listings/[listingId]/contact-actions';
import { ListingImageGallery, type ListingGalleryImage } from '../../app/listings/[listingId]/listing-image-gallery';
import { ListingIdCopyButton } from '../../app/listings/[listingId]/listing-id-copy-button';
import { ListingSafetyActions } from '../../app/listings/[listingId]/listing-safety-actions';
import { SimilarListingFollowButton } from '../../app/listings/[listingId]/similar-follow-button';
import { useRouter, useSearchParams } from 'next/navigation';
import MobileLink from './link';

type Listing = {
  id: string;
  sellerId: string;
  title?: string;
  description?: string;
  status: string;
  price?: number | 'bid' | 'negotiable';
  category: string;
  condition?: 'new' | 'used' | 'like_new' | 'damaged';
  city?: string;
  views?: number;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  attributes?: Record<string, unknown>;
  images?: Array<{
    status?: string;
    isPrimary?: boolean;
    originalUrl?: string;
    displayUrl?: string;
    thumbnailUrl?: string;
  }>;
};

type Seller = {
  name?: string | null;
  picture?: string | null;
  publishedListingCount?: number;
  ratingCount?: number;
  phoneNumber?: string | null;
};

type SimilarListing = Listing & { images: NonNullable<Listing['images']> };

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22750%22 viewBox=%220 0 1200 750%22%3E%3Crect width=%221200%22 height=%22750%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M514 308h172a34 34 0 0 1 34 34v120a34 34 0 0 1-34 34H514a34 34 0 0 1-34-34V342a34 34 0 0 1 34-34z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22/%3E%3Ccircle cx=%22558%22 cy=%22372%22 r=%2224%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m514 462 65-68 52 52 32-34 57 50%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22600%22 y=%22562%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2236%22 font-weight=%22700%22 fill=%22%2364758b%22%3E%D9%84%D8%A7%20%D8%AA%D9%88%D8%AC%D8%AF%20%D8%B5%D9%88%D8%B1%D8%A9%3C/text%3E%3C/svg%3E';

function getDurableImageUrl(...urls: Array<string | undefined>) {
  return urls
    .filter((url): url is string => Boolean(url))
    .map((url) => url.startsWith('/uploads/listings/') ? `https://souqhamad.com${url}` : url)
    .find((url) => url.length > 0);
}

function getImages(listing: Listing): ListingGalleryImage[] {
  const images = (listing.images ?? [])
    .filter((image) => image.status === 'approved')
    .map((image) => {
      const originalUrl = getDurableImageUrl(image.originalUrl, image.displayUrl, image.thumbnailUrl);
      const displayUrl = getDurableImageUrl(image.displayUrl, image.originalUrl, image.thumbnailUrl);
      const thumbnailUrl = getDurableImageUrl(image.thumbnailUrl, image.displayUrl, image.originalUrl);
      if (!originalUrl || !displayUrl || !thumbnailUrl) return null;
      return { originalUrl, displayUrl, thumbnailUrl };
    })
    .filter((image): image is ListingGalleryImage => Boolean(image));
  return images.length ? images : [{
    originalUrl: missingListingImageDataUrl,
    displayUrl: missingListingImageDataUrl,
    thumbnailUrl: missingListingImageDataUrl,
  }];
}

function isSafePathSegment(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]+$/.test(value));
}

function getListingReturnHref(params: URLSearchParams) {
  const source = params.get('source');
  const conversationId = params.get('conversationId');
  const sellerId = params.get('sellerId');
  const sellerSource = params.get('sellerSource');
  const sourceListingId = params.get('sourceListingId');

  if (source === 'conversation' && isSafePathSegment(conversationId)) {
    return `/conversations/${encodeURIComponent(conversationId)}`;
  }
  if (source === 'seller' && isSafePathSegment(sellerId)) {
    const query = new URLSearchParams();
    if (sellerSource === 'admin-users' || sellerSource === 'follows') query.set('source', sellerSource);
    if (sellerSource === 'conversation' && isSafePathSegment(conversationId)) {
      query.set('source', sellerSource);
      query.set('conversationId', conversationId);
    }
    if (sellerSource === 'listing' && isSafePathSegment(sourceListingId)) {
      query.set('source', sellerSource);
      query.set('listingId', sourceListingId);
    }
    const suffix = query.toString() ? `?${query}` : '';
    return `/sellers/${encodeURIComponent(sellerId)}${suffix}`;
  }
  if (source === 'favorites') return '/favorites';
  if (source === 'account-listings') return '/account/listings';
  if (source === 'listing' && isSafePathSegment(sourceListingId)) {
    return `/listings/${encodeURIComponent(sourceListingId)}`;
  }
  return '/';
}

function getSellerProfileHref(sellerId: string, listingId: string) {
  return `/sellers/${encodeURIComponent(sellerId)}?source=listing&listingId=${encodeURIComponent(listingId)}`;
}

function getSimilarListingHref(listingId: string, sourceListingId: string) {
  return `/listings/${encodeURIComponent(listingId)}?source=listing&sourceListingId=${encodeURIComponent(sourceListingId)}`;
}

async function loadSimilarListings(listing: Listing, signal: AbortSignal) {
  async function load(city?: string) {
    const params = new URLSearchParams({ category: listing.category, limit: '48' });
    if (city) params.set('city', city);
    const response = await fetch(`/api/marketplace/listings?${params}`, {
      cache: 'no-store',
      credentials: 'include',
      signal,
    });
    if (!response.ok) return [] as SimilarListing[];
    const payload = await response.json() as { listings?: SimilarListing[] };
    return payload.listings ?? [];
  }

  const cityMatches = await load(listing.city);
  let candidates = cityMatches;
  if (candidates.filter((item) => item.id !== listing.id).length < 3) {
    const categoryMatches = await load();
    candidates = [...new Map([...cityMatches, ...categoryMatches].map((item) => [item.id, item])).values()];
  }
  return candidates.filter((item) => item.id !== listing.id && item.status === 'published').slice(0, 20);
}

export function MobileListingDetails({ listingId }: { listingId: string }) {
  const router = useRouter();
  const routeSearchParams = useSearchParams();
  const { isSessionLoading, session } = useAuthSession();
  const searchString = routeSearchParams.toString();
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [seller, setSeller] = useState<Seller | null>(null);
  const [similarListings, setSimilarListings] = useState<SimilarListing[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    setListing(null);
    setSeller(null);
    setSimilarListings([]);

    void (async () => {
      try {
        const response = await fetch(`/api/marketplace/listings/${encodeURIComponent(listingId)}`, {
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal,
        });
        if (response.status === 404) {
          setState('missing');
          return;
        }
        if (!response.ok) throw new Error('listing_request_failed');
        const payload = await response.json() as { listing?: Listing };
        if (!payload.listing || payload.listing.status !== 'published') {
          setState('missing');
          return;
        }

        setListing(payload.listing);
        void loadSimilarListings(payload.listing, controller.signal)
          .then((items) => {
            if (!controller.signal.aborted) setSimilarListings(items);
          })
          .catch(() => undefined);
        const sellerResponse = await fetch(`/api/marketplace/users/${encodeURIComponent(payload.listing.sellerId)}/profile`, {
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal,
        });
        if (sellerResponse.ok) {
          const sellerPayload = await sellerResponse.json() as { seller?: Seller };
          setSeller(sellerPayload.seller ?? null);
        }
        setState('ready');
      } catch (error) {
        if (!controller.signal.aborted) setState('error');
      }
    })();

    return () => controller.abort();
  }, [listingId]);

  const images = useMemo(() => listing ? getImages(listing) : [], [listing]);
  const attributes = useMemo(() => {
    const hiddenKeys = new Set([
      marketplaceCategoryOptionAttribute,
      marketplaceCarModelAttribute,
      'askingPrice',
      'city',
      'condition',
      'location',
      'price',
      'priceType',
      'saleTerms',
      'status',
    ]);
    return Object.entries(listing?.attributes ?? {}).filter(([key, value]) =>
      !hiddenKeys.has(key) && value !== null && value !== undefined && String(value).trim() !== '',
    );
  }, [listing]);

  const returnHref = getListingReturnHref(searchParams);

  if (state === 'loading') {
    return (
      <ListingDetailsFrame returnHref={returnHref}>
        <section className="marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[var(--marketplace-bottom-nav-space)] pt-3 sm:px-7">
          <div className="listing-details-content mx-auto grid max-w-3xl gap-3 pb-4 animate-pulse">
            <div className="listing-seller-summary rounded-md bg-slate-200 px-3 py-4 dark:bg-slate-800"><div className="h-12 w-48 rounded bg-slate-300 dark:bg-slate-700" /></div>
            <div className="grid gap-3 rounded-md border bg-white p-4 dark:border-white/10 dark:bg-card"><div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" /><div className="h-7 w-52 max-w-full rounded bg-slate-200 dark:bg-slate-700" /><div className="h-16 rounded bg-slate-100 dark:bg-slate-800" /><div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map((item) => <div key={item} className="h-11 rounded-md bg-slate-100 dark:bg-slate-800" />)}</div></div>
            <div className="aspect-[4/3] rounded-md bg-slate-200 dark:bg-slate-800" />
          </div>
        </section>
      </ListingDetailsFrame>
    );
  }

  if (state === 'missing' || state === 'error' || !listing) {
    return (
      <ListingDetailsFrame returnHref={returnHref}>
        <section className="marketplace-listings-scroll grid min-h-0 flex-1 place-items-center overflow-y-auto px-4 pb-[var(--marketplace-bottom-nav-space)] text-center sm:px-7">
          <div className="grid justify-items-center gap-3 rounded-md border bg-card p-6">
          <p className="font-bold">{state === 'missing' ? 'الإعلان غير متاح' : 'تعذر تحميل الإعلان'}</p>
            <Button variant="outline" onClick={() => router.push('/')}>العودة للسوق</Button>
          </div>
        </section>
      </ListingDetailsFrame>
    );
  }

  const categoryOption = getListingCategoryOption(listing as never)?.label;
  const carModel = getListingCarModel(listing as never)?.label;
  const categoryLabel = [formatMarketplaceCategory(listing.category), categoryOption, carModel].filter(Boolean).join(' · ');
  const saleTerms = formatSaleTerms(listing.price, listing.attributes ?? {});
  const isOwnListing = session.user?.id === listing.sellerId;
  const sellerProfileHref = seller ? getSellerProfileHref(listing.sellerId, listing.id) : returnHref;

  return (
    <ListingDetailsFrame returnHref={returnHref}>
        <section className="marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[var(--marketplace-bottom-nav-space)] pt-3 sm:px-7">
          <div className="listing-details-content mx-auto grid max-w-3xl gap-3 pb-4 [&_.text-muted-foreground]:text-foreground [&_.text-xs]:text-sm [&_.text-xs]:leading-6">
            <section className="listing-seller-summary px-1 py-2 sm:px-2">
              <div className="flex items-center gap-3">
                <MobileLink href={sellerProfileHref} className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-[#0f766e] text-lg font-bold text-white transition hover:opacity-85 active:scale-95">
                  <SellerAvatar alt={seller?.name ?? 'معلن سوق حمد'} picture={seller?.picture ?? undefined} />
                </MobileLink>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">المعلن</div>
                  <MobileLink href={sellerProfileHref} className="block truncate text-sm font-bold transition hover:text-blue-600">{seller?.name ?? 'معلن سوق حمد'}</MobileLink>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{seller?.publishedListingCount ?? 1} إعلان منشور</span>
                    <span className="inline-flex items-center gap-1"><Star className="size-3.5 text-blue-500" />{seller?.ratingCount ?? 0} تقييم</span>
                  </div>
                </div>
              </div>
            </section>
            <section className="px-1 py-3 sm:px-2">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">{categoryLabel}</span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"><BadgeCheck className="size-3.5" />مطابق لسياسة السوق</span>
                  </div>
                  <h2 className="break-words text-xl font-bold leading-8 text-emerald-600 dark:text-emerald-300 sm:text-2xl">{listing.title ?? 'إعلان بدون عنوان'}</h2>
                  <p className="mt-2 whitespace-pre-wrap break-words text-base leading-8 text-foreground">{listing.description ?? 'لا يوجد وصف مضاف لهذا الإعلان.'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 border-t border-slate-200/60 pt-3 text-xs dark:border-white/10 sm:grid-cols-3">
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="shrink-0 text-muted-foreground">السعر</span><strong className="min-w-0 truncate text-sm text-blue-700 dark:text-blue-200">{formatPrice(listing.price)}</strong></div>
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="shrink-0 text-muted-foreground">المدينة</span><strong className="flex min-w-0 items-center gap-1 truncate text-sm"><MapPin className="size-3.5 shrink-0 text-blue-600" />{listing.city ?? 'السعودية'}</strong></div>
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="shrink-0 text-muted-foreground">الحالة</span><strong className="min-w-0 truncate text-sm">{formatCondition(listing.condition)}</strong></div>
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="shrink-0 text-muted-foreground">طريقة البيع</span><strong className="min-w-0 truncate text-sm">{saleTerms}</strong></div>
                <div className="col-span-2 flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 rounded-md border border-border/60 bg-background/45 px-3 py-2 sm:col-span-2" data-listing-reference>
                  <span className="shrink-0 text-muted-foreground">رقم الإعلان</span>
                  <div className="flex min-w-0 basis-full items-start gap-2 sm:basis-auto sm:flex-1">
                    <strong className="min-w-0 flex-1 select-all break-all text-sm" dir="ltr" title={listing.id}>{listing.id}</strong>
                    <ListingIdCopyButton listingId={listing.id} />
                  </div>
                </div>
              </div>
            </section>
            <section className="px-1 py-3 sm:px-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold"><PackageCheck className="size-4 text-blue-600" />بيانات المنتج</div>
              {attributes.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {attributes.map(([key, value]) => (
                    <div key={key} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/60 bg-background/45 px-3 py-2 text-xs">
                      <span className="shrink-0 text-muted-foreground">{formatAttributeLabel(key)}</span>
                      <strong className="min-w-0 break-words text-sm">{formatAttributeValue(key, value)}</strong>
                    </div>
                  ))}
                </div>
              ) : <p className="pt-4 text-sm leading-7 text-muted-foreground">لا توجد بيانات إضافية.</p>}
            </section>
            <ListingImageGallery images={images} title={listing.title ?? 'صورة الإعلان'} />
            <section className="grid gap-2 px-1 py-2 sm:px-2">
              {!isSessionLoading && !isOwnListing && <ListingContactActions listingId={listing.id} sellerPhoneNumber={seller?.phoneNumber ?? undefined} />}
              <ListingShareButton className="h-10 w-full rounded-md" listingId={listing.id} title={listing.title ?? 'إعلان سوق حمد'} />
            </section>
            {!isSessionLoading && !isOwnListing && (
              <section className="px-1 py-3 sm:px-2">
                <div className="mb-3 text-sm font-bold">الإبلاغ والحفظ</div>
                <ListingSafetyActions listingId={listing.id} sellerId={listing.sellerId} isOwnListing={isOwnListing} />
              </section>
            )}
            <section className="px-1 py-3 sm:px-2">
              <div className="mb-2 text-sm font-bold">نشاط الإعلان</div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="flex items-center gap-1.5"><Eye className="size-3.5 text-blue-600" />المشاهدات</span><strong className="mt-1 block text-base leading-none text-foreground">{listing.views}</strong></div>
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="flex items-center gap-1.5"><MessageCircle className="size-3.5 text-blue-600" />الرسائل</span><strong className="mt-1 block text-base leading-none text-foreground">{listing.messageCount}</strong></div>
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-blue-600" />نُشر</span><strong className="mt-1 block truncate text-sm leading-none text-foreground">{listing.createdAt ? formatRelativeListingTime(listing.createdAt) : 'غير محدد'}</strong></div>
                <div className="rounded-md border border-border/60 bg-background/45 px-3 py-2"><span className="flex items-center gap-1.5"><CalendarDays className="size-3.5 text-blue-600" />آخر تحديث</span><strong className="mt-1 block truncate text-sm leading-none text-foreground">{listing.updatedAt ? formatDate(listing.updatedAt) : 'غير متاح'}</strong></div>
              </div>
            </section>
            {!isSessionLoading && !isOwnListing && <section className="px-1 py-3 sm:px-2"><SimilarListingFollowButton listingId={listing.id} /></section>}
            <SimilarListingsSection listings={similarListings} sourceListingId={listing.id} />
          </div>
        </section>
    </ListingDetailsFrame>
  );
}

function ListingDetailsFrame({ returnHref, children }: { returnHref: string; children: ReactNode }) {
  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="marketplace-panel mx-auto flex h-full min-h-0 max-w-4xl flex-col py-3">
        <header className="marketplace-home-controls mx-3 shrink-0 border-b border-slate-300/70 px-1 py-3 dark:border-white/10 sm:mx-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <MobileLink href={returnHref} aria-label="رجوع"><ArrowRight className="size-4" /></MobileLink>
            </Button>
            <div className="min-w-0"><h1 className="truncate text-base font-bold">تفاصيل الإعلان</h1><p className="truncate text-xs text-muted-foreground">سوق حمد</p></div>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

function SimilarListingsSection({ listings, sourceListingId }: { listings: SimilarListing[]; sourceListingId: string }) {
  if (!listings.length) return null;

  return (
    <section className="px-1 py-3 sm:px-2">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold"><PackageCheck className="size-4 text-blue-600" />إعلانات مشابهة</div>
      <div className="grid gap-2">
        {listings.map((listing) => {
          const image = listing.images.find((candidate) => candidate.status === 'approved' && candidate.isPrimary) ??
            listing.images.find((candidate) => candidate.status === 'approved');
          const imageUrl = image ? getDurableImageUrl(image.thumbnailUrl, image.displayUrl, image.originalUrl) : undefined;
          return (
            <MobileLink
              key={listing.id}
              className="marketplace-listing-card grid grid-cols-[5.5rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right transition hover:border-blue-300 hover:bg-blue-50/35 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10"
              href={getSimilarListingHref(listing.id, sourceListingId)}
              prefetch={false}
            >
              <div className="aspect-square overflow-hidden bg-slate-100 dark:bg-slate-900">
                {imageUrl ? (
                  <ListingCardImage
                    alt={listing.title ?? 'صورة الإعلان'}
                    fallback={<div className="grid h-full place-items-center"><PackageCheck className="size-6 text-slate-400" /></div>}
                    height={88}
                    sizes="88px"
                    src={imageUrl}
                    width={88}
                  />
                ) : <div className="grid h-full place-items-center"><PackageCheck className="size-6 text-slate-400" /></div>}
              </div>
              <div className="grid min-w-0 content-center gap-1 px-3 py-2">
                <div className="line-clamp-2 text-[13px] font-bold leading-5 text-emerald-700 dark:text-emerald-300">{listing.title ?? 'إعلان مشابه'}</div>
                <div className="truncate text-sm font-bold">{formatPrice(listing.price)}</div>
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{listing.city ?? 'السعودية'}</span>
                  <span className="truncate">{formatMarketplaceCategory(listing.category)}</span>
                </div>
              </div>
            </MobileLink>
          );
        })}
      </div>
    </section>
  );
}
