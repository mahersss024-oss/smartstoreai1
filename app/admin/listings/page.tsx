'use client';

import { AdminPageHeading } from '@/components/admin/page-heading';
import { AdminRecordPreview } from '@/components/admin/record-preview';
import { AdminResultsTable } from '@/components/admin/results-table';
import { listingEditIsDirty, listingEditPatch, reconcileListingEdit, type ListingDraft, type ListingEdit } from '@/components/admin/listing-edits';
import { useAdminRequest } from '@/components/admin/use-admin-request';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { formatMarketplaceCategory, marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import { CategoryOptionSelect } from '@/components/category-option-select';
import { CarModelSelect } from '@/components/car-model-select';
import { getListingCarModel, getListingCategoryOption } from '@/lib/marketplace/category-options';
import { getListingDisplayUrl } from '@/agent/marketplace/listing-image-delivery';
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
  Megaphone,
  ExternalLink,
  Trash2,
} from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { CitySelector } from '@/components/city-selector';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { ResilientImage } from '@/components/resilient-image';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '../use-admin-access';

type AdminListing = {
  attributes?: Record<string, unknown>;
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
  updatedAt?: string;
  images: Array<{ id: string; originalUrl?: string; displayUrl?: string; thumbnailUrl: string; isPrimary: boolean }>;
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
  total: number;
};

type AdminListingActionNotice = {
  tone: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  message: string;
  statusLabel?: string;
};

type PendingAdminListingAction =
  | { listingId: string; action: 'save' }
  | { listingId: string; action: 'delete' }
  | { listingId: string; action: 'permanent_delete' };

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
    categoryOption: getListingCategoryOption(listing)?.id ?? '',
    carModel: getListingCarModel(listing)?.id ?? '',
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
  pendingAction,
  saveBlocked,
}: Readonly<{
  listing: AdminListing;
  draft: ListingDraft;
  canManageListings: boolean;
  onUpdateDraft: (listingId: string, updates: Partial<ListingDraft>) => void;
  onSave: (listingId: string) => void;
  onDelete: (listingId: string) => void;
  onPermanentDelete: (listingId: string) => void;
  pendingAction: PendingAdminListingAction | null;
  saveBlocked: boolean;
}>) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const activeImage = listing.images.find(image => image.id === activeImageId) ?? listing.images.find(image => image.isPrimary) ?? listing.images[0];
  const isSaving =
    pendingAction?.listingId === listing.id && pendingAction.action === 'save';
  const isDeleting =
    pendingAction?.listingId === listing.id && pendingAction.action === 'delete';
  const isPermanentlyDeleting =
    pendingAction?.listingId === listing.id &&
    pendingAction.action === 'permanent_delete';
  const isActionPending = Boolean(pendingAction);
  const isEditingDisabled = !canManageListings || isActionPending;

  return (
    <article className="admin-record">
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

      {activeImage && <div className="grid aspect-[4/3] max-h-80 place-items-center overflow-hidden rounded-md border bg-background"><ResilientImage src={getListingDisplayUrl(activeImage)!} fallbackSrcs={[activeImage.originalUrl, activeImage.thumbnailUrl].filter((url): url is string => Boolean(url))} alt={listing.title ?? 'صورة الإعلان'} className="h-full w-full object-contain" fallback={<ImageIcon className="size-8 text-muted-foreground" />} /></div>}
      {listing.images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {listing.images.map((image) => (
            <button type="button" aria-label={`عرض صورة الإعلان ${listing.images.indexOf(image) + 1}`} aria-pressed={activeImage?.id === image.id} onClick={() => setActiveImageId(image.id)} key={image.id} className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background aria-pressed:border-primary">
              <ResilientImage
                alt=""
                className="h-full w-full object-contain"
                decoding="async"
                fallback={<ImageIcon className="size-5 text-slate-400" />}
                loading="lazy"
                src={image.thumbnailUrl}
              />
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="admin-field">العنوان<Input disabled={isEditingDisabled} name={`listing-${listing.id}-title`} value={draft.title} onChange={(event) => onUpdateDraft(listing.id, { title: event.target.value })} placeholder="العنوان" /></label>
        <label className="admin-field">التصنيف<select className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm" disabled={isEditingDisabled} name={`listing-${listing.id}-category`} value={draft.category} onChange={event => onUpdateDraft(listing.id, { category: event.target.value, categoryOption: '', carModel: '' })}>
          {!marketplaceCategoryDefinitions.some(category => category.id === draft.category) && <option value={draft.category}>{formatMarketplaceCategory(draft.category)}</option>}
          {marketplaceCategoryDefinitions.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
        </select></label>
        <CategoryOptionSelect id={`listing-${listing.id}-category-option`} disabled={isEditingDisabled} category={draft.category} value={draft.categoryOption}
          onChange={categoryOption => onUpdateDraft(listing.id, { categoryOption, carModel: '' })} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" />
        <CarModelSelect id={`listing-${listing.id}-car-model`} disabled={isEditingDisabled} category={draft.category} brand={draft.categoryOption} value={draft.carModel}
          onChange={carModel => onUpdateDraft(listing.id, { carModel })} className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" />
        <div className="admin-field"><span>المدينة</span><CitySelector disabled={isEditingDisabled} name={`listing-${listing.id}-city`} value={draft.city} onValueChange={(city) => onUpdateDraft(listing.id, { city })} /></div>
        <label className="admin-field">السعر<Input disabled={isEditingDisabled} name={`listing-${listing.id}-price`} value={draft.price} onChange={(event) => onUpdateDraft(listing.id, { price: event.target.value })} placeholder="السعر" type="number" /></label>
      </div>

      <div className="admin-field"><label htmlFor={`listing-${listing.id}-description`}>الوصف</label><textarea
        id={`listing-${listing.id}-description`}
        className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm"
        disabled={isEditingDisabled}
        name={`listing-${listing.id}-description`}
        value={draft.description}
        onChange={(event) =>
          onUpdateDraft(listing.id, { description: event.target.value })
        }
        placeholder="الوصف"
      /></div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="admin-field">حالة المنتج<select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={isEditingDisabled}
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
        </select></label>
        <label className="admin-field">طريقة السعر<select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={isEditingDisabled}
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
        </select></label>
        <label className="admin-field">حالة الإعلان<select
          className="h-10 rounded-md border bg-background px-3 text-sm"
          disabled={isEditingDisabled}
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
        </select></label>
      </div>

      {canManageListings && (
      <div className="admin-actions">
        <Button asChild variant="outline"><Link href={`/listings/${encodeURIComponent(listing.id)}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />فتح صفحة الإعلان</Link></Button>
        <Button
          className="rounded-md bg-blue-600 hover:bg-blue-700"
          disabled={saveBlocked || (isActionPending && !isSaving)}
          loading={isSaving}
          loadingText="جاري الحفظ..."
          onClick={() => onSave(listing.id)}
        >
          <Save className="size-4" />
          حفظ
        </Button>
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isActionPending}
          onClick={() => onUpdateDraft(listing.id, { status: 'published' })}
        >
          <CheckCircle2 className="size-4" />
          نشر الإعلان
        </Button>
        <Button
          variant="outline"
          className="rounded-md"
          disabled={isActionPending}
          onClick={() => onUpdateDraft(listing.id, { status: 'paused' })}
        >
          <Pause className="size-4" />
          إيقاف
        </Button>
        {listing.status === 'deleted' ? (
          <Button
            variant="outline"
            className="rounded-md text-red-600 hover:text-red-700"
            disabled={isActionPending && !isPermanentlyDeleting}
            loading={isPermanentlyDeleting}
            loadingText="جاري الحذف..."
            onClick={() => onPermanentDelete(listing.id)}
          >
            <Trash2 className="size-4" />
            حذف نهائي
          </Button>
        ) : (
          <Button
            variant="outline"
            className="rounded-md"
            disabled={isActionPending && !isDeleting}
            loading={isDeleting}
            loadingText="جاري الحذف..."
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
  const sellerId = searchParams.get('sellerId')?.trim() ?? '';
  const {
    adminAccessRole,
    adminAccessNotice,
    isAdminAccessAllowed,
    verifyAdminAccess,
  } = useAdminAccess('moderator');
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(focusedListingId || null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [edits, setEdits] = useState<Record<string, ListingEdit>>({});
  const [query, setQuery] = useState(searchParams.get('query')?.trim() ?? '');
  const [status, setStatus] = useState<AdminListing['status'] | 'all'>(() => statusOptions.find(option => option.value === searchParams.get('status'))?.value ?? 'all');
  const [category, setCategory] = useState('');
  const [categoryOption, setCategoryOption] = useState('');
  const [carModel, setCarModel] = useState('');
  const [appliedFilters, setAppliedFilters] = useState(() => ({ query, status, category: '', categoryOption: '', carModel: '' }));
  const [notice, setNotice] = useState('');
  const [actionNotice, setActionNotice] =
    useState<AdminListingActionNotice | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingAdminListingAction | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDeleteAction, setPendingDeleteAction] = useState<{
    listingId: string;
    permanent: boolean;
  } | null>(null);
  const { begin: beginLoad, invalidate: invalidateLoad } = useAdminRequest(isAdminAccessAllowed,
    JSON.stringify([appliedFilters, focusedListingId, sellerId]));

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled && focusedListingId) setSelectedId(focusedListingId); });
    return () => { cancelled = true; };
  }, [focusedListingId]);

  const loadListings = useCallback(
    async (page = 1) => {
      const request = beginLoad();
      setIsLoading(true);
      setNotice('');

      try {
        if (!(await verifyAdminAccess())) {
          if (!request.isCurrent()) return;
          setListings([]);
          setPagination(null);
          setEdits({});
          return;
        }
        if (!request.isCurrent()) return;

        const params = new URLSearchParams({
          page: String(page),
          limit: '24',
        });
        if (focusedListingId) {
          params.set('listingId', focusedListingId);
        } else {
          params.set('status', appliedFilters.status);
          if (sellerId) params.set('sellerId', sellerId);
          for (const key of ['query', 'category', 'categoryOption', 'carModel'] as const) {
            if (appliedFilters[key].trim()) params.set(key, appliedFilters[key].trim());
          }
        }

        const response = await fetch(`/api/admin/listings?${params}`, {
          cache: 'no-store',
          signal: request.signal,
        });
        if (!request.isCurrent()) return;

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
        if (!request.isCurrent()) return;

        setListings((current) =>
          page === 1 ? payload.listings : [...current, ...payload.listings.filter(listing => !current.some(row => row.id === listing.id))],
        );
        setPagination(payload.pagination);
        setEdits((current) => ({
          ...current,
          ...Object.fromEntries(
            payload.listings.map((listing) => [
              listing.id,
              reconcileListingEdit(current[listing.id], createDraft(listing)),
            ]),
          ),
        }));
      } catch {
        if (request.isCurrent()) setNotice('تعذر الاتصال لتحميل الإعلانات. حاول مجددًا.');
      } finally {
        if (request.isCurrent()) setIsLoading(false);
      }
    },
    [router, verifyAdminAccess, sellerId, focusedListingId, appliedFilters, beginLoad, setIsLoading, setNotice, setListings, setPagination, setEdits],
  );

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    if (!isAdminAccessAllowed) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadListings(1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isAdminAccessAllowed, loadListings]);

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
    adminAccessRole === 'owner' ||
    adminAccessRole === 'admin' ||
    adminAccessRole === 'moderator';
  const selectedIndex = listings.findIndex(listing => listing.id === selectedId);
  const selectedListing = listings[selectedIndex];
  const listingIsDirty = (listing: AdminListing) => listingEditIsDirty(edits[listing.id]);
  const clearFilters = () => {
    setQuery(''); setStatus('all'); setCategory(''); setCategoryOption(''); setCarModel('');
    setAppliedFilters({ query: '', status: 'all', category: '', categoryOption: '', carModel: '' });
  };

  const updateDraft = useCallback(
    (listingId: string, updates: Partial<ListingDraft>) => {
      setEdits((current) => ({
        ...current,
        [listingId]: {
          ...current[listingId],
          draft: { ...current[listingId].draft, ...updates },
          conflicts: current[listingId].conflicts.filter(field =>
            (updates[field] ?? current[listingId].draft[field]) !== current[listingId].base[field]),
        },
      }));
    },
    [setEdits],
  );

  const saveListing = useCallback(
    async (listingId: string) => {
      const edit = edits[listingId];
      const listing = listings.find(row => row.id === listingId);

      if (!edit || !listing || edit.conflicts.length) {
        return;
      }

      const body = listingEditPatch(edit);
      if (!Object.keys(body).length) return;
      invalidateLoad();
      setPendingAction({ listingId, action: 'save' });
      setActionNotice(null);

      try {
        const response = await fetch(`/api/admin/listings/${listingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, ...(listing.updatedAt ? { expectedUpdatedAt: listing.updatedAt } : {}) }),
        });

        if (response.status === 409) {
          await loadListings(1);
          setActionNotice({ tone: 'warning', message: 'تغير الإعلان أثناء التعديل. حُمّلت البيانات الحالية؛ راجع مسودتك قبل الحفظ مجددًا.' });
          return;
        }

        if (!response.ok) {
          setActionNotice({
            tone: 'danger',
            message: 'تعذر حفظ الإعلان.',
          });
          return;
        }

        const payload = await response.json().catch(() => null) as { listing?: Partial<AdminListing> } | null;
        const saved = { ...listing, ...payload?.listing };
        // Clear submitted changes before realtime/load rebases against the saved record.
        setEdits(current => ({ ...current, [listingId]: reconcileListingEdit(undefined,
          payload?.listing ? createDraft(saved) : edit.draft) }));
        setListings(current => current.map(row => row.id === listingId ? saved : row));
        setActionNotice({
          tone: 'success',
          title: 'تم حفظ الإعلان',
          message: 'تم تحديث بيانات الإعلان في لوحة الإدارة.',
          statusLabel:
            statusOptions.find((option) => option.value === edit.draft.status)
              ?.label ?? edit.draft.status,
        });
        await loadListings(1);
      } catch {
        setActionNotice({ tone: 'danger', message: 'تعذر الاتصال لحفظ الإعلان. بقيت تعديلاتك في المسودة.' });
      } finally {
        setPendingAction(null);
      }
    },
    [edits, listings, loadListings, invalidateLoad, setPendingAction, setActionNotice, setEdits, setListings],
  );

  const deleteListing = useCallback(
    async (listingId: string) => {
      const listing = listings.find(row => row.id === listingId);
      setPendingDeleteAction(null);
      invalidateLoad();
      setPendingAction({ listingId, action: 'delete' });
      setActionNotice(null);

      try {
        const response = await fetch(`/api/admin/listings/${listingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'deleted', ...(listing?.updatedAt ? { expectedUpdatedAt: listing.updatedAt } : {}) }),
        });

        if (response.status === 409) {
          await loadListings(1);
          setActionNotice({ tone: 'warning', message: 'تغير الإعلان قبل الحذف. راجع البيانات الحالية ثم أعد المحاولة.' });
          return;
        }

        if (!response.ok) {
          setActionNotice({
            tone: 'danger',
            message: 'تعذر حذف الإعلان.',
          });
          return;
        }

        setEdits(current => {
          const edit = current[listingId];
          return edit ? { ...current, [listingId]: { base: { ...edit.base, status: 'deleted' },
            draft: { ...edit.draft, status: 'deleted' }, conflicts: edit.conflicts.filter(field => field !== 'status') } } : current;
        });
        setActionNotice({
          tone: 'success',
          title: 'تم حذف الإعلان',
          message: 'تم نقل الإعلان إلى حالة محذوف.',
          statusLabel: 'محذوف',
        });
        await loadListings(1);
      } catch {
        setActionNotice({ tone: 'danger', message: 'تعذر الاتصال لحذف الإعلان. حاول مجددًا.' });
      } finally {
        setPendingAction(null);
      }
    },
    [loadListings, listings, invalidateLoad, setPendingDeleteAction, setPendingAction, setActionNotice, setEdits],
  );

  const permanentlyDeleteListing = useCallback(
    async (listingId: string) => {
      setPendingDeleteAction(null);
      invalidateLoad();
      setPendingAction({ listingId, action: 'permanent_delete' });
      setActionNotice(null);

      try {
        const response = await fetch(`/api/admin/listings/${listingId}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          setActionNotice({
            tone: 'danger',
            message: ((await response.json().catch(() => null)) as { message?: string } | null)?.message ?? 'تعذر حذف الإعلان نهائيًا.',
          });
          return;
        }

        setActionNotice({
          tone: 'success',
          title: 'تم حذف الإعلان نهائيًا',
          message: 'تم حذف الإعلان وسجلاته المرتبطة من لوحة الإدارة.',
        });
        await loadListings(1);
      } catch {
        setActionNotice({ tone: 'danger', message: 'تعذر الاتصال لحذف الإعلان نهائيًا. حاول مجددًا.' });
      } finally {
        setPendingAction(null);
      }
    },
    [loadListings, invalidateLoad, setPendingDeleteAction, setPendingAction, setActionNotice],
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
        <AdminResultsTable
          columns={['الإعلان', 'المعلن', 'المدينة', 'السعر', 'الحالة']}
          selectedId={selectedId}
          onOpen={setSelectedId}
          rows={listings.map(listing => ({
            id: listing.id, label: listing.title ?? 'إعلان بدون عنوان', dirty: listingIsDirty(listing),
            cells: [<span key="title" className="admin-listing-identity">{listing.images[0] ? <ResilientImage alt="" src={listing.images[0].thumbnailUrl} className="admin-result-image" /> : <ImageIcon className="size-8 shrink-0 text-muted-foreground" />}<strong>{listing.title ?? 'إعلان بدون عنوان'}</strong></span>, listing.seller?.name ?? listing.seller?.email ?? 'غير متوفر', listing.city ?? 'غير محددة', typeof listing.price === 'number' ? `${formatNumber(listing.price)} ر.س` : listing.price === 'bid' || listing.priceMode === 'bid' ? 'على السوم' : listing.price === 'negotiable' || listing.priceMode === 'negotiable' ? 'قابل للتفاوض' : 'غير محدد', <span key="status" className="admin-status">{statusOptions.find(option => option.value === listing.status)?.label ?? listing.status}</span>],
          }))}
        />
        {selectedListing && <AdminRecordPreview
          open title="معاينة الإعلان" dirty={listingIsDirty(selectedListing)} busy={Boolean(pendingAction) || Boolean(pendingDeleteAction)}
          onClose={() => setSelectedId(null)}
          onPrevious={selectedIndex > 0 ? () => setSelectedId(listings[selectedIndex - 1].id) : undefined}
          onNext={selectedIndex < listings.length - 1 ? () => setSelectedId(listings[selectedIndex + 1].id) : undefined}
        >
          {Boolean(edits[selectedListing.id]?.conflicts.length) && <div role="alert" className="grid gap-3 rounded-md border border-amber-500/40 p-3 text-sm">
            <p>تغيرت هذه البيانات أثناء تعديلك. راجع القيم الحالية قبل الحفظ:</p>
            <dl className="grid gap-2">{edits[selectedListing.id].conflicts.map(field => <div key={field}>
              <dt className="font-semibold">{({ title: 'العنوان', description: 'الوصف', category: 'التصنيف', categoryOption: 'نوع التصنيف', carModel: 'الموديل', city: 'المدينة', condition: 'حالة المنتج', price: 'السعر', priceMode: 'طريقة السعر', status: 'حالة الإعلان' })[field]}</dt>
              <dd className="whitespace-pre-wrap break-words">{field === 'status' ? statusOptions.find(option => option.value === edits[selectedListing.id].base.status)?.label : edits[selectedListing.id].base[field] || 'غير محدد'}</dd>
            </div>)}</dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEdits(current => ({ ...current,
                [selectedListing.id]: reconcileListingEdit(undefined, current[selectedListing.id].base) }))}>استخدام البيانات الحالية</Button>
              <Button variant="outline" onClick={() => setEdits(current => ({ ...current,
                [selectedListing.id]: { ...current[selectedListing.id], conflicts: [] } }))}>الاحتفاظ بتعديلاتي</Button>
            </div>
          </div>}
          <AdminListingCard
            key={selectedListing.id}
            listing={selectedListing}
            draft={edits[selectedListing.id]?.draft ?? createDraft(selectedListing)}
            saveBlocked={!listingIsDirty(selectedListing) || Boolean(edits[selectedListing.id]?.conflicts.length)}
            canManageListings={canManageListings}
            onUpdateDraft={updateDraft}
            onSave={(listingId) => void saveListing(listingId)}
            onDelete={(listingId) =>
              setPendingDeleteAction({ listingId, permanent: false })
            }
            onPermanentDelete={(listingId) =>
              setPendingDeleteAction({ listingId, permanent: true })
            }
            pendingAction={pendingAction}
          />
        </AdminRecordPreview>}

        {!focusedListingId && pagination?.hasMore && (
          <div>
            <div
              ref={listingsLoadMoreRef}
              aria-hidden="true"
              className="h-24 w-full"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <ActionConfirmDialog
        confirmLabel={
          pendingDeleteAction?.permanent ? 'حذف نهائي' : 'حذف الإعلان'
        }
        description={
          pendingDeleteAction?.permanent
            ? 'سيتم حذف هذا الإعلان نهائيًا ولا يمكن التراجع عن هذا الإجراء.'
            : 'سيتم نقل هذا الإعلان إلى حالة محذوف.'
        }
        onCancel={() => setPendingDeleteAction(null)}
        onConfirm={() => {
          if (!pendingDeleteAction) {
            return;
          }

          if (pendingDeleteAction.permanent) {
            void permanentlyDeleteListing(pendingDeleteAction.listingId);
          } else {
            void deleteListing(pendingDeleteAction.listingId);
          }
        }}
        open={Boolean(pendingDeleteAction)}
        title={
          pendingDeleteAction?.permanent
            ? 'تأكيد الحذف النهائي'
            : 'تأكيد حذف الإعلان'
        }
        tone="danger"
      />
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء الإدارة"
        message={actionNotice?.message}
        onDismiss={() => setActionNotice(null)}
        open={Boolean(actionNotice)}
        statusLabel={actionNotice?.statusLabel}
        title={actionNotice?.title}
        tone={actionNotice?.tone ?? 'info'}
      />
      <div className="admin-page">
        <AdminPageHeading title="إدارة الإعلانات" />
        {sellerId && <div className="admin-notice flex flex-wrap justify-between gap-2"><span>إعلانات الحساب المحدد</span><Link href="/admin/listings" onClick={clearFilters} prefetch={false} className="text-primary underline">عرض كل الإعلانات</Link></div>}

        {focusedListingId ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
            <div className="flex items-center gap-2 font-semibold">
              <Megaphone className="size-4" />
              مراجعة إعلان محدد من البلاغ
            </div>
            <Button asChild variant="outline" className="rounded-md">
              <Link href="/admin/listings" onClick={clearFilters}>
                <ArrowRight className="size-4" />
                عرض كل الإعلانات
              </Link>
            </Button>
          </section>
        ) : (
          <form className="admin-filterbar grid items-end gap-3 md:grid-cols-2 xl:grid-cols-3" onSubmit={event => {
            event.preventDefault();
            const next = { query: query.trim(), status, category, categoryOption, carModel };
            if (JSON.stringify(next) === JSON.stringify(appliedFilters)) void loadListings(1);
            else setAppliedFilters(next);
          }}>
            <Input
              name="listingSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث برقم الإعلان أو العنوان أو المعلن أو المدينة"
              aria-label="بحث الإعلانات"
            />
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              name="listingStatusFilter"
              aria-label="تصفية حالة الإعلان"
              value={status}
              onChange={(event) => {
                const value = event.target.value as AdminListing['status'] | 'all';
                setStatus(value);
                setAppliedFilters(current => ({ ...current, status: value }));
              }}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="grid min-w-0 gap-2 text-sm">التصنيف
              <select className="h-10 min-w-0 rounded-md border bg-background px-3 text-sm" name="listingCategoryFilter" value={category}
                onChange={event => { setCategory(event.target.value); setCategoryOption(''); setCarModel(''); }}>
                <option value="">كل التصنيفات</option>
                {marketplaceCategoryDefinitions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <CategoryOptionSelect id="admin-listing-category-option-filter" category={category} value={categoryOption} onChange={value => { setCategoryOption(value); setCarModel(''); }} all
              className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" />
            <CarModelSelect id="admin-listing-car-model-filter" category={category} brand={categoryOption} value={carModel} onChange={setCarModel} all
              className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm" />
            <Button type="submit" className="rounded-md bg-blue-600 hover:bg-blue-700">
              <Search className="size-4" />
              بحث
            </Button>
          </form>
        )}

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="admin-section">
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
