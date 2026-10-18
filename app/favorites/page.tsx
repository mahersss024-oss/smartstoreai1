'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Clock3, Heart, ImageIcon, MapPin } from 'lucide-react';

import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { ListingCardImage } from '@/components/listing-card-image';
import { ListingCardSkeleton } from '@/components/listing-card-skeleton';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAuthProviderVisibility } from '@/hooks/use-auth-provider-visibility';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import {
  readClientPageCache,
  writeClientPageCache,
} from '@/lib/client-page-cache';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';

type FavoriteListing = {
  id: string;
  title?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  category: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
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

type FavoritesCachePayload = {
  favorites: FavoriteRecord[];
  pagination?: PaginationMeta | null;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22675%22 viewBox=%220 0 900 675%22%3E%3Crect width=%22900%22 height=%22675%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M382 291h136a28 28 0 0 1 28 28v95a28 28 0 0 1-28 28H382a28 28 0 0 1-28-28v-95a28 28 0 0 1 28-28z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22/%3E%3Ccircle cx=%22417%22 cy=%22342%22 r=%2220%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m382 414 53-55 43 43 25-27 43 39%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22450%22 y=%22492%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2364758b%22%3E%D9%84%D8%A7%20%D8%AA%D9%88%D8%AC%D8%AF%20%D8%B5%D9%88%D8%B1%D8%A9%3C/text%3E%3C/svg%3E';

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

function getFavoritesCacheKey(userId: string) {
  return `smartstore:page-cache:v1:favorites:${userId}`;
}

export default function FavoritesPage() {
  const { isSessionLoading, session } = useAuthSession();
  const authProviders = useAuthProviderVisibility();
  const sessionUserId = session.user?.id;
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [favoritesPagination, setFavoritesPagination] =
    useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const trackedListingIds = useMemo(
    () => new Set(favorites.map((favorite) => favorite.listingId)),
    [favorites],
  );

  const refreshFavorites = useCallback(async (
    page = 1,
    options?: { showLoading?: boolean },
  ) => {
    const showLoading = options?.showLoading ?? true;

    if (showLoading) {
      setIsLoading(true);
    }

    try {
      if (!session.authenticated) {
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
        if (showLoading) {
          setFavorites([]);
          setFavoritesPagination(null);
        }
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

      if (page === 1 && sessionUserId) {
        writeClientPageCache<FavoritesCachePayload>(
          getFavoritesCacheKey(sessionUserId),
          {
            favorites: payload.favorites ?? [],
            pagination: payload.pagination ?? null,
          },
        );
      }
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [session.authenticated, sessionUserId]);

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshFavorites(1);
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshFavorites]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    if (isSessionLoading) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        if (session.authenticated) {
          const cachedPayload = sessionUserId
            ? readClientPageCache<FavoritesCachePayload>(
                getFavoritesCacheKey(sessionUserId),
              )
            : null;

          if (cachedPayload) {
            setFavorites(cachedPayload.favorites ?? []);
            setFavoritesPagination(cachedPayload.pagination ?? null);
            setIsLoading(false);
          }

          void refreshFavorites(1, { showLoading: !cachedPayload });
          return;
        }

        setFavorites([]);
        setFavoritesPagination(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isSessionLoading, refreshFavorites, session.authenticated, sessionUserId]);

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
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 px-4 py-5 sm:px-6">
        <header className="smartstore-page-header flex shrink-0 items-center justify-between gap-3 px-1">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">المفضلة</h1>
            </div>
          </div>
        </header>

        {(isSessionLoading || isLoading) && !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <Heart className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <Heart className="mx-auto size-12 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض المفضلة</h2>
              </div>
              {authProviders.google ? (
                <Button asChild className="justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                  <a href="/api/auth/google/start">
                    <GoogleMark className="size-5" />
                    دخول جوجل
                  </a>
                </Button>
              ) : null}
              {authProviders.apple ? (
                <Button asChild className="justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                  <a href="/api/auth/apple/start">
                    <AppleMark className="size-5" />
                    دخول آبل
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 py-3 sm:px-2">
            {isLoading && favorites.length === 0 ? (
              <div className="grid max-w-4xl gap-1.5">
                <ListingCardSkeleton count={6} />
              </div>
            ) : favorites.length === 0 ? (
              <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                <div className="grid max-w-sm gap-3">
                  <Heart className="mx-auto size-9 text-blue-600" />
                  <h3 className="text-base font-bold">لا توجد منتجات محفوظة</h3>
                </div>
              </div>
            ) : (
              <div className="marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain smartstore-fade-scroll pb-[var(--marketplace-bottom-nav-space)] pt-2">
                <div className="grid max-w-4xl gap-1.5">
                  {favorites.map((favorite) => (
                    <Link
                      key={favorite.id}
                      className="marketplace-listing-card grid w-full min-w-0 grid-cols-[6.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-sm transition hover:border-blue-300 hover:bg-blue-50/35 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10 sm:grid-cols-[7.25rem_minmax(0,1fr)] [contain-intrinsic-size:126px] [content-visibility:auto]"
                      href={`/listings/${favorite.listingId}?source=favorites`}
                      prefetch={false}
                    >
                      <div className="aspect-square min-h-[6.25rem] overflow-hidden bg-slate-100 dark:bg-slate-900 sm:min-h-[7.25rem]">
                        <ListingCardImage
                          alt={favorite.listing?.title ?? 'صورة الإعلان'}
                          fallback={
                            <div className="grid h-full w-full place-items-center text-slate-500 dark:text-slate-400">
                              <ImageIcon className="size-6" />
                            </div>
                          }
                          height={116}
                          sizes="(min-width: 640px) 116px, 100px"
                          src={getListingImage(favorite.listing)}
                          width={116}
                        />
                      </div>
                      <div className="grid min-w-0 content-between gap-1 px-2 py-1.5 sm:px-3 sm:py-2">
                        <h3 className="line-clamp-2 text-[13px] font-bold leading-5 text-emerald-600 dark:text-emerald-300 sm:text-sm">
                          {favorite.listing?.title ?? 'إعلان غير متاح'}
                        </h3>
                        <div className="text-[15px] font-black leading-6 text-slate-900 dark:text-white">
                          {formatPrice(favorite.listing?.price)}
                        </div>
                        <div className="flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground">
                          <span className="inline-flex min-w-0 items-center gap-1">
                            <Clock3 className="size-3.5 shrink-0" />
                            <span className="truncate">
                              {formatListingRelativeTime(
                                favorite.listing?.createdAt ??
                                  favorite.listing?.updatedAt ??
                                  favorite.createdAt,
                              )}
                            </span>
                          </span>
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{favorite.listing?.city ?? 'السعودية'}</span>
                        </div>
                      </div>
                      <div className="hidden">
                        <span className="font-bold text-blue-700">
                          {formatPrice(favorite.listing?.price)}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {isLoading && favorites.length > 0 && (
                    <ListingCardSkeleton count={3} />
                  )}
                </div>
                {favoritesPagination?.hasMore && (
                  <div>
                    <div
                      ref={favoritesLoadMoreRef}
                      aria-hidden="true"
                      className="h-24 w-full"
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
