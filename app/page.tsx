'use client';
/* eslint-disable @next/next/no-img-element */

import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DefaultChatTransport, type ChatStatus, type FileUIPart, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  Bell,
  Bot,
  Heart,
  ImageIcon,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
  Square,
  Store,
  Trash2,
  User,
  X,
} from 'lucide-react';

import {
  Conversation,
  ConversationAutoScroll,
  ConversationContent,
  ConversationScrollButton,
} from '@chat-elements/conversation';
import {
  Message,
  MessageAttachment,
  MessageContent,
  MessageResponse,
} from '@chat-elements/message';
import {
  PromptInput,
  PromptInputBody,
  type PromptInputMessage,
  PromptInputTextarea,
  usePromptInputAttachments,
} from '@chat-elements/prompt-input';
import { SearchStatusIndicator } from '@/components/search-status-indicator';
import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import {
  chatServiceUnavailableMessage,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';
import {
  getAssistantResultListings,
  getCanLoadMoreExploreListings,
  getExploreListings,
} from '@/lib/chat-listing-display';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { Button } from '@ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';
import { cn } from '@/lib/utils';

type LocationSettings = {
  country: 'SA';
  currency: string;
  language: 'ar';
};

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

type ListingCard = {
  id?: string;
  sellerId?: string;
  title: string;
  price: string;
  city: string;
  image: string | null;
  category?: string;
  status?: string;
  stats?: string;
  description?: string;
};

type SelectedListingContext = Pick<
  ListingCard,
  'id' | 'title' | 'price' | 'city' | 'category' | 'status' | 'description'
>;

type ApiListingRecord = {
  id: string;
  sellerId?: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  image?: string;
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

type ListingsResponsePayload = {
  listings?: ApiListingRecord[];
  pagination?: {
    page?: number;
    limit?: number;
    hasMore?: boolean;
    nextPage?: number | null;
  };
};

type FavoriteListingRecord = {
  listingId: string;
};

type ClientIntentKind =
  | 'general_info'
  | 'search_listing'
  | 'create_listing'
  | 'open_conversation'
  | 'compare_listings'
  | 'image_review';

type ClientIntentState = {
  kind: ClientIntentKind;
  label: string;
};

type AssistantState = 'expanded' | 'collapsed';

type RetainedListingImage = Pick<
  FileUIPart,
  'type' | 'url' | 'mediaType' | 'filename'
>;

const authRequiredMarker = '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]]';
const chatRateLimitMessage =
  'الضغط مرتفع الآن على مساعد SmartStore AI. انتظر لحظات ثم أعد إرسال الطلب.';
const locationSettings: LocationSettings = {
  country: 'SA',
  currency: 'SAR',
  language: 'ar',
};
const currentChatStorageKey = 'smartstore-current-chat-v1';
const retainedListingImagesDatabaseName = 'smartstore-listing-images-v1';
const retainedListingImagesStoreName = 'listing-images';
const retainedListingImagesRecordKey = 'latest';
const assistantDragThreshold = 60;
const chatMaxAttachments = 8;
const chatInputGroupStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '3.35rem minmax(0, 1fr) 3.35rem',
  height: 'auto',
  minHeight: '4.75rem',
};
const chatInputTextAreaStyle: CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  minHeight: '3.5rem',
};
const chatSubmitButtonStyle: CSSProperties = {
  gridColumn: '1',
  gridRow: '2',
  height: '2.75rem',
  width: '2.75rem',
};
const chatAttachmentControlsStyle: CSSProperties = {
  gridColumn: '3',
  gridRow: '2',
};

type PendingChatAttachment = FileUIPart & { id: string };

function getAttachmentLabel(file: PendingChatAttachment) {
  return file.filename || (file.mediaType?.startsWith('image/') ? 'صورة مرفقة' : 'ملف مرفق');
}

function ChatAttachmentPreviewStrip({ maxFiles }: { maxFiles: number }) {
  const attachments = usePromptInputAttachments();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const files = attachments.files;
  const safePreviewIndex =
    previewIndex === null || files.length === 0 ? null : Math.min(previewIndex, files.length - 1);
  const previewFile = safePreviewIndex === null ? null : files[safePreviewIndex] ?? null;

  if (files.length === 0) {
    return null;
  }

  const closePreview = () => setPreviewIndex(null);
  const showPrevious = () => {
    setPreviewIndex((current) => {
      const activeIndex = current ?? 0;
      return (activeIndex - 1 + files.length) % files.length;
    });
  };
  const showNext = () => {
    setPreviewIndex((current) => {
      const activeIndex = current ?? 0;
      return (activeIndex + 1) % files.length;
    });
  };
  const removePreviewFile = () => {
    if (!previewFile) {
      return;
    }

    attachments.remove(previewFile.id);
    if (files.length <= 1) {
      setPreviewIndex(null);
    } else {
      setPreviewIndex((current) => Math.min(current ?? 0, files.length - 2));
    }
  };

  return (
    <>
      <div
        className="col-span-full border-b border-slate-700/70 bg-slate-950/20 px-3 py-2"
        dir="rtl"
      >
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-slate-300">
          <span>معاينة قبل الإرسال</span>
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 font-semibold text-blue-200">
            {files.length} / {maxFiles}
          </span>
        </div>
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
          {files.map((file, index) => {
            const isImage = file.mediaType?.startsWith('image/') && file.url;

            return (
              <button
                aria-label={`معاينة ${getAttachmentLabel(file)}`}
                className={cn(
                  'group relative h-20 w-20 shrink-0 snap-start overflow-hidden rounded-xl border bg-slate-900 text-slate-300 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
                  safePreviewIndex === index ? 'border-blue-400 ring-2 ring-blue-400/40' : 'border-slate-700/80',
                )}
                key={file.id}
                onClick={() => setPreviewIndex(index)}
                type="button"
              >
                {isImage ? (
                  <img
                    alt={getAttachmentLabel(file)}
                    className="size-full object-cover"
                    src={file.url}
                  />
                ) : (
                  <div className="grid size-full place-items-center px-2 text-center text-[10px] leading-4">
                    {getAttachmentLabel(file)}
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-1 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100">
                  تكبير
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {previewFile && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/82 p-4 backdrop-blur-md"
          onClick={closePreview}
          role="dialog"
        >
          <div
            className="relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl"
            dir="rtl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{getAttachmentLabel(previewFile)}</p>
                <p className="text-xs text-slate-400">قبل الإرسال</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  aria-label="حذف الصورة"
                  className="rounded-xl text-red-200 hover:bg-red-500/15 hover:text-red-100"
                  onClick={removePreviewFile}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  aria-label="إغلاق المعاينة"
                  className="rounded-xl"
                  onClick={closePreview}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <div className="relative grid min-h-[18rem] place-items-center bg-slate-900/80 p-3">
              {previewFile.mediaType?.startsWith('image/') && previewFile.url ? (
                <img
                  alt={getAttachmentLabel(previewFile)}
                  className="max-h-[68dvh] max-w-full rounded-xl object-contain"
                  src={previewFile.url}
                />
              ) : (
                <div className="rounded-xl border border-white/10 px-6 py-8 text-center text-slate-200">
                  {getAttachmentLabel(previewFile)}
                </div>
              )}
              {files.length > 1 && (
                <>
                  <Button
                    aria-label="الصورة السابقة"
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                    onClick={showPrevious}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronRight className="size-5" />
                  </Button>
                  <Button
                    aria-label="الصورة التالية"
                    className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                    onClick={showNext}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatAttachmentControls() {
  const attachments = usePromptInputAttachments();

  return (
    <div
      className="m-2 flex h-11 items-center justify-end gap-1 self-end"
      dir="ltr"
      style={chatAttachmentControlsStyle}
    >
      <Button
        aria-label="إرفاق صور المنتج"
        className="size-10 rounded-2xl border border-border/80 bg-card text-primary shadow-sm hover:bg-accent hover:text-primary dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
        onClick={attachments.openFileDialog}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <Plus className="size-5" />
      </Button>
    </div>
  );
}

function ChatSubmitButton({ status }: { status: ChatStatus }) {
  const isBusy = status === 'submitted' || status === 'streaming';

  return (
    <Button
      aria-label={isBusy ? 'جار الإرسال' : 'إرسال'}
      className="col-start-1 row-start-2 m-2 size-11 self-end rounded-2xl bg-sky-400 text-slate-950 shadow-lg shadow-sky-950/20 transition duration-200 hover:bg-sky-300 disabled:opacity-80"
      disabled={isBusy}
      size="icon-sm"
      style={chatSubmitButtonStyle}
      type="submit"
    >
      {status === 'submitted' ? (
        <Loader2 className="size-5 animate-spin" />
      ) : status === 'streaming' ? (
        <Square className="size-4" />
      ) : (
        <SendHorizontal className="size-5" />
      )}
    </Button>
  );
}

const featuredListings: ListingCard[] = [];

const starters = [
  'أريد بيع منتج',
  'أبحث عن سيارة في الرياض',
  'افحص صور الإعلان',
];

const defaultClientIntent: ClientIntentState = {
  kind: 'general_info',
  label: 'بانتظار طلب العميل',
};

function inferClientIntent(text: string, hasFiles = false): ClientIntentState {
  const normalized = text.trim().toLowerCase();

  if (hasFiles || /صور|صورة|ارفق|رفع|افحص|وضوح|دقة|طمس|تحسين/.test(normalized)) {
    return {
      kind: 'image_review',
      label: 'فحص صور إعلان',
    };
  }

  if (/بيع|اعلان|إعلان|انشر|اعرض|لدي|عندي/.test(normalized)) {
    return {
      kind: 'create_listing',
      label: 'إنشاء إعلان بيع',
    };
  }

  if (/تواصل|كلم|راسل|محادثة|البائع|المشتري/.test(normalized)) {
    return {
      kind: 'open_conversation',
      label: 'فتح تواصل داخلي',
    };
  }

  if (/قارن|مقارنة|افضل|أفضل|اختار|اختر|انصح/.test(normalized)) {
    return {
      kind: 'compare_listings',
      label: 'مقارنة واختيار',
    };
  }

  if (/ابحث|أبحث|احتاج|ابي|أبي|اريد|أريد|دور|وين|سعر/.test(normalized)) {
    return {
      kind: 'search_listing',
      label: 'بحث عن منتج',
    };
  }

  return defaultClientIntent;
}

function shouldRefreshListingsForIntent(intent: ClientIntentState) {
  return intent.kind === 'search_listing' || intent.kind === 'compare_listings';
}

function isSearchRefinement(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized || normalized.length > 60) {
    return false;
  }

  return (
    /^(?:19|20)\d{2}$/.test(normalized) ||
    /^[\d٠-٩\s,.٬]+(?:ر\.?س|ريال|sar)?$/i.test(normalized) ||
    /(?:ميزانية|ميزانيه|ميزانيتي|حدي|بحدود|حدود|تحت|اقل|أقل|اكثر|أكثر|اكبر|أكبر|فوق|حتى|الف|ألف|ريال|ر\.?س|sar)/i.test(
      normalized,
    ) ||
    /(?:لون|ابيض|أبيض|اسود|أسود|فضي|رمادي|ازرق|أزرق|احمر|أحمر|ذهبي|بيج|قير|اوتوماتيك|أوتوماتيك|عادي|ممشى|عداد|كيلو|كم|فل كامل|ستاندر|نص فل|بدون حوادث|مالك اول|مالك أول)/i.test(
      normalized,
    ) ||
    /(?:تويوتا|تايوتا|كامري|كورولا|يارس|نيسان|هوندا|هيونداي|كيا|مازدا|لكزس|مرسيدس|الرياض|جدة|جده|الدمام|الخبر|مستعمل|مستعملة|جديد|جديدة|سيدان|هايبرد|بنزين|toyota|camry|corolla|nissan|honda|hyundai|kia|mazda|lexus|mercedes|riyadh|jeddah|used|new|sedan|hybrid)/i.test(
      normalized,
    )
  );
}

function getNextListingQuery(
  text: string,
  activeQuery: string,
  intent: ClientIntentState,
) {
  if (shouldRefreshListingsForIntent(intent)) {
    return text;
  }

  if (activeQuery && isSearchRefinement(text)) {
    return `${activeQuery} ${text}`.trim();
  }

  return '';
}

function isRetainableListingImage(file: unknown): file is FileUIPart {
  return (
    isRecord(file) &&
    file.type === 'file' &&
    typeof file.url === 'string' &&
    typeof file.mediaType === 'string' &&
    file.mediaType.startsWith('image/')
  );
}

function toRetainedListingImages(files: unknown) {
  if (!Array.isArray(files)) {
    return [];
  }

  return files.filter(isRetainableListingImage).slice(0, 8).map((file) => ({
    type: 'file' as const,
    url: file.url,
    mediaType: file.mediaType,
    filename: file.filename,
  }));
}

function shouldSendRetainedListingImages({
  activeListingQuery,
  hasCurrentImages,
  intent,
  retainedImages,
  text,
}: {
  activeListingQuery: string;
  hasCurrentImages: boolean;
  intent: ClientIntentState;
  retainedImages: RetainedListingImage[];
  text: string;
}) {
  if (retainedImages.length === 0) {
    return false;
  }

  if (hasCurrentImages) {
    return true;
  }

  if (intent.kind === 'create_listing' || intent.kind === 'image_review') {
    return true;
  }

  if (activeListingQuery) {
    return false;
  }

  return /(?:نعم|ايه|اعتمد|انشر|نشر|موافق|اوك|تمام|اكمل|جاهز|yes|ok|publish|approve)/i.test(
    text,
  );
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
    published: 'موثق',
    paused: 'موقوف',
    sold: 'مباع',
    rejected: 'مرفوض',
    deleted: 'محذوف',
  };

  return status ? labels[status] : undefined;
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

type SearchToolOutput = {
  status?: unknown;
  listings?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clearStaleStoredChatState() {
  clearStoredChatState();
}

function clearStoredChatState() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(currentChatStorageKey);
  }
}

async function resetAssistantSearchState() {
  await fetch('/api/chat/reset', {
    cache: 'no-store',
    credentials: 'include',
    method: 'POST',
  });
}

function openRetainedListingImagesDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available.'));
      return;
    }

    const request = indexedDB.open(retainedListingImagesDatabaseName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(retainedListingImagesStoreName)) {
        database.createObjectStore(retainedListingImagesStoreName, {
          keyPath: 'id',
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRetainedListingImages() {
  await clearRetainedListingImages();
  return [];
}

async function writeRetainedListingImages(images: RetainedListingImage[]) {
  void images;
  await clearRetainedListingImages();
}

async function clearRetainedListingImages() {
  const database = await openRetainedListingImagesDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      retainedListingImagesStoreName,
      'readwrite',
    );
    transaction
      .objectStore(retainedListingImagesStoreName)
      .delete(retainedListingImagesRecordKey);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

function toSelectedListingContext(
  listing: ListingCard,
): SelectedListingContext | null {
  if (!listing.id) {
    return null;
  }

  return {
    id: listing.id,
    title: listing.title,
    price: listing.price,
    city: listing.city,
    category: listing.category,
    status: listing.status,
    description: listing.description,
  };
}

function isSearchToolOutput(value: unknown): value is SearchToolOutput {
  return (
    isRecord(value) &&
    (value.status === 'searched' || value.status === 'compared') &&
    Array.isArray(value.listings)
  );
}

function getLatestSearchToolOutput(messages: UIMessage[]) {
  const latestUserMessageIndex = messages.findLastIndex(
    (message) => message.role === 'user',
  );
  const firstEligibleAssistantIndex =
    latestUserMessageIndex === -1 ? 0 : latestUserMessageIndex + 1;

  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    if (messageIndex < firstEligibleAssistantIndex) {
      break;
    }

    const message = messages[messageIndex];

    if (message.role !== 'assistant') {
      continue;
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];

      if (
        part.type === 'tool-searchMarketplaceListings' &&
        'state' in part &&
        part.state === 'output-available' &&
        'output' in part &&
        isSearchToolOutput(part.output)
      ) {
        return part.output;
      }

      if (
        part.type === 'tool-compareMarketplaceListings' &&
        'state' in part &&
        part.state === 'output-available' &&
        'output' in part &&
        isSearchToolOutput(part.output)
      ) {
        return part.output;
      }
    }
  }

  return null;
}

function listingRecordToCard(listing: ApiListingRecord): ListingCard {
  const primaryImage = listing.images?.find(
    (image) => image.status === 'approved',
  );

  return {
    id: listing.id,
    sellerId: listing.sellerId,
    title: listing.title ?? 'إعلان بدون عنوان',
    price: formatListingPrice(listing.price),
    city: listing.city ?? 'السعودية',
    category: formatCategory(listing.category),
    description: listing.description,
    image:
      getDurableImageUrl(
        listing.image,
        primaryImage?.thumbnailUrl,
        primaryImage?.displayUrl,
        primaryImage?.originalUrl,
      ) ?? null,
    status: formatListingStatus(listing.status),
    stats:
      typeof listing.views === 'number'
        ? `${listing.views} مشاهدة · ${listing.messageCount ?? 0} رسائل`
        : undefined,
  };
}

function SignInCard({ text }: { text: string }) {
  return (
    <div className="grid gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-right text-blue-950 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-50">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-1 size-4 shrink-0 text-blue-700 dark:text-blue-300" />
        <p className="text-sm leading-7">{text.replace(authRequiredMarker, '').trim()}</p>
      </div>
      <Button asChild className="h-10 w-full justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
        <a href="/api/auth/google/start">
          <GoogleMark className="size-5" />
          <span>المتابعة باستخدام Google</span>
        </a>
      </Button>
      <Button asChild className="h-10 w-full justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
        <a href="/api/auth/apple/start">
          <AppleMark className="size-5" />
          <span>المتابعة باستخدام Apple</span>
        </a>
      </Button>
    </div>
  );
}

function AuthProviderMenu() {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu dir="rtl" open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          className="rounded-md bg-blue-600 hover:bg-blue-700"
          data-testid="auth-provider-trigger"
          onClick={() => setOpen(true)}
          onPointerUp={() => setOpen(true)}
        >
          <User className="size-4" />
          دخول
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-56 border-slate-200/70 p-1.5 shadow-xl dark:border-white/10"
        data-testid="auth-provider-menu"
      >
        <DropdownMenuLabel className="text-right text-xs text-muted-foreground">
          اختر طريقة الدخول
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="h-10 justify-between rounded-md px-3 text-right">
          <a href="/api/auth/google/start">
            <span>دخول Google</span>
            <GoogleMark className="size-5" />
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="h-10 justify-between rounded-md px-3 text-right">
          <a href="/api/auth/apple/start">
            <span>دخول Apple</span>
            <AppleMark className="size-5 text-foreground" />
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderMessageParts(parts: UIMessage['parts']): ReactNode[] {
  return parts.flatMap((part, index) => {
    if (part.type === 'text') {
      if (part.text.includes(authRequiredMarker)) {
        return [<SignInCard key={`auth-${index}`} text={part.text} />];
      }

      return [<MessageResponse key={`text-${index}`}>{part.text}</MessageResponse>];
    }

    if (part.type === 'file') {
      return [<MessageAttachment key={`file-${index}`} data={part} />];
    }

    return [];
  });
}

function ListingCardView({
  listing,
  isFavorite,
  isOwnListing,
  onAsk,
  onFavorite,
  onOpen,
}: {
  listing: ListingCard;
  isFavorite: boolean;
  isOwnListing: boolean;
  onAsk: (prompt: string, listing?: ListingCard) => void;
  onFavorite: (listing: ListingCard) => void;
  onOpen: (listing: ListingCard) => void;
}) {
  return (
    <article
      className="w-full min-w-0 cursor-pointer overflow-hidden rounded-md border bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:bg-card sm:max-w-[11.5rem]"
      onClick={() => onOpen(listing)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(listing);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="relative aspect-[16/10] bg-slate-100">
        {listing.image ? (
          <img alt={listing.title} className="h-full w-full object-cover" src={listing.image} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-slate-100 text-center text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <div className="grid gap-1">
              <ImageIcon className="mx-auto size-5" />
              <span>لا توجد صورة حقيقية</span>
            </div>
          </div>
        )}
        {!isOwnListing && (
        <Button
          size="icon-sm"
          variant="ghost"
          className={cn(
            'absolute left-1.5 top-1.5 size-7 rounded-md border border-white/80 bg-white/95 shadow-sm ring-1 ring-slate-950/5 hover:bg-white sm:left-2 sm:top-2 sm:size-8',
            isFavorite
              ? 'text-blue-600 hover:text-blue-700 dark:border-blue-300/30 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-300/20 dark:hover:bg-blue-500/20'
              : 'text-blue-600 hover:text-blue-700 dark:border-white/20 dark:bg-slate-950/85 dark:text-blue-200 dark:ring-white/10 dark:hover:bg-slate-900 dark:hover:text-blue-100',
          )}
          aria-label="حفظ الإعلان"
          aria-pressed={isFavorite}
          onClick={(event) => {
            event.stopPropagation();
            onFavorite(listing);
          }}
        >
          <Heart className={cn('size-3.5 sm:size-4', isFavorite && 'fill-current')} />
        </Button>
        )}
      </div>
      <div className="grid gap-1 p-2 text-right">
        <h3 className="line-clamp-1 text-xs font-bold leading-5">{listing.title}</h3>
        <div className="text-sm font-bold text-emerald-600 dark:text-emerald-300">{listing.price}</div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground sm:text-[11px]">
          <MapPin className="size-3" />
          {listing.city}
        </div>
        {listing.description && (
          <p className="line-clamp-1 text-[10px] leading-4 text-muted-foreground">
            {listing.description}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200 sm:py-1">
            <BadgeCheck className="size-3" />
            {listing.status ?? 'موثق'}
          </span>
          <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">{listing.stats}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1.5 border-t pt-1.5">
          <Button
            size="sm"
            className="h-7 rounded-md bg-blue-600 text-[11px] hover:bg-blue-700"
            onClick={(event) => {
              event.stopPropagation();
              onAsk(
                listing.id
                  ? `أريد التواصل مع البائع بخصوص الإعلان رقم ${listing.id}: ${listing.title}`
                  : `أريد التواصل بخصوص ${listing.title}`,
                listing,
              );
            }}
          >
            <MessageCircle className="size-3 sm:size-3.5" />
            تواصل
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            className="size-7 rounded-md"
            aria-label="مقارنة الإعلان"
            onClick={(event) => {
              event.stopPropagation();
              onAsk(
                listing.id
                  ? `قارن لي الإعلان رقم ${listing.id} (${listing.title}) بالسوق`
                  : `قارن لي إعلان ${listing.title} بالسوق`,
                listing,
              );
            }}
          >
            <Sparkles className="size-3 sm:size-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function AssistantMessageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full items-start gap-2">
      <div className="mt-1 grid size-7 shrink-0 place-items-center overflow-hidden rounded-full border border-sky-400/20 bg-slate-900/80 text-sky-300 shadow-sm shadow-sky-950/20 dark:bg-slate-950/70">
        <Bot className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
}

function getChatErrorMessage(error: Error | undefined) {
  if (!error) {
    return null;
  }

  if (
    error.message === 'Load failed' ||
    error.message === 'Failed to fetch' ||
    error.message === 'NetworkError when attempting to fetch resource.'
  ) {
    return 'تعذر تحميل رد المساعد. تأكد من الاتصال ثم أعد إرسال الطلب.';
  }

  if (error.message === chatRateLimitMessage) {
    return chatRateLimitMessage;
  }

  return chatServiceUnavailableMessage;
}

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

const guardedChatFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok) {
    let text = '';

    try {
      text = await response.clone().text();
    } catch {
      text = '';
    }

    if (contentType.includes('text/html') || isRawServiceErrorResponse(text)) {
      throw new Error(chatServiceUnavailableMessage);
    }

    if (response.status === 429) {
      throw new Error(chatRateLimitMessage);
    }

    throw new Error(chatServiceUnavailableMessage);
  }

  if (contentType.includes('text/html')) {
    const text = await response.clone().text();

    if (isRawServiceErrorResponse(text)) {
      throw new Error(chatServiceUnavailableMessage);
    }
  }

  return response;
};

export default function Page() {
  const router = useRouter();
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        credentials: 'include',
        fetch: guardedChatFetch,
      }),
    [],
  );
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: chatTransport,
  });
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [marketplaceListings, setMarketplaceListings] =
    useState<ListingCard[]>(featuredListings);
  const [favoriteListingIds, setFavoriteListingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [listingPagination, setListingPagination] = useState({
    page: 1,
    hasMore: false,
  });
  const [isLoadingListings, setIsLoadingListings] = useState(false);
  const [activeListingQuery, setActiveListingQuery] = useState('');
  const [selectedListingContext, setSelectedListingContext] =
    useState<SelectedListingContext | null>(null);
  const [hasRestoredChat, setHasRestoredChat] = useState(false);
  const [assistantState, setAssistantState] =
    useState<AssistantState>('collapsed');
  const [isCompactViewport, setIsCompactViewport] = useState(true);
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const retainedListingImagesRef = useRef<RetainedListingImage[]>([]);
  const lastSyncedAssistantMessageIdRef = useRef<string | null>(null);
  const assistantDragStartYRef = useRef<number | null>(null);
  const compactViewportRef = useRef<boolean | null>(null);
  const keyboardBaselineViewportHeightRef = useRef<number | null>(null);
  const listingsRequestIdRef = useRef(0);
  const listingsAbortControllersRef = useRef(new Set<AbortController>());
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const shouldResetSearchStateRef = useRef(true);
  const [, setClientIntent] = useState<ClientIntentState>(defaultClientIntent);

  const filteredMessages = useMemo(
    () => messages.filter((message) => message.role !== 'system'),
    [messages],
  );
  const isLoading = status === 'streaming' || status === 'submitted';
  const chatErrorMessage = getChatErrorMessage(error);
  const scrollWatchKey = useMemo(() => {
    const lastMessage = filteredMessages.at(-1);
    const lastTextLength =
      lastMessage?.parts.reduce((length, part) => {
        return part.type === 'text' ? length + part.text.length : length;
      }, 0) ?? 0;

    return `${status}-${filteredMessages.length}-${lastMessage?.id ?? 'empty'}-${lastTextLength}`;
  }, [filteredMessages, status]);
  const latestSearchToolOutput = useMemo(
    () => getLatestSearchToolOutput(filteredMessages),
    [filteredMessages],
  );
  const searchToolListings = useMemo(() => {
    if (!latestSearchToolOutput) {
      return [];
    }

    return (latestSearchToolOutput.listings as ApiListingRecord[]).map(
      listingRecordToCard,
    );
  }, [latestSearchToolOutput]);
  const assistantResultListings = useMemo(() => {
    return getAssistantResultListings({
      searchToolListings,
    });
  }, [searchToolListings]);
  const hasActiveAssistantSearch = Boolean(activeListingQuery);
  const exploreMarketplaceListings = useMemo(() => {
    return getExploreListings({
      marketplaceListings,
      searchToolListings: hasActiveAssistantSearch ? assistantResultListings : [],
    });
  }, [assistantResultListings, hasActiveAssistantSearch, marketplaceListings]);
  const canLoadMoreListings = getCanLoadMoreExploreListings({
    hasMore: listingPagination.hasMore,
    displayedCount: marketplaceListings.length,
  });

  const isAssistantExpanded = assistantState === 'expanded';
  const assistantPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isCompactViewport) {
      return undefined;
    }

    const hasKeyboardOffset = isChatInputFocused && keyboardOffset > 0;
    const expandedHeight = hasKeyboardOffset
      ? `min(68dvh, calc(100dvh - ${keyboardOffset}px - 0.75rem))`
      : '68dvh';

    return {
      bottom: hasKeyboardOffset
        ? `calc(${keyboardOffset}px + env(safe-area-inset-bottom))`
        : 'calc(4.5rem + env(safe-area-inset-bottom))',
      height: isAssistantExpanded ? expandedHeight : '12.75rem',
      maxHeight: isAssistantExpanded ? '42rem' : 'none',
      minHeight: isAssistantExpanded && !hasKeyboardOffset ? '26rem' : '0',
    };
  }, [
    isAssistantExpanded,
    isChatInputFocused,
    isCompactViewport,
    keyboardOffset,
  ]);

  const collapseAssistant = useCallback(() => {
    setAssistantState('collapsed');
  }, []);

  const expandAssistant = useCallback(() => {
    setAssistantState('expanded');
  }, []);

  const handleChatInputFocus = useCallback(() => {
    const visualViewport = window.visualViewport;
    const viewportHeight = Math.max(
      window.innerHeight,
      visualViewport
        ? visualViewport.height + visualViewport.offsetTop
        : window.innerHeight,
    );

    keyboardBaselineViewportHeightRef.current = Math.max(
      keyboardBaselineViewportHeightRef.current ?? 0,
      viewportHeight,
    );
    setIsChatInputFocused(true);
    expandAssistant();
  }, [expandAssistant]);

  const handleChatInputBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      const promptInputContainer = event.currentTarget;
      const nextTarget = event.relatedTarget;

      if (
        nextTarget instanceof Element &&
        promptInputContainer.contains(nextTarget)
      ) {
        return;
      }

      window.setTimeout(() => {
        const activeElement = document.activeElement;

        if (
          activeElement instanceof Element &&
          promptInputContainer.contains(activeElement)
        ) {
          return;
        }

        setIsChatInputFocused(false);
        setKeyboardOffset(0);
        keyboardBaselineViewportHeightRef.current = null;
      }, 80);
    },
    [],
  );

  useEffect(() => {
    if (!isCompactViewport || !isChatInputFocused) {
      return;
    }

    const syncKeyboardOffset = () => {
      const visualViewport = window.visualViewport;

      if (!visualViewport) {
        setKeyboardOffset(0);
        return;
      }

      const viewportBottom = visualViewport.height + visualViewport.offsetTop;
      const baselineViewportHeight = Math.max(
        keyboardBaselineViewportHeightRef.current ?? 0,
        window.innerHeight,
        viewportBottom,
      );
      keyboardBaselineViewportHeightRef.current = baselineViewportHeight;
      const nextKeyboardOffset = Math.max(
        0,
        Math.round(baselineViewportHeight - viewportBottom),
      );

      setKeyboardOffset(nextKeyboardOffset > 80 ? nextKeyboardOffset : 0);
    };

    syncKeyboardOffset();
    window.visualViewport?.addEventListener('resize', syncKeyboardOffset);
    window.visualViewport?.addEventListener('scroll', syncKeyboardOffset);
    window.addEventListener('resize', syncKeyboardOffset);

    return () => {
      window.visualViewport?.removeEventListener('resize', syncKeyboardOffset);
      window.visualViewport?.removeEventListener('scroll', syncKeyboardOffset);
      window.removeEventListener('resize', syncKeyboardOffset);
    };
  }, [isChatInputFocused, isCompactViewport]);

  useEffect(() => {
    const syncViewportMode = () => {
      const isCompact = window.innerWidth < 1024;

      setIsCompactViewport(isCompact);

      if (compactViewportRef.current === isCompact) {
        return;
      }

      compactViewportRef.current = isCompact;

      if (isCompact) {
        collapseAssistant();
      } else {
        expandAssistant();
      }
    };

    syncViewportMode();
    window.addEventListener('resize', syncViewportMode);

    return () => {
      window.removeEventListener('resize', syncViewportMode);
    };
  }, [collapseAssistant, expandAssistant]);

  const handleAssistantDragStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      assistantDragStartYRef.current = event.clientY;
    },
    [],
  );

  const settleAssistantDrag = useCallback(
    (endY: number) => {
      const startY = assistantDragStartYRef.current;
      assistantDragStartYRef.current = null;

      if (startY === null) {
        return;
      }

      const deltaY = endY - startY;

      if (deltaY > assistantDragThreshold) {
        collapseAssistant();
        return;
      }

      if (deltaY < -assistantDragThreshold) {
        expandAssistant();
      }
    },
    [collapseAssistant, expandAssistant],
  );

  const handleAssistantDragEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      settleAssistantDrag(event.clientY);
    },
    [settleAssistantDrag],
  );

  const handleAssistantTouchStart = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      assistantDragStartYRef.current = event.touches[0]?.clientY ?? null;
    },
    [],
  );

  const handleAssistantTouchEnd = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      const endY = event.changedTouches[0]?.clientY;

      if (typeof endY === 'number') {
        settleAssistantDrag(endY);
      }
    },
    [settleAssistantDrag],
  );

  const collapseAssistantFromPage = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isAssistantExpanded || window.innerWidth >= 1024) {
        return;
      }

      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('a, button, input, textarea, [role="button"]')
      ) {
        return;
      }

      collapseAssistant();
    },
    [collapseAssistant, isAssistantExpanded],
  );

  const refreshMarketplaceListings = useCallback((
    query?: string,
    page = 1,
    options?: { showLoading?: boolean },
  ) => {
    const requestId = ++listingsRequestIdRef.current;
    const params = new URLSearchParams();
    const showLoading = options?.showLoading ?? true;
    const requestController = new AbortController();
    listingsAbortControllersRef.current.add(requestController);

    if (showLoading) {
      setIsLoadingListings(true);
    }

    if (query?.trim()) {
      params.set('q', query.trim());
    }

    params.set('page', String(page));
    params.set('limit', '24');

    const endpoint = `/api/marketplace/listings?${params.toString()}`;

    return fetch(endpoint, {
      cache: 'no-store',
      signal: requestController.signal,
    })
      .then((response) =>
        response.json() as Promise<ListingsResponsePayload>,
      )
      .then((payload) => {
        if (requestId !== listingsRequestIdRef.current) {
          return;
        }

        if (payload.listings) {
          const nextListings = payload.listings.map(listingRecordToCard);

          setMarketplaceListings((currentListings) => {
            if (page <= 1) {
              return nextListings;
            }

            const existingIds = new Set(
              currentListings.map((listing) => listing.id).filter(Boolean),
            );
            const uniqueNextListings = nextListings.filter(
              (listing) => !listing.id || !existingIds.has(listing.id),
            );

            return [...currentListings, ...uniqueNextListings];
          });
        }

        setListingPagination({
          page: payload.pagination?.page ?? page,
          hasMore: Boolean(payload.pagination?.hasMore),
        });
      })
      .catch((error: unknown) => {
        if (requestId !== listingsRequestIdRef.current) {
          return;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (page <= 1) {
          setMarketplaceListings(featuredListings);
        }
        setListingPagination({ page: 1, hasMore: false });
      })
      .finally(() => {
        listingsAbortControllersRef.current.delete(requestController);

        if (requestId === listingsRequestIdRef.current) {
          setIsLoadingListings(false);
        }
      });
  }, []);

  const refreshFavoriteListingIds = useCallback(() => {
    return fetch('/api/marketplace/me/favorites?page=1&limit=48', {
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) {
          setFavoriteListingIds(new Set());
          return null;
        }

        return response.json() as Promise<{
          favorites?: FavoriteListingRecord[];
        }>;
      })
      .then((payload) => {
        if (!payload?.favorites) {
          return;
        }

        setFavoriteListingIds(
          new Set(
            payload.favorites
              .map((favorite) => favorite.listingId)
              .filter(Boolean),
          ),
        );
      })
      .catch(() => {
        setFavoriteListingIds(new Set());
      });
  }, []);

  const scheduleRealtimeListingsRefresh = useCallback(() => {
    if (realtimeRefreshTimerRef.current !== null) {
      return;
    }

    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      realtimeRefreshTimerRef.current = null;
      void refreshMarketplaceListings(undefined, 1, {
        showLoading: false,
      });
    }, 250);
  }, [refreshMarketplaceListings]);

  useEffect(() => {
    const listingsAbortControllers = listingsAbortControllersRef.current;

    return () => {
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }

      listingsAbortControllers.forEach((controller) => {
        controller.abort();
      });
      listingsAbortControllers.clear();
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    let lastScrollY = window.scrollY;

    const handleWindowScroll = () => {
      const nextScrollY = window.scrollY;

      if (window.innerWidth < 1024 && nextScrollY > lastScrollY + 12) {
        collapseAssistant();
      }

      lastScrollY = nextScrollY;
    };

    window.addEventListener('scroll', handleWindowScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleWindowScroll);
    };
  }, [collapseAssistant]);

  useEffect(() => {
    window.addEventListener('smartstore:collapse-assistant', collapseAssistant);

    return () => {
      window.removeEventListener(
        'smartstore:collapse-assistant',
        collapseAssistant,
      );
    };
  }, [collapseAssistant]);

  useEffect(() => {
    let cancelled = false;

    clearStaleStoredChatState();
    retainedListingImagesRef.current = [];
    shouldResetSearchStateRef.current = true;
    void clearRetainedListingImages().catch(() => {});

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setMessages([]);
      setActiveListingQuery('');
      setSelectedListingContext(null);
    });

    void resetAssistantSearchState()
      .catch(() => {
        // The first chat request also carries resetSearchState, so an offline
        // reset call should not block the customer from opening the assistant.
      })
      .finally(() => {
        if (cancelled) {
          return;
        }

        setHasRestoredChat(true);
      });

    return () => {
      cancelled = true;
    };
  }, [setMessages]);


  useEffect(() => {
    let cancelled = false;

    void readRetainedListingImages()
      .then((images) => {
        if (!cancelled && images.length) {
          retainedListingImagesRef.current = images;
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    void fetch('/api/auth/session', { cache: 'no-store' })
      .then((response) => response.json() as Promise<AuthSessionPayload>)
      .then((payload) => {
        if (mounted) {
          setSession(payload);
          if (payload.authenticated) {
            void refreshFavoriteListingIds();
          } else {
            setFavoriteListingIds(new Set());
          }
        }
      })
      .catch(() => {
        if (mounted) {
          setSession({ authenticated: false, user: null });
        }
      });

    return () => {
      mounted = false;
    };
  }, [refreshFavoriteListingIds]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshMarketplaceListings();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [refreshMarketplaceListings]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    if (latestSearchToolOutput) {
      return;
    }

    const lastAssistantMessage = [...filteredMessages]
      .reverse()
      .find((message) => message.role === 'assistant');

    if (
      !lastAssistantMessage ||
      lastAssistantMessage.id === lastSyncedAssistantMessageIdRef.current
    ) {
      return;
    }

    lastSyncedAssistantMessageIdRef.current = lastAssistantMessage.id;
    const timeoutId = window.setTimeout(() => {
      void refreshMarketplaceListings();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    filteredMessages,
    latestSearchToolOutput,
    refreshMarketplaceListings,
    status,
  ]);

  useSmartstoreRealtime({
    enabled: true,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_created',
      'ad_updated',
      'ad_deleted',
      'ad_status_changed',
      'ai_results_updated',
      'maintenance_cleanup',
    ],
    onEvent: (event) => {
      if (event.type === 'ai_results_updated') {
        if (!('ownerKey' in event.payload)) {
          return;
        }

        const userId = session.user?.id;

        if (!userId || event.payload.ownerKey !== `user:${userId}`) {
          return;
        }

        scheduleRealtimeListingsRefresh();
        return;
      }

      scheduleRealtimeListingsRefresh();
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      scheduleRealtimeListingsRefresh();
    },
  });

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      if (!hasRestoredChat) {
        return;
      }

      const hasText =
        message &&
        'text' in message &&
        typeof message.text === 'string' &&
        Boolean(message.text.trim());
      const hasFiles =
        message &&
        'files' in message &&
        (Array.isArray(message.files)
          ? message.files.length > 0
          : Boolean(message.files));

      if (!hasText && !hasFiles) {
        return;
      }

      expandAssistant();

      const text = hasText && 'text' in message ? message.text : '';
      const files = hasFiles && 'files' in message ? message.files : undefined;
      const currentListingImages = toRetainedListingImages(files);

      const intent = inferClientIntent(text, Boolean(files));
      setClientIntent(intent);

      if (currentListingImages.length) {
        retainedListingImagesRef.current = currentListingImages;
        void writeRetainedListingImages(currentListingImages).catch(() => {});
      }

      const resetSearchState =
        shouldResetSearchStateRef.current || filteredMessages.length === 0;
      shouldResetSearchStateRef.current = false;

      const nextListingQuery = getNextListingQuery(
        text,
        activeListingQuery,
        intent,
      );

      if (nextListingQuery) {
        setActiveListingQuery(nextListingQuery);
      } else if (
        intent.kind === 'create_listing' ||
        intent.kind === 'open_conversation' ||
        intent.kind === 'image_review'
      ) {
        setActiveListingQuery('');
      }

      const retainedListingImages = shouldSendRetainedListingImages({
        activeListingQuery,
        hasCurrentImages: currentListingImages.length > 0,
        intent,
        retainedImages: retainedListingImagesRef.current,
        text,
      })
        ? retainedListingImagesRef.current
        : [];

      void sendMessage(
        { text, files },
        {
          body: {
            locationSettings,
            retainedListingImages,
            resetSearchState,
            selectedListing: selectedListingContext,
          },
        },
      );
    },
    [
      activeListingQuery,
      hasRestoredChat,
      selectedListingContext,
      sendMessage,
      expandAssistant,
      filteredMessages.length,
    ],
  );

  const sendStarter = useCallback(
    (prompt: string, listing?: ListingCard) => {
      if (isLoading || !hasRestoredChat) {
        return;
      }

      const nextSelectedListingContext = listing
        ? toSelectedListingContext(listing)
        : selectedListingContext;

      if (listing) {
        setSelectedListingContext(nextSelectedListingContext);
      }

      const intent = inferClientIntent(prompt);
      setClientIntent(intent);
      expandAssistant();
      const resetSearchState =
        shouldResetSearchStateRef.current || filteredMessages.length === 0;
      shouldResetSearchStateRef.current = false;

      const nextListingQuery = getNextListingQuery(
        prompt,
        activeListingQuery,
        intent,
      );

      if (nextListingQuery) {
        setActiveListingQuery(nextListingQuery);
      } else if (
        intent.kind === 'create_listing' ||
        intent.kind === 'open_conversation' ||
        intent.kind === 'image_review'
      ) {
        setActiveListingQuery('');
      }

      void sendMessage(
        { text: prompt },
        {
          body: {
            locationSettings,
            resetSearchState,
            selectedListing: nextSelectedListingContext,
          },
        },
      );
    },
    [
      activeListingQuery,
      hasRestoredChat,
      isLoading,
      selectedListingContext,
      sendMessage,
      expandAssistant,
      filteredMessages.length,
    ],
  );

  const openListing = useCallback(
    (listing: ListingCard) => {
      const nextSelectedListingContext = toSelectedListingContext(listing);

      if (nextSelectedListingContext) {
        setSelectedListingContext(nextSelectedListingContext);
      }

      if (!listing.id) {
        return;
      }

      router.push(`/listings/${listing.id}`);
    },
    [router],
  );

  const favoriteListing = useCallback(
    (listing: ListingCard) => {
      const nextSelectedListingContext = toSelectedListingContext(listing);

      if (nextSelectedListingContext) {
        setSelectedListingContext(nextSelectedListingContext);
      }

      if (!listing.id) {
        return;
      }

      const listingId = listing.id;
      const wasFavorite = favoriteListingIds.has(listingId);

      setFavoriteListingIds((currentIds) => {
        const nextIds = new Set(currentIds);

        if (wasFavorite) {
          nextIds.delete(listingId);
        } else {
          nextIds.add(listingId);
        }

        return nextIds;
      });

      void fetch(`/api/marketplace/listings/${listing.id}/favorite`, {
        method: 'POST',
        headers: {
          'Idempotency-Key': createClientIdempotencyKey('favorite-toggle'),
        },
      }).then((response) => {
        if (response.status === 401) {
          setFavoriteListingIds((currentIds) => {
            const nextIds = new Set(currentIds);
            nextIds.delete(listingId);
            return nextIds;
          });
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          setFavoriteListingIds((currentIds) => {
            const nextIds = new Set(currentIds);

            if (wasFavorite) {
              nextIds.add(listingId);
            } else {
              nextIds.delete(listingId);
            }

            return nextIds;
          });
          return;
        }

        void response.json().then((payload: { status?: string }) => {
          setFavoriteListingIds((currentIds) => {
            const nextIds = new Set(currentIds);

            if (payload.status === 'removed') {
              nextIds.delete(listingId);
            } else {
              nextIds.add(listingId);
            }

            return nextIds;
          });
        });
        void refreshMarketplaceListings();
      }).catch(() => {
        setFavoriteListingIds((currentIds) => {
          const nextIds = new Set(currentIds);

          if (wasFavorite) {
            nextIds.add(listingId);
          } else {
            nextIds.delete(listingId);
          }

          return nextIds;
        });
      });
    },
    [favoriteListingIds, refreshMarketplaceListings, router],
  );

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      setSession({ authenticated: false, user: null });
      setFavoriteListingIds(new Set());
    });
  }, []);

  const loadMoreListings = useCallback(() => {
    if (!canLoadMoreListings || isLoadingListings) {
      return;
    }

    setIsLoadingListings(true);
    void refreshMarketplaceListings(undefined, listingPagination.page + 1);
  }, [
    canLoadMoreListings,
    isLoadingListings,
    listingPagination.page,
    refreshMarketplaceListings,
  ]);

  const listingsLoadMoreRef = useInfiniteScroll({
    enabled: canLoadMoreListings,
    isLoading: isLoadingListings,
    onLoadMore: loadMoreListings,
  });

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveListingQuery('');
    setSelectedListingContext(null);
    retainedListingImagesRef.current = [];
    shouldResetSearchStateRef.current = true;
    clearStoredChatState();
    void clearRetainedListingImages().catch(() => {});
    void resetAssistantSearchState().catch(() => {});
  }, [setMessages]);

  const clearAssistantSearch = useCallback(() => {
    setActiveListingQuery('');
  }, []);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground lg:h-dvh lg:overflow-hidden" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-3 px-3 py-3 sm:px-6 lg:h-full lg:min-h-0">
        <section className="flex min-h-0 flex-col rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card lg:overflow-hidden">
          <header className="flex h-14 items-center justify-between gap-2 border-b bg-[#f7f9fc] px-2 dark:bg-background sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
                <img alt="SmartStore AI" className="size-8 object-cover" src="/smartstore-mark.png" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xs font-bold sm:text-sm">SmartStore AI</h1>
                <p className="max-w-[8rem] truncate text-[10px] text-muted-foreground sm:max-w-none sm:text-[11px]">سوق ذكي للتسويق للمنتجات</p>
              </div>
            </div>

            <div className="hidden h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-muted-foreground shadow-sm md:mx-6 md:flex dark:border-blue-400/20 dark:bg-card">
              <Sparkles className="size-4 text-blue-600" />
              <button className="flex h-full min-w-0 flex-1 items-center truncate text-start text-xs" type="button" onClick={() => sendStarter('أبحث عن منتج بمساعدة الذكاء الاصطناعي')}>
                اسأل مساعد SmartStore AI عن المنتج الذي تبحث عنه
              </button>
            </div>

            <nav className="hidden items-center gap-1 text-[11px] font-medium text-muted-foreground xl:flex">
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/terms">
                الشروط
              </Link>
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/listing-policy">
                سياسة الإعلانات
              </Link>
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/commission-policy">
                العمولة
              </Link>
            </nav>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="الإشعارات" className="hidden sm:inline-flex">
                    <Bell className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>الإشعارات</TooltipContent>
              </Tooltip>
              <ThemeToggle language="ar" />
              {session.authenticated ? (
                <>
                  <Button asChild variant="outline" size="sm" className="hidden rounded-md sm:inline-flex">
                    <Link href="/account">
                      <User className="size-4" />
                      حسابي
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-md" onClick={handleLogout}>
                    <LogOut className="size-4" />
                    خروج
                  </Button>
                </>
              ) : (
                <AuthProviderMenu />
              )}
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_25rem] lg:overflow-hidden">
            <section
              className={`min-w-0 border-b bg-[#eef4fb] p-3 dark:bg-background sm:p-4 lg:overflow-y-auto lg:border-b-0 lg:border-l lg:pb-4 ${
                isAssistantExpanded
                  ? 'pb-[calc(70dvh+6rem)] sm:pb-[calc(70dvh+6rem)]'
                  : 'pb-[calc(14rem+env(safe-area-inset-bottom))] sm:pb-[calc(14rem+env(safe-area-inset-bottom))]'
              }`}
              id="suggested-listings"
              onPointerDown={collapseAssistantFromPage}
            >
              <div className="mb-4 flex flex-col gap-3 text-center md:flex-row md:items-center md:justify-between md:text-right">
                <div>
                  <div className="flex items-center justify-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 md:justify-start">
                    <Store className="size-4" />
                    واجهة الإعلانات
                  </div>
                  <h2 className="mt-1 text-xl font-bold">إعلانات SmartStore AI</h2>
                </div>
                <Button className="rounded-md bg-blue-600 hover:bg-blue-700" onClick={() => sendStarter('أريد بيع منتج')}>
                  <Plus className="size-4" />
                  إعلان جديد
                </Button>
              </div>

              {hasActiveAssistantSearch && (
                <div className="mb-5 grid gap-3">
                  <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-white/90 px-3 py-2 text-right shadow-sm dark:border-blue-400/20 dark:bg-card">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px] font-bold text-blue-700 dark:text-blue-300">
                        <Sparkles className="size-3.5" />
                        بحث نشط
                      </div>
                      <p className="mt-1 truncate text-sm font-semibold">
                        نتائج ذكية من مساعد SmartStore AI
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200 sm:inline-flex">
                        مختارة حسب طلبك
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="rounded-full"
                        aria-label="مسح بحث المساعد"
                        onClick={clearAssistantSearch}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 text-base font-bold">
                    <Sparkles className="size-4 text-blue-600" />
                    الأقرب لطلبك
                  </div>

                  {assistantResultListings.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.25rem,11.5rem))] sm:justify-start">
                      {assistantResultListings.map((listing) => (
                        <ListingCardView
                          key={listing.id ?? listing.title}
                          listing={listing}
                          isFavorite={Boolean(
                            listing.id && favoriteListingIds.has(listing.id),
                          )}
                          isOwnListing={Boolean(
                            listing.sellerId && session.user?.id === listing.sellerId,
                          )}
                          onAsk={sendStarter}
                          onFavorite={favoriteListing}
                          onOpen={openListing}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-white p-4 text-center text-sm text-muted-foreground dark:bg-card">
                      لم أجد إعلانًا مناسبًا لهذا الطلب حاليًا.
                    </div>
                  )}
                </div>
              )}

              <div className="mb-3 flex items-center justify-end gap-3">
                <div className="flex items-center gap-2 text-base font-bold">
                  <Sparkles className="size-4 text-blue-600" />
                  {hasActiveAssistantSearch ? 'استكشف أيضًا' : 'الإعلانات المقترحة'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.25rem,11.5rem))] sm:justify-start">
                {exploreMarketplaceListings.map((listing) => (
                  <ListingCardView
                    key={listing.id ?? listing.title}
                    listing={listing}
                    isFavorite={Boolean(
                      listing.id && favoriteListingIds.has(listing.id),
                    )}
                    isOwnListing={Boolean(
                      listing.sellerId && session.user?.id === listing.sellerId,
                    )}
                    onAsk={sendStarter}
                    onFavorite={favoriteListing}
                    onOpen={openListing}
                  />
                ))}
              </div>

              <div ref={listingsLoadMoreRef} className="h-px" />

              {canLoadMoreListings && (
                <div className="mt-4 grid place-items-center">
                  <Button
                    variant="outline"
                    className="h-10 min-w-40 rounded-md"
                    disabled={isLoadingListings}
                    onClick={loadMoreListings}
                  >
                    {isLoadingListings ? 'جاري التحميل...' : 'عرض المزيد'}
                  </Button>
                </div>
              )}

              {exploreMarketplaceListings.length === 0 && (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed bg-white p-6 text-center dark:bg-card">
                  <div className="grid max-w-sm gap-3">
                    <Sparkles className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد إعلانات متاحة</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      ستظهر الإعلانات هنا عند توفرها في السوق.
                    </p>
                  </div>
                </div>
              )}

            </section>

            <section
              className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex h-72 translate-y-0 transform-gpu flex-col overflow-hidden rounded-t-[24px] border bg-white shadow-2xl shadow-slate-950/20 transition-[bottom,height,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-card lg:static lg:h-auto lg:max-h-none lg:min-h-0 lg:rounded-none lg:border-0 lg:shadow-none"
              style={assistantPanelStyle}
            >
              <header
                className="shrink-0 touch-none border-b px-4 py-3"
                onPointerDown={handleAssistantDragStart}
                onPointerUp={handleAssistantDragEnd}
                onTouchEnd={handleAssistantTouchEnd}
                onTouchStart={handleAssistantTouchStart}
              >
                <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600 lg:hidden" />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 place-items-center overflow-hidden rounded-full border border-sky-400/20 bg-slate-900/80 text-sky-300 shadow-sm shadow-sky-950/20 dark:bg-slate-950/70">
                      <Bot className="size-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold">مساعد SmartStore AI</h2>
                      <p className="text-[11px] text-muted-foreground">
                        {session.authenticated ? session.user?.email : 'التسجيل للعمليات فقط'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-sm" className="rounded-md" onClick={startNewChat} aria-label="محادثة جديدة">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </div>
                </div>
              </header>

              <div className={`flex min-h-0 flex-1 overflow-hidden transition-opacity duration-150 lg:pointer-events-auto lg:opacity-100 ${
                isAssistantExpanded
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0'
              }`}>
                <Conversation className="min-h-0 flex-1">
                  <ConversationContent className="gap-4 px-4 py-5">
                    <ConversationAutoScroll watchKey={scrollWatchKey} enabled />
                    {filteredMessages.length === 0 ? (
                      <div className="grid h-full place-items-center text-center">
                        <div className="grid max-w-xs gap-4">
                          <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-100 text-blue-700">
                            <MessageCircle className="size-7" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold">كيف أساعدك؟</h3>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">
                              بيع، بحث، مقارنة، صور، أو فتح شات بين البائع والمشتري.
                            </p>
                          </div>
                          <div className="grid gap-2">
                            {starters.map((prompt) => (
                              <Button
                                key={prompt}
                                variant="outline"
                                className="rounded-md"
                                disabled={isLoading || !hasRestoredChat}
                                onClick={() => sendStarter(prompt)}
                              >
                                {prompt}
                              </Button>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-2 rounded-md border bg-[#f7f9fc] p-2 dark:bg-background">
                            {featuredListings.slice(0, 3).map((listing) => (
                              <button
                                key={listing.title}
                                type="button"
                                className="grid gap-1 text-right"
                                onClick={() => sendStarter(`اعرض لي تفاصيل ${listing.title}`)}
                              >
                                {listing.image ? (
                                  <img alt={listing.title} className="aspect-square rounded-md object-cover" src={listing.image} />
                                ) : (
                                  <div className="grid aspect-square place-items-center rounded-md bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                    <ImageIcon className="size-4" />
                                  </div>
                                )}
                                <span className="truncate text-[10px] font-semibold">{listing.price}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {filteredMessages.map((message, messageIndex) => (
                          <Message key={`${message.id}-${messageIndex}`} from={message.role}>
                            {message.role === 'assistant' ? (
                              <AssistantMessageFrame>
                                <MessageContent>{renderMessageParts(message.parts)}</MessageContent>
                              </AssistantMessageFrame>
                            ) : (
                              <MessageContent>{renderMessageParts(message.parts)}</MessageContent>
                            )}
                          </Message>
                        ))}
                        {isLoading && (
                          <Message from="assistant">
                            <AssistantMessageFrame>
                              <MessageContent>
                                <SearchStatusIndicator language="ar" mode="thinking" />
                              </MessageContent>
                            </AssistantMessageFrame>
                          </Message>
                        )}
                        {chatErrorMessage && (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {chatErrorMessage}
                          </div>
                        )}
                      </>
                    )}
                  </ConversationContent>
                  <ConversationScrollButton className="bottom-24" />
                </Conversation>
              </div>

              <div
                className="shrink-0 border-t p-3"
                onBlur={handleChatInputBlur}
                onFocus={handleChatInputFocus}
                onPointerDown={(event) => {
                  if (!isAssistantExpanded) {
                    event.stopPropagation();
                    handleChatInputFocus();
                  }
                }}
              >
                <PromptInput
                  accept="image/*"
                  allowAttachments
                  className="mx-auto max-w-[52rem]"
                  dir="ltr"
                  inputGroupClassName="items-end rounded-[1.65rem] border border-border/80 bg-card shadow-lg shadow-slate-200/70 transition-[border-color,box-shadow] duration-200 focus-within:border-primary/70 focus-within:shadow-primary/15 dark:border-slate-700/80 dark:bg-slate-950/50 dark:shadow-slate-950/10 dark:focus-within:border-blue-400/70 dark:focus-within:shadow-blue-950/20"
                  inputGroupStyle={chatInputGroupStyle}
                  maxFileSize={12 * 1024 * 1024}
                  maxFiles={chatMaxAttachments}
                  multiple
                  onSubmit={handleSubmit}
                >
                  <ChatAttachmentPreviewStrip maxFiles={chatMaxAttachments} />
                  <ChatSubmitButton status={status} />
                  <PromptInputBody>
                    <PromptInputTextarea
                      className="col-start-2 row-start-2 max-h-36 min-h-14 resize-none px-1 py-4 text-right text-base leading-7 text-foreground placeholder:text-muted-foreground sm:min-h-16 dark:text-slate-100 dark:placeholder:text-slate-400"
                      dir="rtl"
                      placeholder="اكتب طلبك أو أرفق صور المنتج..."
                      style={chatInputTextAreaStyle}
                    />
                  </PromptInputBody>
                  <ChatAttachmentControls />
                </PromptInput>
              </div>
            </section>
          </div>
        </section>

      </div>
    </main>
  );
}
