'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Heart,
  Home,
  LogOut,
  Megaphone,
  MessageCircle,
  Pause,
  Percent,
  ShieldCheck,
  Store,
  Trash2,
  User,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
};

type AuthSessionPayload = {
  authenticated: boolean;
  user: AuthUser | null;
};

type ApiListingRecord = {
  id: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  status?: string;
  views?: number;
  messageCount?: number;
  favoriteCount?: number;
  images?: Array<{
    displayUrl?: string;
    originalUrl?: string;
    thumbnailUrl?: string;
    status?: string;
  }>;
};

type ListingCard = {
  id: string;
  title: string;
  price: string;
  city: string;
  image: string;
  category: string;
  status: string;
  stats: string;
  description?: string;
};

function getFallbackImage(category: string, index = 0) {
  const images = {
    mobile_phones:
      'https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?auto=format&fit=crop&w=900&q=80',
    cars:
      'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=900&q=80',
    computers:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
    furniture:
      'https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=900&q=80',
    real_estate:
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=900&q=80',
    auto_parts:
      'https://images.unsplash.com/photo-1632823469850-1b7b1e8b7e1e?auto=format&fit=crop&w=900&q=80',
    fashion:
      'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=900&q=80',
    home_garden:
      'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
    sports:
      'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80',
    gaming_hobbies:
      'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=900&q=80',
    books_education:
      'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=900&q=80',
    kids:
      'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80',
    tools_equipment:
      'https://images.unsplash.com/photo-1581147036324-c1c88bb0b379?auto=format&fit=crop&w=900&q=80',
    watches_accessories:
      'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=900&q=80',
    beauty:
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80',
  } satisfies Record<string, string>;
  const values = Object.values(images);

  return images[category as keyof typeof images] ?? values[index % values.length];
}

function formatListingPrice(price: ApiListingRecord['price']) {
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

function formatListingStatus(status: string | undefined) {
  const labels: Record<string, string> = {
    draft: 'مسودة',
    pending: 'مراجعة',
    published: 'منشور',
    paused: 'موقوف',
    sold: 'مباع',
    rejected: 'مرفوض',
    deleted: 'محذوف',
  };

  return status ? labels[status] ?? status : 'مسودة';
}

function formatCategory(category: string) {
  const labels: Record<string, string> = {
    mobile_phones: 'الجوالات',
    cars: 'السيارات',
    computers: 'الأجهزة',
    furniture: 'الأثاث',
    real_estate: 'العقارات',
    auto_parts: 'قطع الغيار',
    fashion: 'الموضة',
    home_garden: 'المنزل والحديقة',
    sports: 'الرياضة',
    gaming_hobbies: 'الألعاب والهوايات',
    books_education: 'الكتب والتعليم',
    kids: 'مستلزمات الأطفال',
    tools_equipment: 'معدات وأدوات',
    watches_accessories: 'ساعات وإكسسوارات',
    beauty: 'العناية والتجميل',
    other: 'أخرى',
  };

  return labels[category] ?? category;
}

function getDurableImageUrl(...urls: Array<string | undefined>) {
  return urls.find((url) => {
    return (
      typeof url === 'string' &&
      url.length > 0 &&
      !url.startsWith('/uploads/listings/')
    );
  });
}

function listingRecordToCard(listing: ApiListingRecord, index: number): ListingCard {
  const primaryImage =
    listing.images?.find((image) => image.status === 'approved') ??
    listing.images?.[0];

  return {
    id: listing.id,
    title: listing.title ?? 'إعلان بدون عنوان',
    price: formatListingPrice(listing.price),
    city: listing.city ?? 'السعودية',
    category: formatCategory(listing.category),
    description: listing.description,
    image:
      getDurableImageUrl(
        primaryImage?.thumbnailUrl,
        primaryImage?.displayUrl,
        primaryImage?.originalUrl,
      ) ??
      getFallbackImage(listing.category, index),
    status: formatListingStatus(listing.status),
    stats: `${listing.views ?? 0} مشاهدة · ${listing.messageCount ?? 0} رسائل · ${
      listing.favoriteCount ?? 0
    } حفظ`,
  };
}

export default function AccountPage() {
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [listings, setListings] = useState<ListingCard[]>([]);

  const stats = useMemo(() => {
    return {
      published: listings.filter((listing) => listing.status === 'منشور').length,
      drafts: listings.filter((listing) => listing.status === 'مسودة').length,
      paused: listings.filter((listing) => listing.status === 'موقوف').length,
      sold: listings.filter((listing) => listing.status === 'مباع').length,
    };
  }, [listings]);

  const refreshSession = useCallback(() => {
    return fetch('/api/auth/session')
      .then((response) => response.json() as Promise<AuthSessionPayload>)
      .then(setSession)
      .catch(() => setSession({ authenticated: false, user: null }));
  }, []);

  const refreshListings = useCallback(() => {
    return fetch('/api/marketplace/me/listings')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ listings?: ApiListingRecord[] }>)
          : Promise.resolve({ listings: [] }),
      )
      .then((payload) => {
        setListings(payload.listings?.map(listingRecordToCard) ?? []);
      })
      .catch(() => setListings([]));
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (session.authenticated) {
      void refreshListings();
    }
  }, [refreshListings, session.authenticated]);

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      setListings([]);
      setSession({ authenticated: false, user: null });
    });
  }, []);

  const controlListing = useCallback(
    (listing: ListingCard, action: 'publish' | 'pause' | 'mark_sold' | 'delete') => {
      const labels = {
        publish: 'نشر الإعلان',
        pause: 'إيقاف الإعلان',
        mark_sold: 'اعتبار الإعلان مباعًا',
        delete: 'حذف الإعلان',
      };

      if (!window.confirm(`هل تؤكد ${labels[action]}: ${listing.title}؟`)) {
        return;
      }

      void fetch(`/api/marketplace/listings/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }).then(() => {
        void refreshListings();
      });
    },
    [refreshListings],
  );

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex items-center gap-3">
            <Link className="grid size-9 place-items-center rounded-md border bg-white dark:bg-background" href="/">
              <ArrowRight className="size-4" />
            </Link>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
            </div>
            <div>
              <h1 className="text-base font-bold">حسابي في SmartStore AI</h1>
              <p className="text-xs text-muted-foreground">بيانات العميل وإعلاناته الخاصة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle language="ar" />
            {session.authenticated && (
              <Button variant="outline" size="sm" className="rounded-md" onClick={handleLogout}>
                <LogOut className="size-4" />
                خروج
              </Button>
            )}
          </div>
        </header>

        {!session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض حسابك</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  هذه الصفحة مخصصة لبيانات العميل وإعلاناته، وتظهر بعد تسجيل Google.
                </p>
              </div>
              <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                <a href="/api/auth/google/start">
                  <User className="size-4" />
                  دخول Google
                </a>
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-4 rounded-md border bg-white p-4 shadow-sm dark:bg-card lg:grid-cols-[1fr_18rem]">
              <div className="flex min-w-0 items-center gap-4">
                {session.user?.picture ? (
                  <img alt="" className="size-16 rounded-md object-cover" src={session.user.picture} />
                ) : (
                  <div className="grid size-16 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                    <User className="size-8" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-xl font-bold">{session.user?.name ?? 'عميل SmartStore'}</h2>
                    <BadgeCheck className="size-5 shrink-0 text-blue-600" />
                  </div>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{session.user?.email}</p>
                  <p className="mt-2 text-xs leading-6 text-muted-foreground">
                    من هنا يدير العميل إعلاناته، حالاتها، وبيانات الحساب المرتبطة بالتسجيل.
                  </p>
                </div>
              </div>
              <div className="grid gap-2">
                <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                  <Link href="/">
                    <MessageCircle className="size-4" />
                    إنشاء إعلان بالمحادثة
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-md">
                  <Link href="/">
                    <Home className="size-4" />
                    العودة للسوق
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-md">
                  <Link href="/conversations">
                    <MessageCircle className="size-4" />
                    محادثاتي
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-md">
                  <Link href="/favorites">
                    <Heart className="size-4" />
                    المفضلة
                  </Link>
                </Button>
                <Button asChild variant="outline" className="rounded-md">
                  <Link href="/commissions">
                    <Percent className="size-4" />
                    العمولات
                  </Link>
                </Button>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-md border bg-white p-3 text-center shadow-sm dark:bg-card">
                <div className="text-2xl font-bold">{stats.published}</div>
                <div className="text-xs text-muted-foreground">منشور</div>
              </div>
              <div className="rounded-md border bg-white p-3 text-center shadow-sm dark:bg-card">
                <div className="text-2xl font-bold">{stats.drafts}</div>
                <div className="text-xs text-muted-foreground">مسودة</div>
              </div>
              <div className="rounded-md border bg-white p-3 text-center shadow-sm dark:bg-card">
                <div className="text-2xl font-bold">{stats.paused}</div>
                <div className="text-xs text-muted-foreground">موقوف</div>
              </div>
              <div className="rounded-md border bg-white p-3 text-center shadow-sm dark:bg-card">
                <div className="text-2xl font-bold">{stats.sold}</div>
                <div className="text-xs text-muted-foreground">مباع</div>
              </div>
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                    <Store className="size-4" />
                    إعلاناتي
                  </div>
                  <h2 className="mt-1 text-lg font-bold">قائمة إعلانات العميل</h2>
                </div>
                <Button asChild variant="outline" className="rounded-md">
                  <Link href="/">
                    <MessageCircle className="size-4" />
                    إضافة إعلان عبر الشات
                  </Link>
                </Button>
              </div>

              {listings.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                  <div className="grid max-w-sm gap-3">
                    <Megaphone className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد إعلانات بعد</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      ابدأ من مساعد السوق، وسيجمع بيانات المنتج ويصنفه ثم ينشئ الإعلان.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {listings.map((listing) => (
                    <article key={listing.id} className="grid min-w-0 overflow-hidden rounded-md border bg-white shadow-sm dark:bg-background">
                      <img alt={listing.title} className="aspect-[4/3] w-full object-cover" src={listing.image} />
                      <div className="min-w-0">
                        <div className="grid gap-2 p-3">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <h3 className="truncate text-sm font-bold">{listing.title}</h3>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                            {listing.status}
                          </span>
                          </div>
                          <p className="line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{listing.description}</p>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate font-semibold text-slate-950 dark:text-card-foreground">{listing.price}</span>
                            <span className="truncate">{listing.city}</span>
                            <span className="truncate">{listing.category}</span>
                            <span className="truncate">{listing.stats}</span>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 border-t p-2">
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => controlListing(listing, 'publish')}>
                          <Megaphone className="size-3.5" />
                          نشر
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => controlListing(listing, 'pause')}>
                          <Pause className="size-3.5" />
                          إيقاف
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => controlListing(listing, 'mark_sold')}>
                          <CheckCircle2 className="size-3.5" />
                          بيع
                        </Button>
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => controlListing(listing, 'delete')}>
                          <Trash2 className="size-3.5" />
                          حذف
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
