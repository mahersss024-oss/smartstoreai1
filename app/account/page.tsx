'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
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
  Phone,
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
import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { ListingShareButton } from '@/components/listing-share-button';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { countContactPhoneCandidates } from '@/lib/auth/contact-profile';
import { createUploadableImageFile } from '@/lib/client-image-normalization';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';

type AuthUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  phoneNumber?: string;
  role?: string;
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
  compliance?: {
    decision?: 'allow' | 'block' | 'needs_review';
    reasons?: string[];
  };
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
  compliance?: {
    decision?: 'allow' | 'block' | 'needs_review';
    reasons?: string[];
  };
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

type ListingEditNotice = {
  listingId: string;
  tone: 'info' | 'warning' | 'danger';
  message: string;
  reasons?: string[];
};

type ProfileNotice = {
  tone: 'success' | 'danger' | 'info';
  message: string;
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

function formatComplianceReason(reason: string) {
  if (reason === 'prohibited_in_saudi_marketplace_policy') {
    return 'يبدو أن الإعلان يتضمن منتجًا أو وصفًا غير مسموح في سياسة السوق.';
  }

  if (reason === 'high_risk_or_regulated_product') {
    return 'الإعلان يتضمن منتجًا عالي المخاطر أو يحتاج موافقة ومراجعة قبل النشر.';
  }

  return 'راجع العنوان والوصف والتصنيف واحذف أي تفاصيل قد تخالف سياسة المنصة.';
}

function getEditNoticeClasses(tone: ListingEditNotice['tone']) {
  if (tone === 'danger') {
    return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200';
  }

  if (tone === 'warning') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-100';
  }

  return 'border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-100';
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
    compliance: listing.compliance,
    images,
    stats: `${listing.views ?? 0} مشاهدة · ${listing.messageCount ?? 0} رسائل · ${
      listing.favoriteCount ?? 0
    } حفظ`,
  };
}

function listingHasApprovedImage(listing: ListingCard) {
  return listing.images.some((image) => image.status === 'approved');
}

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

function createEditFormFromListing(listing: ListingCard): ListingEditForm {
  return {
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
  };
}

export default function AccountPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [isSessionLoading, setIsSessionLoading] = useState(true);
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
  const [editNotice, setEditNotice] = useState<ListingEditNotice | null>(null);
  const [updatingImageId, setUpdatingImageId] = useState<string | null>(null);
  const [profilePhone, setProfilePhone] = useState('');
  const [savedProfilePhone, setSavedProfilePhone] = useState('');
  const [isEditingProfilePhone, setIsEditingProfilePhone] = useState(false);
  const [profileNotice, setProfileNotice] = useState<ProfileNotice | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const stats = useMemo(() => {
    return {
      published: listings.filter((listing) => listing.status === 'منشور').length,
      drafts: listings.filter((listing) => listing.status === 'مسودة').length,
      paused: listings.filter((listing) => listing.status === 'موقوف').length,
      sold: listings.filter((listing) => listing.status === 'مباع').length,
    };
  }, [listings]);
  const isAdmin =
    session.user?.role === 'owner' ||
    session.user?.role === 'admin' ||
    session.user?.role === 'moderator';
  const hasSavedProfilePhone = Boolean(savedProfilePhone);
  const isProfilePhoneInputLocked =
    hasSavedProfilePhone && !isEditingProfilePhone;

  const refreshSession = useCallback(() => {
    setIsSessionLoading(true);

    return fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => response.json() as Promise<AuthSessionPayload>)
      .then((payload) => {
        setSession(payload);
        setProfilePhone(payload.user?.phoneNumber ?? '');
        setSavedProfilePhone(payload.user?.phoneNumber ?? '');
        setIsEditingProfilePhone(false);
      })
      .catch(() => {
        setSession({ authenticated: false, user: null });
        setProfilePhone('');
        setSavedProfilePhone('');
        setIsEditingProfilePhone(false);
      })
      .finally(() => {
        setIsSessionLoading(false);
      });
  }, []);

  const refreshListings = useCallback(async (page = 1) => {
    await Promise.resolve();
    setIsListingsLoading(true);

    try {
      const response = await fetch(
        `/api/marketplace/me/listings?page=${page}&limit=24`,
        { cache: 'no-store' },
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

  const listingsLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(listingsPagination?.hasMore),
    isLoading: isListingsLoading,
    onLoadMore: () => {
      void refreshListings(listingsPagination?.nextPage ?? 1);
    },
  });

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshSession();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshSession]);

  useEffect(() => {
    let cancelled = false;

    if (!session.authenticated) {
      return;
    }

    queueMicrotask(() => {
      if (!cancelled) {
        void refreshListings();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshListings, session.authenticated]);

  useSmartstoreRealtime({
    enabled: session.authenticated,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_created',
      'ad_updated',
      'ad_deleted',
      'ad_status_changed',
      'message_created',
      'commission_updated',
      'maintenance_cleanup',
    ],
    onEvent: (event) => {
      const currentUserId = session.user?.id;

      if (!currentUserId) {
        return;
      }

      if (event.type === 'maintenance_cleanup') {
        void refreshListings(1);
        return;
      }

      if (event.type === 'message_created') {
        if (event.payload.sellerId === currentUserId) {
          void refreshListings(1);
        }

        return;
      }

      if (event.type === 'commission_updated') {
        if (event.payload.sellerId === currentUserId) {
          void refreshListings(1);
        }

        return;
      }

      if ('sellerId' in event.payload && event.payload.sellerId === currentUserId) {
        void refreshListings(1);
      }
    },
    onResync: ({ reason }) => {
      if (reason === 'event' || !session.authenticated) {
        return;
      }

      return refreshListings(1);
    },
  });

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      setListings([]);
      setListingsPagination(null);
      setSession({ authenticated: false, user: null });
      setIsSessionLoading(false);
      setProfilePhone('');
      setSavedProfilePhone('');
      setIsEditingProfilePhone(false);
      setProfileNotice(null);
    });
  }, []);

  const saveProfile = useCallback(async (nextPhoneNumber = profilePhone) => {
    if (countContactPhoneCandidates(nextPhoneNumber) > 1) {
      setProfileNotice({
        tone: 'danger',
        message: 'يمكن حفظ رقم تواصل رسمي واحد فقط. احذف الرقم الإضافي ثم احفظ.',
      });
      return;
    }

    setIsSavingProfile(true);
    setProfileNotice(null);

    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: nextPhoneNumber }),
      });
      const payload = (await response.json().catch(() => null)) as {
        user?: AuthUser;
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok || !payload?.user) {
        setProfileNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر حفظ بيانات الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      setSession((currentSession) => ({
        ...currentSession,
        user: currentSession.user
          ? { ...currentSession.user, ...payload.user }
          : payload.user ?? null,
      }));
      setProfilePhone(payload.user.phoneNumber ?? '');
      setSavedProfilePhone(payload.user.phoneNumber ?? '');
      setIsEditingProfilePhone(false);
      setProfileNotice({
        tone: 'success',
        message: payload.user.phoneNumber
          ? 'تم حفظ رقم التواصل الرسمي في حسابك.'
          : 'تم حذف رقم التواصل من حسابك.',
      });
    } catch {
      setProfileNotice({
        tone: 'danger',
        message: 'تعذر حفظ بيانات الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  }, [profilePhone, router]);

  const editProfilePhone = useCallback(() => {
    setProfilePhone(savedProfilePhone);
    setIsEditingProfilePhone(true);
    setProfileNotice({
      tone: 'info',
      message: 'عدّل الرقم الرسمي ثم اضغط حفظ البيانات.',
    });
  }, [savedProfilePhone]);

  const deleteProfilePhone = useCallback(() => {
    void saveProfile('');
  }, [saveProfile]);

  const deleteAccount = useCallback(async () => {
    if (
      !window.confirm(
        'هل تؤكد حذف الحساب؟ سيتم حذف الإعلانات والمحادثات والبيانات المرتبطة بهذا الحساب من المنصة.',
      )
    ) {
      return;
    }

    setIsDeletingAccount(true);
    setProfileNotice(null);

    try {
      const response = await fetch('/api/account/profile', {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setProfileNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر حذف الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      setListings([]);
      setListingsPagination(null);
      setSession({ authenticated: false, user: null });
      setProfilePhone('');
      setSavedProfilePhone('');
      setIsEditingProfilePhone(false);
      router.push('/');
    } catch {
      setProfileNotice({
        tone: 'danger',
        message: 'تعذر حذف الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsDeletingAccount(false);
    }
  }, [router]);

  const controlListing = useCallback(
    (listing: ListingCard, action: 'publish' | 'pause' | 'mark_sold' | 'delete') => {
      if (action === 'publish' && !listingHasApprovedImage(listing)) {
        setEditingListingId(listing.id);
        setEditForm(createEditFormFromListing(listing));
        setEditNotice({
          listingId: listing.id,
          tone: 'warning',
          message:
            'لا يمكن نشر الإعلان قبل إضافة صورة حقيقية مطابقة للمنتج. ارفع صورة واضحة للمنتج نفسه ثم حاول النشر مرة أخرى.',
        });
        return;
      }

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
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey(`listing-${action}`),
        },
        body: JSON.stringify({ action }),
      }).then(async (response) => {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          listing?: ApiListingRecord;
        } | null;

        if (payload?.listing) {
          const updatedListing = listingRecordToCard(payload.listing);

          setListings((currentListings) =>
            currentListings.map((currentListing) =>
              currentListing.id === updatedListing.id
                ? updatedListing
                : currentListing,
            ),
          );
        }

        if (!response.ok && action === 'publish') {
          setEditingListingId(listing.id);
          setEditForm(createEditFormFromListing(listing));
          setEditNotice({
            listingId: listing.id,
            tone: 'warning',
            message:
              payload?.message ??
              'لا يمكن نشر الإعلان الآن. تأكد من وجود صورة حقيقية مطابقة وأن بيانات الإعلان لا تخالف سياسة السوق.',
          });
        }

        void refreshListings(1);
      });
    },
    [refreshListings],
  );

  const startEditingListing = useCallback((listing: ListingCard) => {
    setEditingListingId(listing.id);
    setEditNotice({
      listingId: listing.id,
      tone: 'info',
      message:
        'أي تعديل على الإعلان يتم فحصه تلقائيًا بالذكاء الاصطناعي قبل اعتماده. إذا أصبح الإعلان مخالفًا سيتم رفضه أو تحويله للمراجعة.',
    });
    setEditForm(createEditFormFromListing(listing));
  }, []);

  const cancelEditingListing = useCallback(() => {
    setEditingListingId(null);
    setSavingListingId(null);
    setEditNotice(null);
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
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('listing-update'),
          },
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
            listing?: ApiListingRecord;
          } | null;

          if (responsePayload?.listing) {
            const blockedListing = listingRecordToCard(responsePayload.listing);

            setListings((currentListings) =>
              currentListings.map((currentListing) =>
                currentListing.id === blockedListing.id
                  ? blockedListing
                  : currentListing,
              ),
            );
          }

          if (responsePayload?.error === 'listing_blocked') {
            setEditNotice({
              listingId: listing.id,
              tone: 'danger',
              message:
                'لم يتم قبول التعديل لأن فحص الذكاء الاصطناعي صنّف الإعلان كمخالف. عدّل البيانات ثم حاول الحفظ مرة أخرى.',
              reasons: responsePayload.listing?.compliance?.reasons,
            });
            return;
          }

          setEditNotice({
            listingId: listing.id,
            tone: 'danger',
            message:
              responsePayload?.message ??
              responsePayload?.error ??
              'تعذر تحديث الإعلان الآن. حاول مرة أخرى بعد قليل.',
          });
          return;
        }

        const responsePayload = (await response.json().catch(() => null)) as {
          listing?: ApiListingRecord;
        } | null;

        if (responsePayload?.listing?.compliance?.decision === 'needs_review') {
          const reviewedListing = listingRecordToCard(responsePayload.listing);

          setListings((currentListings) =>
            currentListings.map((currentListing) =>
              currentListing.id === reviewedListing.id
                ? reviewedListing
                : currentListing,
            ),
          );
          setEditNotice({
            listingId: listing.id,
            tone: 'warning',
            message:
              'تم حفظ التعديل، لكن الإعلان انتقل للمراجعة قبل النشر لأن فحص الذكاء الاصطناعي وجد عناصر تحتاج تحققًا إضافيًا.',
            reasons: responsePayload.listing.compliance.reasons,
          });
          await refreshListings(1);
          return;
        }

        setEditNotice(null);
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
        const uploadFile = await createUploadableImageFile(file);
        const formData = new FormData();
        formData.append('image', uploadFile);

        const response = await fetch(
          `/api/marketplace/listings/${listing.id}/images`,
          {
            method: 'POST',
            headers: {
              'Idempotency-Key': createClientIdempotencyKey('listing-image-upload'),
            },
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
            maxImages?: number;
          } | null;

          if (payload?.error === 'listing_image_limit_reached') {
            setEditingListingId(listing.id);
            setEditForm(createEditFormFromListing(listing));
            setEditNotice({
              listingId: listing.id,
              tone: 'warning',
              message:
                payload.message ??
                `وصل الإعلان إلى الحد الأقصى (${payload.maxImages ?? 8}) من الصور. احذف صورة قديمة قبل رفع صورة جديدة.`,
            });
            return;
          }

          window.alert(
            payload?.message ??
              payload?.error ??
              'تعذر رفع الصورة. تأكد من إعداد تخزين الصور ثم حاول مرة أخرى.',
          );
          return;
        }

        void refreshListings(1);
      } catch {
        window.alert(
          'تعذر تجهيز الصورة. جرّب صورة JPG أو PNG أو WEBP أو GIF واضحة، أو أعد التقاطها من الكاميرا.',
        );
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
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': createClientIdempotencyKey('listing-image-primary'),
            },
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
          {
            method: 'DELETE',
            headers: {
              'Idempotency-Key': createClientIdempotencyKey('listing-image-delete'),
            },
          },
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
      <div className="mx-auto grid max-w-6xl gap-4 px-3 py-4 sm:px-6 sm:py-5">
        <header className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-white px-3 py-3 shadow-sm dark:bg-card sm:gap-3 sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Link className="grid size-9 place-items-center rounded-md border bg-white dark:bg-background" href="/">
              <ArrowRight className="size-4" />
            </Link>
            <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm sm:size-10">
              <img alt="سوق حمد" className="size-9 object-cover sm:size-10" src="/hamad-market-logo.jpeg" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold sm:text-base">حسابي</h1>
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">بيانات العميل وإعلاناته الخاصة</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <ThemeToggle language="ar" />
            {session.authenticated && (
              <Button variant="outline" size="sm" className="rounded-md px-2 sm:px-3" onClick={handleLogout}>
                <LogOut className="size-4" />
                خروج
              </Button>
            )}
          </div>
        </header>

        {isSessionLoading ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  نتحقق من جلسة الدخول قبل عرض بيانات حسابك.
                </p>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض حسابك</h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  هذه الصفحة مخصصة لبيانات العميل وإعلاناته، وتظهر بعد تسجيل الدخول.
                </p>
              </div>
              <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                <a href="/api/auth/google/start">
                  <GoogleMark className="size-5" />
                  دخول Google
                </a>
              </Button>
              <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                <a href="/api/auth/apple/start">
                  <AppleMark className="size-5" />
                  دخول Apple
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
                    <h2 className="truncate text-xl font-bold">{session.user?.name ?? 'عميل سوق حمد'}</h2>
                    <BadgeCheck className="size-5 shrink-0 text-blue-600" />
                    {isAdmin && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                        <ShieldCheck className="size-3.5" />
                        {session.user?.role === 'moderator'
                          ? 'مشرف'
                          : 'مالك المنصة'}
                      </span>
                    )}
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
                {isAdmin && (
                  <Button asChild variant="outline" className="rounded-md border-emerald-500/40 text-emerald-700 dark:text-emerald-200">
                    <Link href="/admin">
                      <ShieldCheck className="size-4" />
                      لوحة الإدارة
                    </Link>
                  </Button>
                )}
              </div>
            </section>

            <section className="grid gap-3 rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <Phone className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold">بيانات التواصل الرسمية</h2>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    يستخدم هذا الرقم لاحقًا عند مشاركة التواصل داخل محادثة بيع رسمية، ولا يتم السماح بإرساله كنص عشوائي داخل الرسائل.
                  </p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="grid gap-1 text-sm font-semibold">
                  رقم الجوال
                  <input
                    className="h-11 rounded-md border bg-background px-3 text-left text-sm font-medium outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    disabled={isProfilePhoneInputLocked || isSavingProfile}
                    dir="ltr"
                    inputMode="tel"
                    name="profilePhoneNumber"
                    placeholder="05xxxxxxxx"
                    type="tel"
                    value={profilePhone}
                    onChange={(event) => setProfilePhone(event.target.value)}
                  />
                </label>
                <Button
                  className="self-end rounded-md bg-blue-600 hover:bg-blue-700"
                  disabled={isSavingProfile || isProfilePhoneInputLocked}
                  onClick={() => void saveProfile()}
                  type="button"
                >
                  <Save className="size-4" />
                  {isSavingProfile ? 'جار الحفظ...' : 'حفظ البيانات'}
                </Button>
              </div>
              {savedProfilePhone ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                      الرقم الرسمي المحفوظ
                    </div>
                    <div className="mt-1 truncate font-semibold" dir="ltr">
                      {savedProfilePhone}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      className="rounded-md"
                      disabled={isSavingProfile}
                      onClick={editProfilePhone}
                      type="button"
                      variant="outline"
                    >
                      <Pencil className="size-4" />
                      تعديل
                    </Button>
                    <Button
                      className="rounded-md border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-200"
                      disabled={isSavingProfile}
                      onClick={deleteProfilePhone}
                      type="button"
                      variant="outline"
                    >
                      <Trash2 className="size-4" />
                      حذف
                    </Button>
                  </div>
                </div>
              ) : null}
              {profileNotice ? (
                <div
                  className={`rounded-md border px-3 py-2 text-xs font-semibold ${
                    profileNotice.tone === 'success'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                      : profileNotice.tone === 'danger'
                        ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-200'
                        : 'border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-100'
                  }`}
                >
                  {profileNotice.message}
                </div>
              ) : null}
            </section>

            <section className="grid gap-3 rounded-md border border-red-500/30 bg-white p-4 shadow-sm dark:bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-red-700 dark:text-red-200">حذف الحساب</h2>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    هذا الخيار يحذف بيانات الحساب المرتبطة بالمنصة ويخرجك من الجلسة الحالية.
                  </p>
                </div>
                <Button
                  className="rounded-md border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-200"
                  disabled={isDeletingAccount}
                  onClick={() => void deleteAccount()}
                  type="button"
                  variant="outline"
                >
                  <Trash2 className="size-4" />
                  {isDeletingAccount ? 'جار الحذف...' : 'حذف الحساب'}
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
                  جار تحميل الإعلانات...
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
                        <img alt={listing.title} className="aspect-[16/10] w-full object-cover md:row-start-1 md:aspect-square md:self-start" src={listing.image} />
                      ) : (
                        <div className="grid aspect-[16/10] w-full place-items-center bg-slate-100 text-center text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400 md:row-start-1 md:aspect-square md:self-start">
                          <div className="grid gap-1">
                            <ImageIcon className="mx-auto size-5" />
                            <span>لا توجد صورة حقيقية</span>
                          </div>
                        </div>
                      )}
                      <div className="min-w-0 md:row-start-1">
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
                        <div className="grid gap-2 border-t p-3 md:col-span-2 xl:col-span-3">
                          {editNotice?.listingId === listing.id && (
                            <div
                              className={`grid gap-1.5 rounded-md border px-3 py-2 text-xs leading-6 ${getEditNoticeClasses(
                                editNotice.tone,
                              )}`}
                            >
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                                <p>{editNotice.message}</p>
                              </div>
                              {editNotice.reasons?.length ? (
                                <ul className="grid gap-1 pr-6">
                                  {editNotice.reasons.map((reason) => (
                                    <li key={reason} className="list-disc">
                                      {formatComplianceReason(reason)}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          )}
                          <input
                            className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus:border-blue-500 dark:bg-card"
                            name={`listing-${listing.id}-title`}
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
                            name={`listing-${listing.id}-description`}
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
                              name={`listing-${listing.id}-city`}
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
                              name={`listing-${listing.id}-category`}
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
                              name={`listing-${listing.id}-priceMode`}
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
                              name={`listing-${listing.id}-price`}
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
                              name={`listing-${listing.id}-condition`}
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
                        <div className="grid min-w-0 gap-2 border-t p-3 md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:border-r xl:border-t-0">
                          <div className="text-xs font-semibold text-muted-foreground">
                            صور الإعلان
                          </div>
                          <div className="grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-2">
                            {listing.images.map((image) => (
                              <div
                                key={image.id}
                                className="grid min-w-0 gap-1 rounded-md border p-1"
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
                      <div className="grid grid-cols-2 gap-1.5 border-t p-2 sm:grid-cols-3 md:col-span-2 xl:col-span-3 xl:grid-cols-7">
                        {listing.status === 'published' && (
                          <Button asChild size="sm" variant="outline" className="rounded-md">
                            <Link href={`/listings/${listing.id}`}>
                              <Store className="size-3.5" />
                              عرض
                            </Link>
                          </Button>
                        )}
                        {listing.status === 'published' && (
                          <ListingShareButton
                            className="rounded-md"
                            listingId={listing.id}
                            title={listing.title}
                          />
                        )}
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => startEditingListing(listing)}>
                          <Pencil className="size-3.5" />
                          تعديل
                        </Button>
                        <Button asChild size="sm" variant="outline" className="rounded-md">
                          <label>
                            <Upload className="size-3.5" />
                            {uploadingListingId === listing.id ? 'رفع...' : 'صورة'}
                            <input
                              accept="image/*"
                              className="sr-only"
                              disabled={uploadingListingId === listing.id}
                              name={`listing-${listing.id}-image`}
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
                  <div ref={listingsLoadMoreRef} className="h-px" />
                  {listingsPagination?.hasMore && (
                    <Button
                      variant="outline"
                      className="mx-auto rounded-md"
                      disabled={isListingsLoading}
                      onClick={() =>
                        void refreshListings(listingsPagination.nextPage ?? 1)
                      }
                    >
                      {isListingsLoading ? 'جار التحميل...' : 'تحميل المزيد'}
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
