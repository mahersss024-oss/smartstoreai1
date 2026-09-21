'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Heart, MapPin, Store, User } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
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

type FavoriteListing = {
  id: string;
  title?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  category: string;
  description?: string;
  images?: Array<{
    displayUrl?: string;
    originalUrl?: string;
    thumbnailUrl?: string;
  }>;
};

type FavoriteRecord = {
  id: string;
  listingId: string;
  createdAt: string;
  listing: FavoriteListing | null;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22675%22 viewBox=%220 0 900 675%22%3E%3Crect width=%22900%22 height=%22675%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M382 291h136a28 28 0 0 1 28 28v95a28 28 0 0 1-28 28H382a28 28 0 0 1-28-28v-95a28 28 0 0 1 28-28z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22/%3E%3Ccircle cx=%22417%22 cy=%22342%22 r=%2220%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m382 414 53-55 43 43 25-27 43 39%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22450%22 y=%22492%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';

function getListingImage(listing: FavoriteListing | null) {
  const image = listing?.images?.[0];

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    missingListingImageDataUrl
  );
}

function formatPrice(price: FavoriteListing['price']) {
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

export default function FavoritesPage() {
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [favoritesPagination, setFavoritesPagination] =
    useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const trackedListingIds = useMemo(
    () => new Set(favorites.map((favorite) => favorite.listingId)),
    [favorites],
  );

  const refreshFavorites = useCallback(async (page = 1) => {
    setIsLoading(true);

    try {
      const sessionResponse = await fetch('/api/auth/session', {
        cache: 'no-store',
      });
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (!nextSession.authenticated) {
        setFavorites([]);
        setFavoritesPagination(null);
        return;
      }

      const favoritesResponse = await fetch(
        `/api/marketplace/me/favorites?page=${page}&limit=24`,
        {
          cache: 'no-store',
        },
      );

      if (!favoritesResponse.ok) {
        setFavorites([]);
        setFavoritesPagination(null);
        return;
      }

      const payload = (await favoritesResponse.json()) as {
        favorites?: FavoriteRecord[];
        pagination?: PaginationMeta;
      };
      setFavorites((currentFavorites) =>
        page === 1
          ? (payload.favorites ?? [])
          : [...currentFavorites, ...(payload.favorites ?? [])],
      );
      setFavoritesPagination(payload.pagination ?? null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshFavorites();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshFavorites]);

  useSmartstoreRealtime({
    enabled: session.authenticated,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_updated',
      'ad_status_changed',
      'ad_deleted',
      'maintenance_cleanup',
    ],
    onEvent: (event) => {
      if (event.type === 'maintenance_cleanup') {
        void refreshFavorites(1);
        return;
      }

      if ('listingId' in event.payload && trackedListingIds.has(event.payload.listingId)) {
        void refreshFavorites(1);
      }
    },
    onResync: ({ reason }) => {
      if (reason === 'event' || !session.authenticated) {
        return;
      }

      return refreshFavorites(1);
    },
  });

  const favoritesLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(favoritesPagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void refreshFavorites(favoritesPagination?.nextPage ?? 1);
    },
  });

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="سوق حمد" className="size-10 object-cover" src="/smartstore-mark.png" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">المفضلة</h1>
              <p className="truncate text-xs text-muted-foreground">
                المنتجات التي حفظها العميل
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle language="ar" />
            <Button asChild className="hidden rounded-md bg-blue-600 hover:bg-blue-700 sm:inline-flex">
              <Link href="/account">
                <User className="size-4" />
                حسابي
              </Link>
            </Button>
          </div>
        </header>

        {isLoading && !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <Heart className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  نتحقق من جلسة الدخول قبل عرض المفضلة.
                </p>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <Heart className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض المفضلة</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  حفظ المنتجات مرتبط بحساب العميل المسجل في المنصة.
                </p>
              </div>
              <Button asChild className="justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                <a href="/api/auth/google/start">
                  <GoogleMark className="size-5" />
                  دخول Google
                </a>
              </Button>
              <Button asChild className="justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                <a href="/api/auth/apple/start">
                  <AppleMark className="size-5" />
                  دخول Apple
                </a>
              </Button>
            </div>
          </section>
        ) : (
          <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold">
              <Heart className="size-4 text-blue-600" />
              إعلانات محفوظة
            </div>

            {isLoading && favorites.length === 0 ? (
              <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                جار تحميل المفضلة...
              </div>
            ) : favorites.length === 0 ? (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                <div className="grid max-w-sm gap-3">
                  <Heart className="mx-auto size-9 text-blue-600" />
                  <h3 className="text-base font-bold">لا توجد منتجات محفوظة</h3>
                  <p className="text-sm leading-7 text-muted-foreground">
                    اضغط على القلب في أي بطاقة إعلان لحفظها هنا.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {favorites.map((favorite) => (
                    <Link
                    key={favorite.id}
                    className="overflow-hidden rounded-md border transition hover:border-blue-400 hover:shadow-md"
                    href={`/listings/${favorite.listingId}`}
                  >
                    <img
                      alt={favorite.listing?.title ?? 'صورة الإعلان'}
                      className="aspect-[4/3] w-full object-cover"
                      src={getListingImage(favorite.listing)}
                    />
                    <div className="grid gap-2 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        <Store className="size-4" />
                        إعلان محفوظ
                      </div>
                      <h3 className="line-clamp-1 text-base font-bold">
                        {favorite.listing?.title ?? 'إعلان غير متاح'}
                      </h3>
                      <div className="text-lg font-bold text-blue-700">
                        {formatPrice(favorite.listing?.price)}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3.5" />
                        {favorite.listing?.city ?? 'السعودية'}
                      </div>
                    </div>
                    </Link>
                  ))}
                </div>
                <div ref={favoritesLoadMoreRef} className="h-px" />
                {favoritesPagination?.hasMore && (
                  <Button
                    variant="outline"
                    className="mx-auto rounded-md"
                    disabled={isLoading}
                    onClick={() =>
                      void refreshFavorites(favoritesPagination.nextPage ?? 1)
                    }
                  >
                    {isLoading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
                  </Button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
