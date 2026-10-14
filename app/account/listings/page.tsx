'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  Heart,
  ImageIcon,
  Images,
  MapPin,
  Megaphone,
  MessageCircle,
  Pause,
  Pencil,
  Percent,
  Save,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { CommissionAgreementDialog } from '@/components/commission-agreement-dialog';
import { CitySelector } from '@/components/city-selector';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { ListingCardImage } from '@/components/listing-card-image';
import { ListingCardSkeleton } from '@/components/listing-card-skeleton';
import { ListingShareButton } from '@/components/listing-share-button';
import { ResilientImage } from '@/components/resilient-image';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAuthProviderVisibility } from '@/hooks/use-auth-provider-visibility';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import {
  readClientPageCache,
  writeClientPageCache,
} from '@/lib/client-page-cache';
import { queueUploadableImagePreparation } from '@/lib/client-image-normalization';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@ui/dialog';

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
  previewUrl: string | null;
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
  views: number;
  messageCount: number;
  favoriteCount: number;
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

type AccountListingsCachePayload = {
  listings: ApiListingRecord[];
  pagination?: PaginationMeta | null;
};

type ListingEditNotice = {
  listingId: string;
  tone: 'info' | 'warning' | 'danger';
  message: string;
  reasons?: string[];
};

type ListingControlAction = 'publish' | 'pause' | 'mark_sold' | 'delete';

type PendingListingControl = {
  listingId: string;
  action: ListingControlAction;
};

type ListingActionResult = {
  listingId: string;
  title: string;
  description?: string;
  statusLabel?: string;
  share?: boolean;
  listingTitle?: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
};

type ListingImageActionNotice = {
  listingId: string;
  message: string;
  tone?: 'success' | 'warning' | 'danger' | 'info';
};

type PendingListingImageDelete = {
  listing: ListingCard;
  image: ListingImageCard;
};

type ImagePreviewState = {
  listingId: string;
  imageId: string;
} | null;

const listingCategoryOptions = [
  'cars',
  'auto_parts',
  'mobile_phones',
  'computers',
  'real_estate',
  'furniture',
  'fashion',
  'women_supplies',
  'men_supplies',
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

function formatImageCount(count: number) {
  if (count === 1) {
    return '1 صورة';
  }

  if (count === 2) {
    return '2 صور';
  }

  return `${count} صور`;
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
    women_supplies: 'مستلزمات نسائية',
    men_supplies: 'مستلزمات رجالية',
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
        previewUrl:
          getDurableImageUrl(
            image.displayUrl,
            image.originalUrl,
            image.thumbnailUrl,
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
    views: listing.views ?? 0,
    messageCount: listing.messageCount ?? 0,
    favoriteCount: listing.favoriteCount ?? 0,
    stats: `${listing.views ?? 0} مشاهدة · ${listing.messageCount ?? 0} رسائل · ${
      listing.favoriteCount ?? 0
    } حفظ`,
  };
}

function listingHasApprovedImage(listing: ListingCard) {
  return listing.images.some((image) => image.status === 'approved');
}

function canEditListing(listing: ListingCard) {
  return listing.rawStatus !== 'deleted';
}

function canDeleteListing(listing: ListingCard) {
  return listing.rawStatus !== 'deleted';
}

function canPublishListing(listing: ListingCard) {
  return ['draft', 'paused', 'rejected'].includes(listing.rawStatus ?? 'draft');
}

function canPauseListing(listing: ListingCard) {
  return listing.rawStatus === 'published';
}

function canMarkListingSold(listing: ListingCard) {
  return listing.rawStatus === 'published' || listing.rawStatus === 'paused';
}

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

function getAccountListingsCacheKey(userId: string) {
  return `smartstore:page-cache:v1:account-listings:${userId}`;
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

export default function AccountListingsPage() {
  const router = useRouter();
  const { isSessionLoading, session } = useAuthSession();
  const authProviders = useAuthProviderVisibility();
  const sessionUserId = session.user?.id;
  const [listings, setListings] = useState<ListingCard[]>([]);
  const [listingsPagination, setListingsPagination] =
    useState<PaginationMeta | null>(null);
  const [isListingsLoading, setIsListingsLoading] = useState(false);
  const [uploadingListingId, setUploadingListingId] = useState<string | null>(
    null,
  );
  const [imageUploadProgress, setImageUploadProgress] = useState<{
    listingId: string;
    current: number;
    total: number;
  } | null>(null);
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [pendingPublishListing, setPendingPublishListing] =
    useState<ListingCard | null>(null);
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
  const [pendingListingControl, setPendingListingControl] =
    useState<PendingListingControl | null>(null);
  const [actionResult, setActionResult] = useState<ListingActionResult | null>(
    null,
  );
  const [imageActionNotice, setImageActionNotice] =
    useState<ListingImageActionNotice | null>(null);
  const [pendingImageDelete, setPendingImageDelete] =
    useState<PendingListingImageDelete | null>(null);
  const [imageDeleteError, setImageDeleteError] = useState<string | null>(null);
  const [imageManagerListingId, setImageManagerListingId] = useState<string | null>(
    null,
  );
  const [imagePreviewState, setImagePreviewState] =
    useState<ImagePreviewState>(null);
  const [pendingListingConfirm, setPendingListingConfirm] = useState<{
    listing: ListingCard;
    action: ListingControlAction;
  } | null>(null);
  const replaceListingFromRecord = useCallback((listingRecord: ApiListingRecord) => {
    const nextListing = listingRecordToCard(listingRecord);

    setListings((currentListings) =>
      currentListings.map((currentListing) =>
        currentListing.id === nextListing.id ? nextListing : currentListing,
      ),
    );

    return nextListing;
  }, []);
  const refreshListings = useCallback(async (
    page = 1,
    options?: { showLoading?: boolean },
  ) => {
    await Promise.resolve();
    const showLoading = options?.showLoading ?? true;

    if (showLoading) {
      setIsListingsLoading(true);
    }

    try {
      const response = await fetch(
        `/api/marketplace/me/listings?page=${page}&limit=24`,
        { cache: 'no-store' },
      );
      const payload: {
        listings?: ApiListingRecord[];
        pagination?: PaginationMeta | null;
      } = response.ok ? await response.json() : { listings: [] };

      if (!response.ok && page === 1 && !showLoading) {
        return;
      }

      const nextListings = payload.listings?.map(listingRecordToCard) ?? [];

      setListings((currentListings) =>
        page === 1 ? nextListings : [...currentListings, ...nextListings],
      );
      setListingsPagination(payload.pagination ?? null);

      if (page === 1 && sessionUserId) {
        writeClientPageCache<AccountListingsCachePayload>(
          getAccountListingsCacheKey(sessionUserId),
          {
            listings: payload.listings ?? [],
            pagination: payload.pagination ?? null,
          },
        );
      }
    } catch {
      if (page === 1 && showLoading) {
        setListings([]);
      }
    } finally {
      if (showLoading) {
        setIsListingsLoading(false);
      }
    }
  }, [sessionUserId]);

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshListings(1);
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshListings]);

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
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!session.authenticated) {
      return;
    }

    queueMicrotask(() => {
      if (!cancelled) {
        const cachedPayload = sessionUserId
          ? readClientPageCache<AccountListingsCachePayload>(
              getAccountListingsCacheKey(sessionUserId),
            )
          : null;

        if (cachedPayload) {
          setListings((cachedPayload.listings ?? []).map(listingRecordToCard));
          setListingsPagination(cachedPayload.pagination ?? null);
          setIsListingsLoading(false);
        }

        void refreshListings(1, { showLoading: !cachedPayload });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshListings, session.authenticated, sessionUserId]);

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

  const executeListingControl = useCallback(
    (listing: ListingCard, action: ListingControlAction) => {
      setPendingListingConfirm(null);
      setPendingListingControl({ listingId: listing.id, action });
      setActionResult(null);
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

        let updatedListing: ListingCard | null = null;

        if (payload?.listing) {
          const nextListing = listingRecordToCard(payload.listing);
          updatedListing = nextListing;

          setListings((currentListings) =>
            currentListings.map((currentListing) =>
              currentListing.id === nextListing.id
                ? nextListing
                : currentListing,
            ),
          );
        }

        if (!response.ok && (action as string) === 'publish') {
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

        if (response.ok) {
          const resultListing = updatedListing ?? listing;
          const resultByAction: Record<ListingControlAction, ListingActionResult> = {
            publish: {
              listingId: listing.id,
              title: 'تم نشر الإعلان بنجاح',
              statusLabel: resultListing.status,
              share: true,
              listingTitle: resultListing.title,
            },
            pause: {
              listingId: listing.id,
              title: 'تم إيقاف نشر الإعلان',
              statusLabel: resultListing.status,
            },
            mark_sold: {
              listingId: listing.id,
              title: 'تم تحديث حالة الإعلان',
              statusLabel: resultListing.status,
            },
            delete: {
              listingId: listing.id,
              title: 'تم حذف الإعلان بنجاح',
            },
          };

          setEditNotice(null);
          setActionResult(resultByAction[action]);
        } else if ((action as string) !== 'publish') {
          setActionResult({
            listingId: listing.id,
            title:
              payload?.message ??
              payload?.error ??
              'تعذر تنفيذ الإجراء الآن. حاول مرة أخرى.',
            tone: 'danger',
          });
        }

        void refreshListings(1);
      }).finally(() => {
        setPendingListingControl((current) =>
          current?.listingId === listing.id && current.action === action
            ? null
            : current,
        );
      });
    },
    [refreshListings],
  );

  const controlListing = useCallback(
    (listing: ListingCard, action: ListingControlAction) => {
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

      if (action === 'publish') {
        setActionResult(null);
        setPendingPublishListing(listing);
        return;
      }

      setActionResult(null);
      setPendingListingConfirm({ listing, action });
    },
    [],
  );

  const confirmPublishListing = useCallback(() => {
    const listing = pendingPublishListing;

    if (!listing) {
      return;
    }

    setPendingPublishListing(null);
    setPendingListingControl({ listingId: listing.id, action: 'publish' });
    setActionResult(null);

    void fetch(`/api/marketplace/listings/${listing.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey('listing-publish'),
      },
      body: JSON.stringify({ action: 'publish' }),
    }).then(async (response) => {
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        listing?: ApiListingRecord;
      } | null;

      let updatedListing: ListingCard | null = null;

      if (payload?.listing) {
        const nextListing = listingRecordToCard(payload.listing);
        updatedListing = nextListing;

        setListings((currentListings) =>
          currentListings.map((currentListing) =>
            currentListing.id === nextListing.id
              ? nextListing
              : currentListing,
          ),
        );
      }

      if (!response.ok) {
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

      if (response.ok) {
        const resultListing = updatedListing ?? listing;

        setEditNotice(null);
        setActionResult({
          listingId: listing.id,
          title: 'تم نشر الإعلان بنجاح',
          statusLabel: resultListing.status,
          share: true,
          listingTitle: resultListing.title,
        });
      }

      void refreshListings(1);
    }).finally(() => {
      setPendingListingControl((current) =>
        current?.listingId === listing.id && current.action === 'publish'
          ? null
          : current,
      );
    });
  }, [pendingPublishListing, refreshListings]);

  const startEditingListing = useCallback((listing: ListingCard) => {
    setActionResult(null);
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
      setActionResult(null);

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
        const savedListing = responsePayload?.listing
          ? listingRecordToCard(responsePayload.listing)
          : null;

        if (responsePayload?.listing?.compliance?.decision === 'needs_review') {
          const reviewedListing = savedListing ?? listingRecordToCard(responsePayload.listing);

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
          return;
        }

        if (savedListing) {
          setListings((currentListings) =>
            currentListings.map((currentListing) =>
              currentListing.id === savedListing.id
                ? savedListing
                : currentListing,
            ),
          );
        }
        setEditNotice(null);
        setEditingListingId(null);
        setActionResult({
          listingId: listing.id,
          title: 'تم حفظ الإعلان',
          description: 'تم حفظ التعديلات. يمكنك نشر الإعلان من خياراته هنا.',
          statusLabel: savedListing?.status ?? listing.status,
        });
      } finally {
        setSavingListingId(null);
      }
    },
    [editForm, router],
  );

  const uploadListingImage = useCallback(
    async (listing: ListingCard, files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const remainingImageSlots = Math.max(8 - listing.images.length, 0);
      if (remainingImageSlots === 0) {
        setEditingListingId(listing.id);
        setEditForm(createEditFormFromListing(listing));
        setEditNotice({
          listingId: listing.id,
          tone: 'warning',
          message: 'وصل الإعلان إلى الحد الأقصى (8 صور). احذف صورة قبل تحميل صورة جديدة.',
        });
        return;
      }

      const filesToUpload = files.slice(0, remainingImageSlots);
      if (files.length > remainingImageSlots) {
        setEditNotice({
          listingId: listing.id,
          tone: 'warning',
          message: `سيتم تحميل ${remainingImageSlots} صورة فقط لإكمال الحد الأقصى البالغ 8 صور.`,
        });
      }

      setUploadingListingId(listing.id);
      setImageActionNotice(null);
      setImageUploadProgress({
        listingId: listing.id,
        current: 0,
        total: filesToUpload.length,
      });

      try {
        const imagePreparations = queueUploadableImagePreparation(filesToUpload);

        for (const [index, preparation] of imagePreparations.entries()) {
          const file = await preparation;
          setImageUploadProgress({
            listingId: listing.id,
            current: index + 1,
            total: imagePreparations.length,
          });
          const formData = new FormData();
          formData.append('image', file);

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

            setImageActionNotice({
              listingId: listing.id,
              message:
                payload?.message ??
                payload?.error ??
                'تعذر رفع الصورة. تأكد من إعداد تخزين الصور ثم حاول مرة أخرى.',
              tone: 'danger',
            });
            return;
          }

          const payload = (await response.json().catch(() => null)) as {
            listing?: ApiListingRecord;
          } | null;

          if (payload?.listing) {
            replaceListingFromRecord(payload.listing);
          }
        }

        setImageActionNotice({
          listingId: listing.id,
          message: 'تم تحديث صور الإعلان.',
        });
      } catch {
        setImageActionNotice({
          listingId: listing.id,
          message:
            'تعذر تجهيز الصورة. جرّب صورة JPG أو PNG أو WEBP أو GIF واضحة، أو أعد التقاطها من الكاميرا.',
          tone: 'danger',
        });
      } finally {
        setUploadingListingId(null);
        setImageUploadProgress(null);
      }
    },
    [replaceListingFromRecord, router],
  );

  const setPrimaryListingImage = useCallback(
    async (listing: ListingCard, image: ListingImageCard) => {
      setUpdatingImageId(image.id);
      setImageActionNotice(null);

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
          setImageActionNotice({
            listingId: listing.id,
            message: 'تعذر تعيين الصورة الرئيسية الآن.',
            tone: 'danger',
          });
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          listing?: ApiListingRecord;
        } | null;

        if (payload?.listing) {
          replaceListingFromRecord(payload.listing);
        }

        setImageActionNotice({
          listingId: listing.id,
          message: 'تم تعيين الصورة الرئيسية.',
        });
      } finally {
        setUpdatingImageId(null);
      }
    },
    [replaceListingFromRecord, router],
  );

  const deleteListingImage = useCallback(
    async (listing: ListingCard, image: ListingImageCard) => {
      setUpdatingImageId(image.id);
      setImageActionNotice(null);
      setImageDeleteError(null);

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
          setImageDeleteError('تعذر حذف الصورة الآن.');
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          listing?: ApiListingRecord;
        } | null;

        if (payload?.listing) {
          replaceListingFromRecord(payload.listing);
        }

        setPendingImageDelete(null);
        setImageActionNotice({
          listingId: listing.id,
          message: 'تم حذف الصورة',
        });
      } finally {
        setUpdatingImageId(null);
      }
    },
    [replaceListingFromRecord, router],
  );

  const imageManagerListing = imageManagerListingId
    ? listings.find((listing) => listing.id === imageManagerListingId) ?? null
    : null;
  const imagePreviewListing = imagePreviewState
    ? listings.find((listing) => listing.id === imagePreviewState.listingId) ?? null
    : null;
  const previewImage =
    imagePreviewListing?.images.find(
      (image) => image.id === imagePreviewState?.imageId,
    ) ??
    imagePreviewListing?.images.find((image) => image.isPrimary) ??
    imagePreviewListing?.images[0] ??
    null;
  const previewImageUrl = previewImage?.previewUrl ?? previewImage?.url ?? null;

  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <CommissionAgreementDialog
        mode="publish"
        onCancel={() => setPendingPublishListing(null)}
        onConfirm={confirmPublishListing}
        open={Boolean(pendingPublishListing)}
      />
      <ActionConfirmDialog
        confirmLabel={
          pendingListingConfirm?.action === 'delete'
            ? 'حذف الإعلان'
            : pendingListingConfirm?.action === 'pause'
              ? 'إيقاف النشر'
              : pendingListingConfirm?.action === 'mark_sold'
                ? 'تم البيع'
                : 'تنفيذ'
        }
        description={
          pendingListingConfirm
            ? `سيتم تنفيذ الإجراء على الإعلان: ${pendingListingConfirm.listing.title}`
            : ''
        }
        loading={Boolean(
          pendingListingConfirm &&
            pendingListingControl?.listingId === pendingListingConfirm.listing.id &&
            pendingListingControl.action === pendingListingConfirm.action,
        )}
        loadingText="جاري التنفيذ..."
        onCancel={() => setPendingListingConfirm(null)}
        onConfirm={() => {
          if (pendingListingConfirm) {
            executeListingControl(
              pendingListingConfirm.listing,
              pendingListingConfirm.action,
            );
          }
        }}
        open={Boolean(pendingListingConfirm)}
        title={
          pendingListingConfirm?.action === 'delete'
            ? 'تأكيد حذف الإعلان'
            : pendingListingConfirm?.action === 'pause'
              ? 'تأكيد إيقاف النشر'
              : pendingListingConfirm?.action === 'mark_sold'
                ? 'تأكيد حالة البيع'
                : 'تأكيد الإجراء'
        }
        tone={pendingListingConfirm?.action === 'delete' ? 'danger' : 'default'}
      />
      <Dialog
        open={Boolean(pendingImageDelete)}
        onOpenChange={(open) => {
          if (!open && !updatingImageId) {
            setPendingImageDelete(null);
            setImageDeleteError(null);
          }
        }}
      >
        <DialogContent className="max-w-[22rem] rounded-lg p-0 text-right" dir="rtl">
          <div className="grid gap-4 px-5 pb-5 pt-6">
            <DialogHeader className="items-center text-center">
              <div className="grid size-12 place-items-center rounded-full bg-red-50 text-red-600 dark:bg-red-500/10">
                <Trash2 className="size-6" />
              </div>
              <DialogTitle className="text-lg font-bold text-slate-950 dark:text-foreground">
                حذف الصورة
              </DialogTitle>
              <DialogDescription className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                هل تريد حذف هذه الصورة من الإعلان؟
              </DialogDescription>
            </DialogHeader>
            {imageDeleteError && (
              <p
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
                role="alert"
              >
                {imageDeleteError}
              </p>
            )}
            <DialogFooter className="grid gap-2 sm:grid-cols-2 sm:gap-2">
              <Button
                className="rounded-md"
                loading={Boolean(
                  pendingImageDelete &&
                    updatingImageId === pendingImageDelete.image.id,
                )}
                loadingText="جاري الحذف..."
                onClick={() => {
                  if (pendingImageDelete) {
                    void deleteListingImage(
                      pendingImageDelete.listing,
                      pendingImageDelete.image,
                    );
                  }
                }}
                type="button"
                variant="destructive"
              >
                <Trash2 className="size-4" />
                حذف الصورة
              </Button>
              <Button
                className="rounded-md"
                disabled={Boolean(updatingImageId)}
                onClick={() => {
                  setPendingImageDelete(null);
                  setImageDeleteError(null);
                }}
                type="button"
                variant="outline"
              >
                إلغاء
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(imagePreviewListing && previewImage)}
        onOpenChange={(open) => {
          if (!open) {
            setImagePreviewState(null);
          }
        }}
      >
        <DialogContent className="max-w-[min(94vw,44rem)] rounded-lg p-0" dir="rtl">
          {imagePreviewListing && previewImage ? (
            <div className="grid gap-3 p-3">
              <DialogHeader className="px-1 text-right">
                <DialogTitle className="truncate text-base font-bold">
                  {imagePreviewListing.title}
                </DialogTitle>
                <DialogDescription>
                  {formatImageCount(imagePreviewListing.images.length)}
                </DialogDescription>
              </DialogHeader>
              <div className="relative overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900">
                {previewImageUrl ? (
                  <ResilientImage
                    alt={imagePreviewListing.title}
                    className="max-h-[70dvh] w-full object-contain"
                    decoding="async"
                    fallback={
                      <div className="grid aspect-video place-items-center text-muted-foreground">
                        <ImageIcon className="size-8" />
                      </div>
                    }
                    src={previewImageUrl}
                  />
                ) : (
                  <div className="grid aspect-video place-items-center text-muted-foreground">
                    <ImageIcon className="size-8" />
                  </div>
                )}
              </div>
              {imagePreviewListing.images.length > 1 ? (
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {imagePreviewListing.images.map((image) => (
                    <button
                      aria-label="معاينة صورة الإعلان"
                      className={`relative size-16 shrink-0 overflow-hidden rounded-md border bg-slate-100 dark:bg-slate-900 ${
                        image.id === previewImage.id
                          ? 'border-blue-500 ring-2 ring-blue-500/25'
                          : 'border-border'
                      }`}
                      key={image.id}
                      onClick={() =>
                        setImagePreviewState({
                          listingId: imagePreviewListing.id,
                          imageId: image.id,
                        })
                      }
                      type="button"
                    >
                      {image.url ? (
                        <ResilientImage
                          alt=""
                          className="h-full w-full object-cover"
                          decoding="async"
                          fallback={
                            <span className="grid h-full place-items-center">
                              <ImageIcon className="size-5 text-muted-foreground" />
                            </span>
                          }
                          loading="lazy"
                          src={image.url}
                        />
                      ) : (
                        <span className="grid h-full place-items-center">
                          <ImageIcon className="size-5 text-muted-foreground" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(imageManagerListing)}
        onOpenChange={(open) => {
          if (!open) {
            setImageManagerListingId(null);
          }
        }}
      >
        <DialogContent className="max-h-[min(86dvh,42rem)] max-w-[min(94vw,42rem)] overflow-y-auto rounded-lg p-0" dir="rtl">
          {imageManagerListing ? (
            <div className="grid gap-4 p-4">
              <DialogHeader className="text-right">
                <DialogTitle className="text-base font-bold">
                  إدارة الصور
                </DialogTitle>
                <DialogDescription>
                  {imageManagerListing.title} · {formatImageCount(imageManagerListing.images.length)}
                </DialogDescription>
              </DialogHeader>
              <Button asChild variant="outline" className="rounded-md">
                <label data-loading={uploadingListingId === imageManagerListing.id || undefined}>
                  <Upload className="size-4" />
                  {uploadingListingId === imageManagerListing.id
                    ? imageUploadProgress?.current
                      ? `جاري تحميل ${imageUploadProgress.current} من ${imageUploadProgress.total}`
                      : 'جاري تجهيز الصور...'
                    : 'إضافة صور'}
                  <input
                    accept="image/*"
                    className="sr-only"
                    disabled={uploadingListingId === imageManagerListing.id}
                    multiple
                    name={`listing-${imageManagerListing.id}-image-manager`}
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files ?? []);
                      void uploadListingImage(imageManagerListing, files);
                      event.currentTarget.value = '';
                    }}
                    type="file"
                  />
                </label>
              </Button>
              {uploadingListingId === imageManagerListing.id && (
                <div className="grid gap-1 rounded-md border border-blue-200/70 bg-blue-50/70 px-3 py-2 text-[11px] font-medium text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      {imageUploadProgress?.current
                        ? `رفع الصور ${imageUploadProgress.current} / ${imageUploadProgress.total}`
                        : 'تجهيز الصور للرفع'}
                    </span>
                    <span>
                      {imageUploadProgress
                        ? Math.round(
                            (imageUploadProgress.current /
                              Math.max(imageUploadProgress.total, 1)) *
                              100,
                          ) + '%'
                        : '...'}
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="upload-progress-track"
                    data-indeterminate={!imageUploadProgress || undefined}
                  >
                    <div
                      className="upload-progress-fill"
                      style={{
                        width: imageUploadProgress
                          ? `${Math.round(
                              (imageUploadProgress.current /
                                Math.max(imageUploadProgress.total, 1)) *
                                100,
                            )}%`
                          : '45%',
                      }}
                    />
                  </div>
                </div>
              )}
              {imageManagerListing.images.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {imageManagerListing.images.map((image) => (
                    <div
                      key={image.id}
                      className="grid min-w-0 gap-1 rounded-md border bg-background p-1 dark:bg-card/35"
                    >
                      <button
                        aria-label="معاينة صورة الإعلان"
                        className="relative aspect-square overflow-hidden rounded bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:bg-slate-900"
                        onClick={() =>
                          setImagePreviewState({
                            listingId: imageManagerListing.id,
                            imageId: image.id,
                          })
                        }
                        type="button"
                      >
                        {image.url ? (
                          <ResilientImage
                            alt=""
                            className="h-full w-full object-contain"
                            decoding="async"
                            fallback={
                              <span className="grid h-full place-items-center">
                                <ImageIcon className="size-5 text-muted-foreground" />
                              </span>
                            }
                            loading="lazy"
                            src={image.url}
                          />
                        ) : (
                          <span className="grid h-full place-items-center">
                            <ImageIcon className="size-5 text-muted-foreground" />
                          </span>
                        )}
                        {image.isPrimary && (
                          <span className="absolute right-1 top-1 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                            رئيسية
                          </span>
                        )}
                      </button>
                      <div className="grid grid-cols-2 gap-1">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          className="size-8 rounded-md"
                          disabled={image.isPrimary}
                          loading={updatingImageId === image.id}
                          onClick={() =>
                            void setPrimaryListingImage(imageManagerListing, image)
                          }
                          aria-label="تعيين كصورة رئيسية"
                        >
                          <Star className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          className="size-8 rounded-md text-red-600 hover:text-red-700"
                          loading={updatingImageId === image.id}
                          onClick={() => {
                            setImageDeleteError(null);
                            setPendingImageDelete({
                              listing: imageManagerListing,
                              image,
                            });
                          }}
                          aria-label="حذف الصورة"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-36 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
                  لا توجد صور لهذا الإعلان
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col gap-4 px-3 py-4 sm:px-6 sm:py-5">
        <header className="smartstore-page-header flex shrink-0 items-center justify-between gap-2 px-1 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Link className="grid size-9 place-items-center rounded-md bg-white dark:bg-card" href="/account">
              <ArrowRight className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold sm:text-base">إعلاناتي</h1>
            </div>
          </div>
        </header>

        {isSessionLoading ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-[32rem] place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض حسابك</h2>
              </div>
              {authProviders.google ? (
                <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                  <a href="/api/auth/google/start">
                    <GoogleMark className="size-5" />
                    دخول Google
                  </a>
                </Button>
              ) : null}
              {authProviders.apple ? (
                <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                  <a href="/api/auth/apple/start">
                    <AppleMark className="size-5" />
                    دخول Apple
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            <section className="absolute left-3 top-4 z-10 flex shrink-0 flex-wrap items-center justify-start gap-3 px-1 sm:left-6 sm:top-5 sm:px-4">
              <div className="flex flex-wrap gap-2">
                <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                  <Link href="/">
                    <Megaphone className="size-4" />
                    إضافة إعلان
                  </Link>
                </Button>
              </div>
            </section>
            <FloatingActionNotice
              action={
                actionResult?.share ? (
                  <ListingShareButton
                    className="w-full justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                    listingId={actionResult.listingId}
                    title={actionResult.listingTitle}
                  />
                ) : undefined
              }
              closeLabel="إغلاق نتيجة الإجراء"
              durationMs={actionResult?.share ? 12000 : 10000}
              message={actionResult?.description}
              onDismiss={() => setActionResult(null)}
              open={Boolean(actionResult)}
              statusLabel={actionResult?.statusLabel}
              title={actionResult?.title}
              tone={actionResult?.tone ?? 'success'}
            />
            <FloatingActionNotice
              closeLabel="إغلاق تنبيه الصورة"
              message={imageActionNotice?.message}
              onDismiss={() => setImageActionNotice(null)}
              open={Boolean(imageActionNotice)}
              tone={imageActionNotice?.tone ?? 'success'}
            />

            <section
              className="marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain smartstore-fade-scroll px-1 pb-[var(--marketplace-bottom-nav-space)] pt-3 sm:px-4"
              id="account-listings"
            >
              {isListingsLoading && listings.length === 0 ? (
                <div className="grid gap-3">
                  <ListingCardSkeleton count={6} />
                </div>
              ) : listings.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed p-6 text-center">
                  <div className="grid max-w-sm gap-3">
                    <Megaphone className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد إعلانات بعد</h3>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="grid gap-3">
                    {listings.map((listing) => {
                      const pendingControlAction =
                        pendingListingControl?.listingId === listing.id
                          ? pendingListingControl.action
                          : null;
                      const isListingControlPending = Boolean(pendingControlAction);
                      const primaryImage =
                        listing.images.find((image) => image.isPrimary) ??
                        listing.images[0] ??
                        null;
                      const imageCount = listing.images.length;

                      return (
                      <article key={listing.id} className="marketplace-listing-card grid min-w-0 gap-3 rounded-md border border-slate-200/75 bg-white/88 p-2.5 shadow-sm [contain-intrinsic-size:220px] [content-visibility:auto] dark:border-white/10 dark:bg-card/72 sm:p-3">
                      <div className="grid min-w-0 grid-cols-[7.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                        <button
                          aria-label={primaryImage ? 'معاينة صور الإعلان' : 'إدارة صور الإعلان'}
                          className="group relative aspect-[4/3] min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100 text-start shadow-sm outline-none transition hover:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-white/10 dark:bg-slate-900"
                          onClick={() => {
                            if (primaryImage) {
                              setImagePreviewState({
                                listingId: listing.id,
                                imageId: primaryImage.id,
                              });
                              return;
                            }

                            setImageManagerListingId(listing.id);
                          }}
                          type="button"
                        >
                          {listing.image ? (
                            <ListingCardImage
                              alt={listing.title}
                              className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                              fallback={
                                <span className="grid h-full place-items-center text-slate-400">
                                  <ImageIcon className="size-8" />
                                </span>
                              }
                              height={116}
                              sizes="(min-width: 640px) 116px, 100px"
                              src={listing.image}
                              width={116}
                            />
                          ) : (
                            <span className="grid h-full place-items-center text-slate-400">
                              <ImageIcon className="size-8" />
                            </span>
                          )}
                          <span className="absolute right-2 top-2 rounded bg-blue-600 px-2 py-1 text-[11px] font-bold text-white shadow-sm">
                            {listing.status}
                          </span>
                          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-slate-950/78 px-2 py-1 text-[11px] font-semibold text-white shadow-sm">
                            <ImageIcon className="size-3.5" />
                            {formatImageCount(imageCount)}
                          </span>
                        </button>
                        <div className="grid min-w-0 content-start gap-2">
                          <div className="grid min-w-0 gap-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <h3 className="line-clamp-2 text-sm font-bold leading-6 text-slate-950 dark:text-card-foreground">
                                {listing.title}
                              </h3>
                              <span className="shrink-0 text-sm font-extrabold text-slate-950 dark:text-card-foreground">
                                {listing.price}
                              </span>
                            </div>
                            <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
                              {listing.description || 'لا يوجد وصف'}
                            </p>
                            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span className="truncate">{listing.category}</span>
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <MapPin className="size-3.5 shrink-0" />
                                <span className="truncate">{listing.city}</span>
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 rounded-md border border-slate-200/70 bg-slate-50/80 text-center text-[11px] text-muted-foreground dark:border-white/10 dark:bg-slate-950/20">
                            <span className="grid gap-0.5 border-l border-slate-200/70 px-1.5 py-2 dark:border-white/10">
                              <Eye className="mx-auto size-4 text-slate-500 dark:text-slate-300" />
                              <strong className="text-xs text-slate-950 dark:text-card-foreground">{listing.views}</strong>
                              <span>مشاهدة</span>
                            </span>
                            <span className="grid gap-0.5 border-l border-slate-200/70 px-1.5 py-2 dark:border-white/10">
                              <MessageCircle className="mx-auto size-4 text-slate-500 dark:text-slate-300" />
                              <strong className="text-xs text-slate-950 dark:text-card-foreground">{listing.messageCount}</strong>
                              <span>رسائل</span>
                            </span>
                            <span className="grid gap-0.5 px-1.5 py-2">
                              <Heart className="mx-auto size-4 text-slate-500 dark:text-slate-300" />
                              <strong className="text-xs text-slate-950 dark:text-card-foreground">{listing.favoriteCount}</strong>
                              <span>حفظ</span>
                            </span>
                          </div>
                          {listing.rawStatus === 'draft' && (
                            <div className="rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-2 text-[11px] font-bold leading-5 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100">
                              مسودة - غير منشور. لن يظهر الإعلان للعملاء حتى تضغط نشر الإعلان وتوافق على اتفاقية الرسوم.
                            </div>
                          )}
                        </div>
                      </div>
                      {editingListingId === listing.id && (
                        <div className="grid gap-2 border-t border-slate-200/60 px-2 py-3 dark:border-white/10 sm:px-3">
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
                            <CitySelector
                              className="[&_button]:bg-white dark:[&_button]:bg-card"
                              name={`listing-${listing.id}-city`}
                              onValueChange={(city) =>
                                setEditForm((current) => ({
                                  ...current,
                                  city,
                                }))
                              }
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
                              loading={savingListingId === listing.id}
                              loadingText="جاري الحفظ..."
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
                      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200/60 pt-2 dark:border-white/10 sm:grid-cols-3 xl:grid-cols-8">
                        {listing.rawStatus === 'published' && (
                          <Button asChild size="sm" variant="outline" className="rounded-md">
                            <Link href={`/listings/${listing.id}?source=account-listings`} prefetch={false}>
                              <Megaphone className="size-3.5" />
                              عرض
                            </Link>
                          </Button>
                        )}
                        {listing.rawStatus === 'published' && (
                          <ListingShareButton
                            className="rounded-md"
                            listingId={listing.id}
                            title={listing.title}
                          />
                        )}
                        {canEditListing(listing) && (
                        <Button size="sm" variant="outline" className="rounded-md" onClick={() => startEditingListing(listing)}>
                          <Pencil className="size-3.5" />
                          تعديل
                        </Button>
                        )}
                        {canEditListing(listing) && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-md"
                            loading={uploadingListingId === listing.id}
                            loadingText="جاري رفع الصور..."
                            onClick={() => setImageManagerListingId(listing.id)}
                          >
                            <Images className="size-3.5" />
                            إدارة الصور
                          </Button>
                        )}
                        {canPublishListing(listing) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-md"
                          disabled={isListingControlPending}
                          loading={pendingControlAction === 'publish'}
                          loadingText="جاري النشر..."
                          onClick={() => controlListing(listing, 'publish')}
                        >
                          <Megaphone className="size-3.5" />
                          نشر الإعلان
                        </Button>
                        )}
                        {canPauseListing(listing) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-md"
                          disabled={isListingControlPending}
                          loading={pendingControlAction === 'pause'}
                          loadingText="جاري الإيقاف..."
                          onClick={() => controlListing(listing, 'pause')}
                        >
                          <Pause className="size-3.5" />
                          إيقاف النشر
                        </Button>
                        )}
                        {canMarkListingSold(listing) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-md"
                          disabled={isListingControlPending}
                          loading={pendingControlAction === 'mark_sold'}
                          loadingText="جاري التحديث..."
                          onClick={() => controlListing(listing, 'mark_sold')}
                        >
                          <CheckCircle2 className="size-3.5" />
                          تم البيع
                        </Button>
                        )}
                        {listing.rawStatus === 'sold' && (
                          <Button asChild size="sm" variant="outline" className="rounded-md border-blue-500/40 text-blue-700 hover:bg-blue-50 dark:text-blue-200 dark:hover:bg-blue-400/10">
                            <Link href={`/commissions?listingId=${listing.id}`} prefetch={false}>
                              <Percent className="size-3.5" />
                              رسوم المنصة
                            </Link>
                          </Button>
                        )}
                        {canDeleteListing(listing) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-md"
                          disabled={isListingControlPending}
                          loading={pendingControlAction === 'delete'}
                          loadingText="جاري الحذف..."
                          onClick={() => controlListing(listing, 'delete')}
                        >
                          <Trash2 className="size-3.5" />
                          حذف الإعلان
                        </Button>
                        )}
                      </div>
                      </article>
                      );
                    })}
                    {isListingsLoading && listings.length > 0 && (
                      <ListingCardSkeleton count={3} />
                    )}
                  </div>
                  {listingsPagination?.hasMore && (
                    <div>
                      <div
                        ref={listingsLoadMoreRef}
                        aria-hidden="true"
                        className="h-24 w-full"
                      />
                    </div>
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
