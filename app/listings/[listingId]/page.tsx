/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Eye,
  ImageIcon,
  MapPin,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Star,
  Store,
  UserRound,
} from 'lucide-react';

import {
  getListing,
  getPublicSellerProfile,
} from '@/agent/marketplace/repository';
import type { ListingCondition } from '@/agent/marketplace/types';
import { Button } from '@ui/button';
import { ListingShareButton } from '@/components/listing-share-button';
import { ListingContactActions } from './contact-actions';
import {
  ListingImageGallery,
  type ListingGalleryImage,
} from './listing-image-gallery';
import { ListingSafetyActions } from './listing-safety-actions';

type PageProps = {
  params: Promise<{
    listingId: string;
  }>;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22750%22 viewBox=%220 0 1200 750%22%3E%3Crect width=%221200%22 height=%22750%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M514 308h172a34 34 0 0 1 34 34v120a34 34 0 0 1-34 34H514a34 34 0 0 1-34-34V342a34 34 0 0 1 34-34z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22/%3E%3Ccircle cx=%22558%22 cy=%22372%22 r=%2224%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m514 462 65-68 52 52 32-34 57 50%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22600%22 y=%22562%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2236%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';

function getDurableImageUrl(...urls: Array<string | undefined>) {
  return urls.find((url) => {
    return (
      typeof url === 'string' &&
      url.length > 0 &&
      !url.startsWith('/uploads/listings/')
    );
  });
}

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

function formatCategory(category: string) {
  const labels: Record<string, string> = {
    mobile_phones: 'الجوالات',
    cars: 'السيارات',
    auto_parts: 'قطع الغيار',
    computers: 'الأجهزة',
    real_estate: 'العقارات',
    furniture: 'الأثاث',
    fashion: 'الموضة',
    home_garden: 'المنزل والحديقة',
    sports: 'الرياضة',
    gaming_hobbies: 'الألعاب والهوايات',
    books_education: 'الكتب والتعليم',
    kids: 'مستلزمات الأطفال',
    women_supplies: 'مستلزمات نسائية',
    men_supplies: 'مستلزمات رجالية',
    tools_equipment: 'معدات وأدوات',
    watches_accessories: 'ساعات وإكسسوارات',
    beauty: 'العناية والتجميل',
    other: 'أخرى',
  };

  return labels[category] ?? category;
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

function formatSaleTerms(
  price: number | 'bid' | 'negotiable' | undefined,
  attributes: Record<string, unknown>,
) {
  const saleTerms = String(attributes.saleTerms ?? '').toLowerCase();

  if (price === 'bid' || saleTerms === 'auction') {
    return 'على السوم';
  }

  if (price === 'negotiable' || saleTerms === 'negotiable') {
    return 'قابل للتفاوض';
  }

  if (saleTerms === 'open_to_offers') {
    return 'يقبل العروض';
  }

  if (typeof price === 'number' || saleTerms === 'fixed') {
    return 'سعر ثابت';
  }

  return 'غير محددة';
}

function formatAttributeLabel(key: string) {
  const labels: Record<string, string> = {
    saleTerms: 'طريقة البيع',
    usageNotes: 'الاستخدام',
    defects: 'الملاحظات',
    color: 'اللون',
    material: 'الخامة',
    brand: 'العلامة',
  };

  return labels[key] ?? key;
}

function formatAttributeValue(key: string, value: unknown) {
  if (key === 'saleTerms') {
    return formatSaleTerms(undefined, { saleTerms: value });
  }

  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean).join('، ');
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default async function ListingDetailsPage({ params }: PageProps) {
  const { listingId } = await params;
  const listing = await getListing(listingId);

  if (!listing || listing.status !== 'published') {
    notFound();
  }

  const sellerProfile = await getPublicSellerProfile(listing.sellerId);

  const approvedImages = listing.images.filter(
    (image) => image.status === 'approved',
  );
  const durableApprovedImages = approvedImages
    .map((image): ListingGalleryImage | null => {
      const originalUrl = getDurableImageUrl(
        image.originalUrl,
        image.displayUrl,
        image.thumbnailUrl,
      );
      const displayUrl = getDurableImageUrl(
        image.displayUrl,
        image.originalUrl,
        image.thumbnailUrl,
      );
      const thumbnailUrl = getDurableImageUrl(
        image.thumbnailUrl,
        image.displayUrl,
        image.originalUrl,
      );

      if (!originalUrl || !displayUrl || !thumbnailUrl) {
        return null;
      }

      return {
        originalUrl,
        displayUrl,
        thumbnailUrl,
      };
    })
    .filter((image): image is ListingGalleryImage => Boolean(image));
  const images = durableApprovedImages.length
    ? durableApprovedImages
    : [
        {
          originalUrl: missingListingImageDataUrl,
          displayUrl: missingListingImageDataUrl,
          thumbnailUrl: missingListingImageDataUrl,
        },
      ];
  const attributes = Object.entries(listing.attributes).filter(([, value]) => {
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
  const saleTerms = formatSaleTerms(listing.price, listing.attributes);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.jpeg" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">تفاصيل الإعلان</h1>
              <p className="truncate text-xs text-muted-foreground">سوق حمد</p>
            </div>
          </div>
          <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
            <Link href="/">
              <Store className="size-4" />
              العودة للسوق
            </Link>
          </Button>
        </header>

        <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,38rem)_18rem]">
          <div className="grid min-w-0 gap-4">
            <ListingImageGallery
              images={images}
              title={listing.title ?? 'صورة الإعلان'}
            />

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      {formatCategory(listing.category)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                      <BadgeCheck className="size-3.5" />
                      مطابق لسياسة السوق
                    </span>
                  </div>
                  <h2 className="text-xl font-bold leading-tight sm:text-2xl">{listing.title ?? 'إعلان بدون عنوان'}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{listing.description ?? 'لا يوجد وصف مضاف لهذا الإعلان.'}</p>
                </div>
              </div>

              <div className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">السعر</div>
                  <div className="mt-1 text-lg font-bold text-blue-700">{formatPrice(listing.price)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">المدينة</div>
                  <div className="mt-1 flex items-center gap-1 text-sm font-bold">
                    <MapPin className="size-4 text-blue-600" />
                    {listing.city ?? 'السعودية'}
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">الحالة</div>
                  <div className="mt-1 text-sm font-bold">{formatCondition(listing.condition)}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">طريقة البيع</div>
                  <div className="mt-1 text-sm font-bold">{saleTerms}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">رقم الإعلان</div>
                  <div className="mt-1 truncate text-sm font-bold">{listing.id}</div>
                </div>
              </div>
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="flex items-center gap-3 rounded-md border bg-[#f8fafc] p-3 dark:bg-[#101827]">
                <Link
                  href={`/sellers/${listing.sellerId}`}
                  className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-[#0f766e] text-lg font-bold text-white transition hover:opacity-85 active:scale-95"
                >
                  {sellerProfile?.picture ? (
                    <img
                      alt={sellerProfile.name}
                      className="size-full object-cover"
                      src={sellerProfile.picture}
                    />
                  ) : (
                    <UserRound className="size-6" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">
                    المعلن
                  </div>
                  <Link
                    href={`/sellers/${listing.sellerId}`}
                    className="block truncate text-sm font-bold transition hover:text-blue-600"
                  >
                    {sellerProfile?.name ?? 'معلن سوق حمد'}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {sellerProfile?.publishedListingCount ?? 1} إعلان منشور
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 text-blue-500" />
                      {sellerProfile?.ratingCount ?? 0} تقييم
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                <PackageCheck className="size-4 text-blue-600" />
                بيانات المنتج
              </div>
              {attributes.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {attributes.map(([key, value]) => (
                    <div key={key} className="rounded-md border p-3">
                      <div className="text-xs text-muted-foreground">{formatAttributeLabel(key)}</div>
                      <div className="mt-1 break-words text-sm font-semibold">
                        {formatAttributeValue(key, value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-4 text-sm leading-7 text-muted-foreground">
                  لا توجد بيانات إضافية محفوظة لهذا الإعلان حتى الآن.
                </p>
              )}
            </section>
          </div>

          <aside className="grid h-fit gap-4">
            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-4">
                <div className="text-xs text-muted-foreground">السعر المطلوب</div>
                <div className="mt-1 text-xl font-bold text-blue-700">{formatPrice(listing.price)}</div>
              </div>
              <ListingShareButton
                className="mb-3 h-11 w-full rounded-md"
                listingId={listing.id}
                title={listing.title ?? 'إعلان سوق حمد'}
              />
              <ListingContactActions listingId={listing.id} />
              <ListingSafetyActions listingId={listing.id} sellerId={listing.sellerId} />
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                <ShieldCheck className="size-4 text-blue-600" />
                الثقة والسلامة
              </div>
              <div className="grid gap-3 text-sm leading-7 text-muted-foreground">
                <div className="flex items-center gap-2">
                  <BadgeCheck className="size-4 text-emerald-600" />
                  الإعلان منشور بعد فحص السياسة.
                </div>
                <div className="flex items-center gap-2">
                  <ImageIcon className="size-4 text-blue-600" />
                  الصور الأصلية تحفظ مع نسخ عرض مصغرة.
                </div>
                <div className="flex items-center gap-2">
                  <MessageCircle className="size-4 text-blue-600" />
                  التواصل يتم داخل المنصة.
                </div>
              </div>
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-3 text-sm font-bold">نشاط الإعلان</div>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="flex items-center gap-2">
                    <Eye className="size-4 text-blue-600" />
                    المشاهدات
                  </span>
                  <strong className="text-foreground">{listing.views}</strong>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="flex items-center gap-2">
                    <MessageCircle className="size-4 text-blue-600" />
                    الرسائل
                  </span>
                  <strong className="text-foreground">{listing.messageCount}</strong>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border p-2">
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-4 text-blue-600" />
                    آخر تحديث
                  </span>
                  <strong className="text-foreground">{formatDate(listing.updatedAt)}</strong>
                </div>
              </div>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}
