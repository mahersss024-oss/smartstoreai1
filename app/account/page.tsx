'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  Heart,
  Home,
  ImageIcon,
  LogOut,
  Megaphone,
  MessageCircle,
  Pause,
  Pencil,
  Percent,
  Save,
  ShieldCheck,
  Star,
  Store,
  Trash2,
  Upload,
  User,
  X,
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
  condition?: 'new' | 'used' | 'like_new' | 'damaged';
  status?: string;
  views?: number;
  messageCount?: number;
  favoriteCount?: number;
  images?: Array<{
    id?: string;
    displayUrl?: string;
    originalUrl?: string;
    thumbnailUrl?: string;
    isPrimary?: boolean;
    status?: string;
  }>;
};

type ListingImageCard = {
  id: string;
  url: string | null;
  isPrimary: boolean;
  status?: string;
};

type ListingCard = {
  id: string;
  title: string;
  price: string;
  rawPrice?: number | 'bid' | 'negotiable';
  city: string;
  image: string | null;
  category: string;
  rawCategory: string;
  condition?: 'new' | 'used' | 'like_new' | 'damaged';
  status: string;
  rawStatus?: string;
  stats: string;
  description?: string;
  images: ListingImageCard[];
};

type ListingEditForm = {
  title: string;
  description: string;
  priceMode: 'number' | 'bid' | 'negotiable';
  price: string;
  city: string;
  category: string;
  condition: '' | 'new' | 'used' | 'like_new' | 'damaged';
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

const listingCategoryOptions = [
  'cars',
  'auto_parts',
  'mobile_phones',
  'computers',
  'real_estate',
  'furniture',
  'fashion',
  'home_garden',
  'sports',
  'gaming_hobbies',
  'books_education',
  'kids',
  'tools_equipment',
  'watches_accessories',
  'beauty',
  'other',
];

const listingConditionOptions = [
  { value: 'new', label: 'جديد' },
  { value: 'like_new', label: 'شبه جديد' },
  { value: 'used', label: 'مستخدم' },
  { value: 'damaged', label: 'يحتاج إصلاح' },
] as const;

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

function listingRecordToCard(listing: ApiListingRecord): ListingCard {
  const images =
    listing.images
      ?.filter(
        (
          image,
        ): image is NonNullable<ApiListingRecord['images']>[number] & {
          id: string;
        } => typeof image.id === 'string' && Boolean(image.id),
      )
      .map((image) => ({
        id: image.id,
        url:
          getDurableImageUrl(
            image.thumbnailUrl,
            image.displayUrl,
            image.originalUrl,
          ) ?? null,
        isPrimary: Boolean(image.isPrimary),
        status: image.status,
      })) ?? [];
  const primaryImage =
    listing.images?.find(
      (image) => image.isPrimary && image.status === 'approved',
    ) ??
    listing.images?.find((image) => image.status === 'approved') ??
    listing.images?.[0];

  return {
    id: listing.id,
    title: listing.title ?? 'إعلان بدون عنوان',
    price: formatListingPrice(listing.price),
    rawPrice: listing.price,
    city: listing.city ?? 'السعودية',
    category: formatCategory(listing.category),
    rawCategory: listing.category,
    condition: listing.condition,
    description: listing.description,
    image:
      getDurableImageUrl(
        primaryImage?.thumbnailUrl,
        primaryImage?.displayUrl,
        primaryImage?.originalUrl,
      ) ?? null,
    status: formatListingStatus(listing.status),
    rawStatus: listing.status,
    images,
    stats: `${listing.views ?? 0} مشاهدة · ${listing.messageCount ?? 0} رسائل · ${
      listing.favoriteCount ?? 0
    } حفظ`,
  };
}

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [listingsPagination, setListingsPagination] =
    useState<PaginationMeta | null>(null);
  const [isListingsLoading, setIsListingsLoading] = useState(false);
  const [uploadingListingId, setUploadingListingId] = useState<string | null>(
    null,
  );
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [savingListingId, setSavingListingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ListingEditForm>({
    title: '',
    description: '',
    priceMode: 'number',
    price: '',
    city: '',
    category: 'other',
    condition: '',
  });
  const [updatingImageId, setUpdatingImageId] = useState<string | null>(null);

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

  const refreshListings = useCallback(async (page = 1) => {
    await Promise.resolve();
    setIsListingsLoading(true);

    try {
      const response = await fetch(
        `/api/marketplace/me/listings?page=${page}&limit=24`,
      );
      const payload: {
        listings?: ApiListingRecord[];
        pagination?: PaginationMeta | null;
      } = response.ok ? await response.json() : { listings: [] };
      const nextListings = payload.listings?.map(listingRecordToCard) ?? [];

      setListings((currentListings) =>
        page === 1 ? nextListings : [...currentListings, ...nextListings],
      );
      setListingsPagination(payload.pagination ?? null);
    } catch {
      if (page === 1) {
        setListings([]);
      }
    } finally {
      setIsListingsLoading(false);
    }
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
      setListingsPagination(null);
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
        void refreshListings(1);
      });
    },
    [refreshListings],
  );

  const startEditingListing = useCallback((listing: ListingCard) => {
    setEditingListingId(listing.id);
    setEditForm({
      title: listing.title,
      description: listing.description ?? '',
      priceMode:
        listing.rawPrice === 'bid' || listing.rawPrice === 'negotiable'
          ? listing.rawPrice
          : 'number',
      price: typeof listing.rawPrice === 'number' ? String(listing.rawPrice) : '',
      city: listing.city,
      category: listing.rawCategory,
      condition: listing.condition ?? '',
    });
  }, []);

  const cancelEditingListing = useCallback(() => {
    setEditingListingId(null);
    setSavingListingId(null);
  }, []);

  const saveListingEdits = useCallback(
    async (listing: ListingCard) => {
      setSavingListingId(listing.id);

      try {
        const payload: {
          title: string;
          description: string;
          price?: number | 'bid' | 'negotiable';
          city: string;
          category: string;
          condition?: 'new' | 'used' | 'like_new' | 'damaged';
        } = {
          title: editForm.title.trim(),
          description: editForm.description.trim(),
          city: editForm.city.trim(),
          category: editForm.category,
        };

        if (editForm.condition) {
          payload.condition = editForm.condition;
        }

        if (editForm.priceMode === 'number') {
          const numericPrice = Number(editForm.price);

          if (Number.isFinite(numericPrice) && numericPrice >= 0) {
            payload.price = numericPrice;
          }
        } else {
          payload.price = editForm.priceMode;
        }

        const response = await fetch(`/api/marketplace/listings/${listing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          const responsePayload = (await response.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;

          window.alert(
            responsePayload?.message ??
              responsePayload?.error ??
              'تعذر تحديث الإعلان الآن.',
          );
          return;
        }

        setEditingListingId(null);
        await refreshListings(1);
      } finally {
        setSavingListingId(null);
      }
    },
    [editForm, refreshListings, router],
  );

  const uploadListingImage = useCallback(
    async (listing: ListingCard, file: File | null) => {
      if (!file) {
        return;
      }

      setUploadingListingId(listing.id);

      try {
        const formData = new FormData();
        formData.append('image', file);

        const response = await fetch(
          `/api/marketplace/listings/${listing.id}/images`,
          {
            method: 'POST',
            body: formData,
          },
        );

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          window.alert(
            payload?.message ??
              payload?.error ??
              'تعذر رفع الصورة. تأكد من إعداد تخزين الصور ثم حاول مرة أخرى.',
          );
          return;
        }

        void refreshListings(1);
      } finally {
        setUploadingListingId(null);
      }
    },
    [refreshListings, router],
  );

  const setPrimaryListingImage = useCallback(
    async (listing: ListingCard, image: ListingImageCard) => {
      setUpdatingImageId(image.id);

      try {
        const response = await fetch(
          `/api/marketplace/listings/${listing.id}/images/${image.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_primary' }),
          },
        );

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          window.alert('تعذر تعيين الصورة الرئيسية الآن.');
          return;
        }

        await refreshListings(1);
      } finally {
        setUpdatingImageId(null);
      }
    },
    [refreshListings, router],
  );

  const deleteListingImage = useCallback(
    async (listing: ListingCard, image: ListingImageCard) => {
      if (!window.confirm('هل تريد حذف هذه الصورة من الإعلان؟')) {
        return;
      }

      setUpdatingImageId(image.id);

      try {
        const response = await fetch(
          `/api/marketplace/listings/${listing.id}/images/${image.id}`,
          { method: 'DELETE' },
        );

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          window.alert('تعذر حذف الصورة الآن.');
          return;
        }

        await refreshListings(1);
      } finally {
        setUpdatingImageId(null);
      }
    },
    [refreshListings, router],
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

              {isListingsLoading && listings.length === 0 ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  ط¬ط§ط± طھط­ظ…ظٹظ„ ط§ظ„ط¥ط¹ظ„ط§ظ†ط§طھ...
                </div>
              ) : listings.length === 0 ? (
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
                <div className="grid gap-4">
                  <div className="grid gap-3">
                    {listings.map((listing) => (
                      <article key={listing.id} className="grid min-w-0 overflow-hidden rounded-md border bg-white shadow-sm dark:bg-background md:grid-cols-[9.5rem_minmax(0,1fr)] xl:grid-cols-[10rem_minmax(0,1fr)_13rem]">
                      {listing.image ? (
                        <img alt={listing.title} className="aspect-[16/10] w-full object-cover md:h-full md:min-h-40" src={listing.image} />
                      ) : (
                        <div className="grid aspect-[16/10] w-full place-items-center bg-slate-100 text-center text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400 md:h-full md:min-h-40">
                          <div className="grid gap-1">
                            <ImageIcon className="mx-auto size-5" />
                            <span>لا توجد صورة حقيقية</span>
                          </div>
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="grid gap-2 p-3">
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <h3 className="truncate text-sm font-bold">{listing.title}</h3>
                          <span className="rounded-md bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                            {listing.status}
                          </span>
                          </div>
                          <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">{listing.description}</p>
                          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                            <span className="truncate font-semibold text-slate-950 dark:text-card-foreground">{listing.price}</span>
                            <span className="truncate">{listing.city}</span>
                            <span className="truncate">{listing.category}</span>
                            <span className="truncate">{listing.stats}</span>
                          </div>
                        </div>
                      </div>
                      {editingListingId === listing.id && (
                        <div className="grid gap-2 border-t p-3">
                          <input
                            className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="عنوان الإعلان"
                            value={editForm.title}
                          />
                          <textarea
                            className="min-h-24 rounded-md border bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500 dark:bg-card"
                            onChange={(event) =>
                              setEditForm((current) => ({
                                ...current,
                                description: event.target.value,
                              }))
                            }
                            placeholder="وصف الإعلان"
                            value={editForm.description}
                          />
                          <div className="grid gap-2 sm:grid-cols-2">
                            <input
                              className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  city: event.target.value,
                                }))
                              }
                              placeholder="المدينة"
                              value={editForm.city}
                            />
                            <select
                              className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  category: event.target.value,
                                }))
                              }
                              value={editForm.category}
                            >
                              {listingCategoryOptions.map((category) => (
                                <option key={category} value={category}>
                                  {formatCategory(category)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[9rem_1fr_9rem]">
                            <select
                              className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  priceMode: event.target.value as ListingEditForm['priceMode'],
                                }))
                              }
                              value={editForm.priceMode}
                            >
                              <option value="number">سعر محدد</option>
                              <option value="negotiable">قابل للتفاوض</option>
                              <option value="bid">على السوم</option>
                            </select>
                            <input
                              className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 disabled:opacity-50 dark:bg-card"
                              disabled={editForm.priceMode !== 'number'}
                              inputMode="decimal"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  price: event.target.value,
                                }))
                              }
                              placeholder="السعر"
                              value={editForm.price}
                            />
                            <select
                              className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                              onChange={(event) =>
                                setEditForm((current) => ({
                                  ...current,
                                  condition: event.target.value as ListingEditForm['condition'],
                                }))
                              }
                              value={editForm.condition}
                            >
                              <option value="">الحالة</option>
                              {listingConditionOptions.map((condition) => (
                                <option key={condition.value} value={condition.value}>
                                  {condition.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="rounded-md bg-blue-600 hover:bg-blue-700"
                              disabled={savingListingId === listing.id}
                              onClick={() => void saveListingEdits(listing)}
                            >
                              <Save className="size-3.5" />
                              {savingListingId === listing.id ? 'حفظ...' : 'حفظ'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-md"
                              onClick={cancelEditingListing}
                            >
                              <X className="size-3.5" />
                              إلغاء
                            </Button>
                          </div>
                        </div>
                      )}
                      {listing.images.length > 0 && (
                        <div className="grid gap-2 border-t p-3 xl:border-r xl:border-t-0">
                          <div className="text-xs font-semibold text-muted-foreground">
                            صور الإعلان
                          </div>
                          <div className="flex gap-2 overflow-x-auto pb-1 xl:grid xl:grid-cols-2 xl:overflow-visible xl:pb-0">
                            {listing.images.map((image) => (
                              <div
                                key={image.id}
                                className="grid w-20 shrink-0 gap-1 rounded-md border p-1 xl:w-auto"
                              >
                                <div className="relative aspect-square overflow-hidden rounded bg-slate-100 dark:bg-slate-900">
                                  {image.url ? (
                                    <img
                                      alt=""
                                      className="h-full w-full object-cover"
                                      src={image.url}
                                    />
                                  ) : (
                                    <div className="grid h-full place-items-center">
                                      <ImageIcon className="size-5 text-slate-400" />
                                    </div>
                                  )}
                                  {image.isPrimary && (
                                    <span className="absolute right-1 top-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                      رئيسية
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-1">
                                  <Button
                                    size="icon-sm"
                                    variant="outline"
                                    className="size-8 rounded-md"
                                    disabled={updatingImageId === image.id}
                                    onClick={() =>
                                      void setPrimaryListingImage(listing, image)
                                    }
                                    aria-label="تعيين كصورة رئيسية"
                                  >
                                    <Star className="size-3.5" />
                                  </Button>
                                  <Button
                                    size="icon-sm"
                                    variant="outline"
                                    className="size-8 rounded-md text-red-600 hover:text-red-700"
                                    disabled={updatingImageId === image.id}
                                    onClick={() =>
                                      void deleteListingImage(listing, image)
                                    }
                                    aria-label="حذف الصورة"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5 border-t p-2 sm:grid-cols-3 xl:col-span-3 xl:grid-cols-6">
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => startEditingListing(listing)}>
                          <Pencil className="size-3.5" />
                          تعديل
                        </Button>
                        <Button asChild size="sm" variant="outline" className="rounded-md">
                          <label>
                            <Upload className="size-3.5" />
                            {uploadingListingId === listing.id ? 'رفع...' : 'صورة'}
                            <input
                              accept="image/jpeg,image/png,image/webp"
                              className="sr-only"
                              disabled={uploadingListingId === listing.id}
                              onChange={(event) => {
                                const file = event.currentTarget.files?.[0] ?? null;
                                void uploadListingImage(listing, file);
                                event.currentTarget.value = '';
                              }}
                              type="file"
                            />
                          </label>
                        </Button>
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
                  {listingsPagination?.hasMore && (
                    <Button
                      variant="outline"
                      className="mx-auto rounded-md"
                      disabled={isListingsLoading}
                      onClick={() =>
                        void refreshListings(listingsPagination.nextPage ?? 1)
                      }
                    >
                      {isListingsLoading ? 'ط¬ط§ط± ط§ظ„طھط­ظ…ظٹظ„...' : 'طھط­ظ…ظٹظ„ ط§ظ„ظ…ط²ظٹط¯'}
                    </Button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
