'use client';
/* eslint-disable @next/next/no-img-element */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  ImageIcon,
  Pause,
  RefreshCw,
  Save,
  Search,
  Store,
  Trash2,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '../use-admin-access';

type AdminListing = {
  id: string;
  sellerId: string;
  seller?: { email: string; name: string | null } | null;
  category: string;
  title: string | null;
  description: string | null;
  price: number | 'bid' | 'negotiable' | null;
  priceMode: string | null;
  city: string | null;
  condition: 'new' | 'used' | 'like_new' | 'damaged' | null;
  status:
    | 'draft'
    | 'pending'
    | 'published'
    | 'paused'
    | 'sold'
    | 'rejected'
    | 'deleted';
  views: number;
  messageCount: number;
  favoriteCount: number;
  images: Array<{ id: string; thumbnailUrl: string; isPrimary: boolean }>;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
  total: number;
};

type ListingDraft = {
  title: string;
  description: string;
  category: string;
  city: string;
  condition: Exclude<AdminListing['condition'], null> | '';
  price: string;
  priceMode: 'fixed' | 'bid' | 'negotiable';
  status: AdminListing['status'];
};

const statusOptions: Array<{ value: AdminListing['status'] | 'all'; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'draft', label: 'مسودة' },
  { value: 'pending', label: 'قيد المراجعة' },
  { value: 'published', label: 'منشور' },
  { value: 'paused', label: 'موقوف' },
  { value: 'sold', label: 'مباع' },
  { value: 'rejected', label: 'مرفوض' },
  { value: 'deleted', label: 'محذوف' },
];

const conditionOptions = [
  { value: '', label: 'غير محدد' },
  { value: 'new', label: 'جديد' },
  { value: 'like_new', label: 'شبه جديد' },
  { value: 'used', label: 'مستعمل' },
  { value: 'damaged', label: 'يحتاج إصلاح' },
] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

function resolveDraftPriceMode(listing: AdminListing): ListingDraft['priceMode'] {
  if (listing.price === 'bid' || listing.priceMode === 'bid') {
    return 'bid';
  }

  if (listing.price === 'negotiable' || listing.priceMode === 'negotiable') {
    return 'negotiable';
  }

  return 'fixed';
}

function createDraft(listing: AdminListing): ListingDraft {
  return {
    title: listing.title ?? '',
    description: listing.description ?? '',
    category: listing.category,
    city: listing.city ?? '',
    condition: listing.condition ?? '',
    price: typeof listing.price === 'number' ? String(listing.price) : '',
    priceMode: resolveDraftPriceMode(listing),
    status: listing.status,
  };
}

function getListingsSectionTitle(
  focusedListingId: string,
  pagination: PaginationMeta | null,
) {
  if (focusedListingId) {
    return 'الإعلان المرتبط بالبلاغ';
  }

  const totalLabel = pagination ? ` (${formatNumber(pagination.total)})` : '';
  return `الإعلانات${totalLabel}`;
}

function getListingsEmptyMessage(focusedListingId: string) {
  return focusedListingId
    ? 'لم يتم العثور على الإعلان المرتبط بهذا البلاغ (قد يكون محذوفًا).'
    : 'لا توجد إعلانات.';
}

function AdminListingCard({
  listing,
  draft,
  canManageListings,
  onUpdateDraft,
  onSave,
  onDelete,
  onPermanentDelete,
}: Readonly<{
  listing: AdminListing;
  draft: ListingDraft;
  canManageListings: boolean;
  onUpdateDraft: (listingId: string, updates: Partial<ListingDraft>) => void;
  onSave: (listingId: string) => void;
  onDelete: (listingId: string) => void;
  onPermanentDelete: (listingId: string) => void;
}>) {
  return (
    <article className="grid gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold">{listing.title ?? 'إعلان بدون عنوان'}</h3>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>{listing.seller?.email ?? listing.sellerId}</span>
            <span>مشاهدات {formatNumber(listing.views)}</span>
            <span>رسائل {formatNumber(listing.messageCount)}</span>
            <span>حفظ {formatNumber(listing.favoriteCount)}</span>
          </div>
        </div>
        <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
          {statusOptions.find((option) => option.value === listing.status)?.label ?? listing.status}
        </span>
      </div>

      {listing.images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {listing.images.map((image) => (
            <div key={image.id} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-slate-100 dark:bg-slate-900">
              <img
                alt=""
                className="h-full w-full object-contain"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                  event.currentTarget.nextElementSibling?.removeAttribute('hidden');
                }}
                src={image.thumbnailUrl}
              />
              <span hidden>
                <ImageIcon className="size-5 text-slate-400" />
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-4">
        <Input disabled={!canManageListings} name={`listing-${listing.id}-title`} value={draft.title} onChange={(event) => onUpdateDraft(listing.id, { title: event.target.value })} placeholder="العنوان" />
        <Input disabled={!canManageListings} name={`listing-${listing.id}-category`} value={draft.category} onChange={(event) => onUpdateDraft(listing.id, { category: event.target.value })} placeholder="التصنيف" />
        <Input disabled={!canManageListings} name={`listing-${listing.id}-city`} value={draft.city} onChange={(event) => onUpdateDraft(listing.id, { city: event.target.value })} placeholder="المدينة" />
        <Input disabled={!canManageListings} name={`listing-${listing.id}-price`} value={draft.price} onChange={(event) => onUpdateDraft(listing.id, { price: event.target.value })} placeholder="السعر" type="number" />
      </div>

      <textarea
        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
        disabled={!canManageListings}
        name={`listing-${listing.id}-description`}
        value={draft.description}
        onChange={(event) =>
          onUpdateDraft(listing.id, { description: event.target.value })
        }
        placeholder="الوصف"
      />

      <div className="grid gap-2 md:grid-cols-3">
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={!canManageListings}
          name={`listing-${listing.id}-condition`}
          value={draft.condition}
          onChange={(event) =>
            onUpdateDraft(listing.id, {
              condition: event.target.value as ListingDraft['condition'],
            })
          }
        >
          {conditionOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={!canManageListings}
          name={`listing-${listing.id}-priceMode`}
          value={draft.priceMode}
          onChange={(event) =>
            onUpdateDraft(listing.id, {
              priceMode: event.target.value as ListingDraft['priceMode'],
            })
          }
        >
          <option value="fixed">سعر محدد</option>
          <option value="bid">على السوم</option>
          <option value="negotiable">قابل للتفاوض</option>
        </select>
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={!canManageListings}
          name={`listing-${listing.id}-status`}
          value={draft.status}
          onChange={(event) =>
            onUpdateDraft(listing.id, {
              status: event.target.value as AdminListing['status'],
            })
          }
        >
          {statusOptions
            .filter((option) => option.value !== 'all')
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </select>
      </div>

      {canManageListings && (
      <div className="grid gap-2 sm:grid-cols-4">
        <Button className="rounded-md bg-blue-600 hover:bg-blue-700" onClick={() => onSave(listing.id)}>
          <Save className="size-4" />
          حفظ
        </Button>
        <Button variant="outline" className="rounded-md" onClick={() => onUpdateDraft(listing.id, { status: 'published' })}>
          <CheckCircle2 className="size-4" />
          نشر
        </Button>
        <Button variant="outline" className="rounded-md" onClick={() => onUpdateDraft(listing.id, { status: 'paused' })}>
          <Pause className="size-4" />
          إيقاف
        </Button>
        {listing.status === 'deleted' ? (
          <Button
            variant="outline"
            className="rounded-md text-red-600 hover:text-red-700"
            onClick={() => onPermanentDelete(listing.id)}
          >
            <Trash2 className="size-4" />
            حذف نهائي
          </Button>
        ) : (
          <Button
            variant="outline"
            className="rounded-md"
            onClick={() => onDelete(listing.id)}
          >
            <Trash2 className="size-4" />
            حذف
          </Button>
        )}
      </div>
      )}
    </article>
  );
}

function AdminListingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusedListingId = searchParams.get('listingId')?.trim() ?? '';
  const {
    adminAccessRole,
    adminAccessNotice,
    isAdminAccessAllowed,
    verifyAdminAccess,
  } = useAdminAccess('moderator');
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ListingDraft>>({});
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminListing['status'] | 'all'>('all');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const queryRef = useRef(query);
  const statusRef = useRef(status);
  const focusedListingIdRef = useRef(focusedListingId);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    focusedListingIdRef.current = focusedListingId;
  }, [focusedListingId]);

  const loadListings = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setNotice('');

      try {
        if (!(await verifyAdminAccess())) {
          setListings([]);
          setPagination(null);
          setDrafts({});
          return;
        }

        const params = new URLSearchParams({
          page: String(page),
          limit: '24',
          status: statusRef.current,
        });

        if (focusedListingIdRef.current) {
          params.set('listingId', focusedListingIdRef.current);
        } else if (queryRef.current.trim()) {
          params.set('query', queryRef.current.trim());
        }

        const response = await fetch(`/api/admin/listings?${params}`, {
          cache: 'no-store',
        });

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (response.status === 403) {
          setNotice('هذه الصفحة مخصصة للفريق الإداري فقط.');
          return;
        }

        if (!response.ok) {
          setNotice('تعذر تحميل الإعلانات.');
          return;
        }

        const payload = (await response.json()) as {
          listings: AdminListing[];
          pagination: PaginationMeta;
        };

        setListings((current) =>
          page === 1 ? payload.listings : [...current, ...payload.listings],
        );
        setPagination(payload.pagination);
        setDrafts((current) => ({
          ...current,
          ...Object.fromEntries(
            payload.listings.map((listing) => [
              listing.id,
              current[listing.id] ?? createDraft(listing),
            ]),
          ),
        }));
      } finally {
        setIsLoading(false);
      }
    },
    [router, verifyAdminAccess],
  );

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadListings(1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadListings, status, focusedListingId]);

  useSmartstoreRealtime({
    enabled: isAdminAccessAllowed,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_created',
      'ad_updated',
      'ad_deleted',
      'ad_status_changed',
      'maintenance_cleanup',
    ],
    onEvent: () => {
      void loadListings(1);
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return loadListings(1);
    },
  });

  const listingsLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(pagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void loadListings(pagination?.nextPage ?? 1);
    },
  });
  const canManageListings =
    adminAccessRole === 'owner' || adminAccessRole === 'admin';

  const updateDraft = useCallback(
    (listingId: string, updates: Partial<ListingDraft>) => {
      setDrafts((current) => ({
        ...current,
        [listingId]: {
          ...current[listingId],
          ...updates,
        },
      }));
    },
    [],
  );

  const saveListing = useCallback(
    async (listingId: string) => {
      const draft = drafts[listingId];

      if (!draft) {
        return;
      }

      const body = {
        title: draft.title,
        description: draft.description,
        category: draft.category,
        city: draft.city || null,
        condition: draft.condition || null,
        price: draft.priceMode === 'fixed' ? Number(draft.price || 0) : null,
        priceMode: draft.priceMode === 'fixed' ? null : draft.priceMode,
        status: draft.status,
      };
      const response = await fetch(`/api/admin/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setNotice('تعذر حفظ الإعلان.');
        return;
      }

      setNotice('تم حفظ الإعلان.');
      await loadListings(1);
    },
    [drafts, loadListings],
  );

  const deleteListing = useCallback(
    async (listingId: string) => {
      if (!window.confirm('هل تريد حذف هذا الإعلان؟')) {
        return;
      }

      const response = await fetch(`/api/admin/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'deleted' }),
      });

      if (!response.ok) {
        setNotice('تعذر حذف الإعلان.');
        return;
      }

      setNotice('تم حذف الإعلان.');
      await loadListings(1);
    },
    [loadListings],
  );

  const permanentlyDeleteListing = useCallback(
    async (listingId: string) => {
      if (
        !window.confirm(
          'هل تريد حذف هذا الإعلان نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.',
        )
      ) {
        return;
      }

      const response = await fetch(`/api/admin/listings/${listingId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        setNotice('تعذر حذف الإعلان نهائيًا.');
        return;
      }

      setNotice('تم حذف الإعلان نهائيًا.');
      await loadListings(1);
    },
    [loadListings],
  );

  let listingsContent;

  if (isLoading && listings.length === 0) {
    listingsContent = (
      <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
        جار تحميل الإعلانات...
      </div>
    );
  } else if (listings.length === 0) {
    listingsContent = (
      <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
        {getListingsEmptyMessage(focusedListingId)}
      </div>
    );
  } else {
    listingsContent = (
      <div className="grid gap-3">
        {listings.map((listing) => (
          <AdminListingCard
            key={listing.id}
            listing={listing}
            draft={drafts[listing.id] ?? createDraft(listing)}
            canManageListings={canManageListings}
            onUpdateDraft={updateDraft}
            onSave={(listingId) => void saveListing(listingId)}
            onDelete={(listingId) => void deleteListing(listingId)}
            onPermanentDelete={(listingId) =>
              void permanentlyDeleteListing(listingId)
            }
          />
        ))}

        {!focusedListingId && pagination?.hasMore && (
          <div ref={listingsLoadMoreRef} className="h-px" />
        )}

        {!focusedListingId && pagination?.hasMore && (
          <Button
            variant="outline"
            className="mx-auto rounded-md"
            disabled={isLoading}
            onClick={() => void loadListings(pagination.nextPage ?? 1)}
          >
            تحميل المزيد
          </Button>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Store className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">إدارة الإعلانات</h1>
              <p className="truncate text-xs text-muted-foreground">
                تعديل وحذف وتغيير حالة كل إعلانات المنصة
              </p>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        {focusedListingId ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
            <div className="flex items-center gap-2 font-semibold">
              <Store className="size-4" />
              مراجعة إعلان محدد من البلاغ
            </div>
            <Button asChild variant="outline" className="rounded-md">
              <Link href="/admin/listings">
                <ArrowRight className="size-4" />
                عرض كل الإعلانات
              </Link>
            </Button>
          </section>
        ) : (
          <section className="grid gap-3 rounded-md border bg-white p-4 shadow-sm dark:bg-card md:grid-cols-[1fr_auto_auto]">
            <Input
              name="listingSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث بالعنوان أو البائع أو المدينة"
            />
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="listingStatusFilter"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as AdminListing['status'] | 'all')
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <Button className="rounded-md bg-blue-600 hover:bg-blue-700" onClick={() => void loadListings(1)}>
              <Search className="size-4" />
              بحث
            </Button>
          </section>
        )}

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">
              {getListingsSectionTitle(focusedListingId, pagination)}
            </h2>
            <Button variant="outline" className="rounded-md" onClick={() => void loadListings(1)}>
              <RefreshCw className="size-4" />
              تحديث
            </Button>
          </div>

          {listingsContent}
        </section>
      </div>
    </main>
  );
}

export default function AdminListingsPage() {
  return (
    <Suspense fallback={null}>
      <AdminListingsPageContent />
    </Suspense>
  );
}
