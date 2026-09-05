'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Heart, MapPin, Store, User } from 'lucide-react';

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

function getListingImage(listing: FavoriteListing | null, index: number) {
  const image = listing?.images?.[0];
  const fallbacks = [
    'https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=900&q=80',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
  ];

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    fallbacks[index % fallbacks.length]
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
  const [isLoading, setIsLoading] = useState(true);

  const refreshFavorites = useCallback(async () => {
    setIsLoading(true);

    try {
      const [sessionResponse, favoritesResponse] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/marketplace/me/favorites'),
      ]);
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (!favoritesResponse.ok) {
        setFavorites([]);
        return;
      }

      const payload = (await favoritesResponse.json()) as {
        favorites?: FavoriteRecord[];
      };
      setFavorites(payload.favorites ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshFavorites();
  }, [refreshFavorites]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <img alt="SmartStore AI" className="size-10 object-cover" src="/smartstore-mark.png" />
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
            <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
              <Link href="/account">
                <User className="size-4" />
                حسابي
              </Link>
            </Button>
          </div>
        </header>

        {!session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <Heart className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض المفضلة</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  حفظ المنتجات مرتبط بحساب Google الخاص بالعميل.
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
          <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold">
              <Heart className="size-4 text-blue-600" />
              إعلانات محفوظة
            </div>

            {isLoading ? (
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
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.map((favorite, index) => (
                  <Link
                    key={favorite.id}
                    className="overflow-hidden rounded-md border transition hover:border-blue-400 hover:shadow-md"
                    href={`/listings/${favorite.listingId}`}
                  >
                    <img
                      alt={favorite.listing?.title ?? 'صورة الإعلان'}
                      className="aspect-[4/3] w-full object-cover"
                      src={getListingImage(favorite.listing, index)}
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
            )}
          </section>
        )}
      </div>
    </main>
  );
}
