'use client';
/* eslint-disable @next/next/no-img-element */

import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type ReactElement,
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
  Bot,
  Clock3,
  Download,
  Heart,
  ImageIcon,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Search,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Megaphone,
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
import { CommissionAgreementDialog } from '@/components/commission-agreement-dialog';
import { CitySelector } from '@/components/city-selector';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { ListingShareButton } from '@/components/listing-share-button';
import { PushNotificationSettings } from '@/components/push-notification-settings';
import { ResilientImage } from '@/components/resilient-image';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  chatServiceUnavailableMessage,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';
import { prepareUploadableImageFiles } from '@/lib/client-image-normalization';
import {
  getAssistantResultListings,
  getCanLoadMoreExploreListings,
  getExploreListings,
} from '@/lib/chat-listing-display';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { useAuthSession } from '@/hooks/use-auth-session';
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
import { cn } from '@/lib/utils';
import { isAssistantSearchToolOutput } from '@/lib/chat-tool-results';
import { saudiMarketplaceCities } from '@/lib/marketplace/cities';

type LocationSettings = {
  country: 'SA';
  currency: string;
  language: 'ar';
};

type MarketplaceCityCoordinate = {
  city: string;
  latitude: number;
  longitude: number;
};

type ListingCard = {
  id?: string;
  sellerId?: string;
  title: string;
  price: string;
  city: string;
  image: string | null;
  imageFallbacks?: string[];
  category?: string;
  status?: string;
  stats?: string;
  description?: string;
  timeLabel?: string;
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
  imageUrls?: Array<string | undefined>;
  status?: string;
  views?: number;
  messageCount?: number;
  favoriteCount?: number;
  createdAt?: string;
  updatedAt?: string;
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

type HomeAssistantRuntimeState = {
  messages: UIMessage[];
  activeListingQuery: string;
  selectedListingContext: SelectedListingContext | null;
  retainedListingImages: RetainedListingImage[];
  shouldResetSearchState: boolean;
};

let homeAssistantRuntimeState: HomeAssistantRuntimeState | null = null;

function readHomeAssistantRuntimeState() {
  return homeAssistantRuntimeState;
}

function writeHomeAssistantRuntimeState(state: HomeAssistantRuntimeState) {
  homeAssistantRuntimeState = state;
}

function clearHomeAssistantRuntimeState() {
  homeAssistantRuntimeState = null;
}

function isSafeListingId(value: string | null): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]+$/.test(value));
}

const authRequiredMarker = '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]]';
const chatRateLimitMessage =
  'الضغط مرتفع الآن على حمد. انتظر لحظات ثم أعد إرسال الطلب.';
const chatNetworkErrorMessage =
  'تعذر تحميل رد المساعد. تأكد من الاتصال ثم أعد إرسال الطلب.';
const chatSessionExpiredMessage =
  'انتهت صلاحية جلسة الدخول. يرجى تسجيل الدخول من جديد ثم إعادة المحاولة.';
const locationSettings: LocationSettings = {
  country: 'SA',
  currency: 'SAR',
  language: 'ar',
};
const currentChatStorageKey = 'smartstore-current-chat-v1';
const retainedListingImagesDatabaseName = 'smartstore-listing-images-v1';
const retainedListingImagesStoreName = 'listing-images';
const retainedListingImagesRecordKey = 'latest';
const assistantBubblePositionStorageKey = 'smartstore-ai-bubble-position-v1';
const assistantMarketplaceScrollStorageKey =
  'smartstore-marketplace-scroll-y-v1';
const assistantDragThreshold = 60;
const assistantBubbleSize = 64;
const assistantBubbleMargin = 14;
const assistantBubbleBottomReserve = 92;
const assistantBubbleDragThreshold = 8;
const chatMaxAttachments = 8;
const chatInputGroupStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2.75rem minmax(0, 1fr) 2.75rem',
  height: 'auto',
  minHeight: '3rem',
};
const chatInputTextAreaStyle: CSSProperties = {
  gridColumn: '2',
  gridRow: '2',
  minHeight: '2.5rem',
};
const chatSubmitButtonStyle: CSSProperties = {
  gridColumn: '1',
  gridRow: '2',
  height: '2.25rem',
  width: '2.25rem',
};
const chatAttachmentControlsStyle: CSSProperties = {
  gridColumn: '3',
  gridRow: '2',
};

type ChatTapTracker = {
  pointerId: number | null;
  startX: number;
  startY: number;
  startAt: number;
  moved: boolean;
  lastTapAt: number;
};

function createEmptyChatTapTracker(): ChatTapTracker {
  return {
    pointerId: null,
    startX: 0,
    startY: 0,
    startAt: 0,
    moved: false,
    lastTapAt: 0,
  };
}

function isKeyboardDismissIgnoredTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'a, button, input, textarea, select, [role="button"], [contenteditable="true"]',
      ),
    )
  );
}

type PendingChatAttachment = FileUIPart & { id: string };

type AssistantBubblePosition = {
  x: number;
  y: number;
};

type AssistantBubbleDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  hasDragged: boolean;
};

type VisualViewportFrame = {
  height: number;
  offsetTop: number;
};

function getAttachmentLabel(file: PendingChatAttachment) {
  return file.filename || (file.mediaType?.startsWith('image/') ? 'صورة مرفقة' : 'ملف مرفق');
}

function getAssistantBubbleBounds() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const minX = assistantBubbleMargin;
  const maxX = Math.max(minX, width - assistantBubbleSize - assistantBubbleMargin);
  const minY = assistantBubbleMargin;
  const maxY = Math.max(
    minY,
    height - assistantBubbleSize - assistantBubbleBottomReserve,
  );

  return { minX, maxX, minY, maxY };
}

function clampAssistantBubblePosition(position: AssistantBubblePosition) {
  const bounds = getAssistantBubbleBounds();

  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
  };
}

function getDefaultAssistantBubblePosition() {
  return clampAssistantBubblePosition({
    x: window.innerWidth - assistantBubbleSize - assistantBubbleMargin,
    y: window.innerHeight - assistantBubbleSize - assistantBubbleBottomReserve,
  });
}

function readAssistantBubblePosition() {
  try {
    const rawPosition = localStorage.getItem(assistantBubblePositionStorageKey);

    if (!rawPosition) {
      return null;
    }

    const parsed = JSON.parse(rawPosition) as Partial<AssistantBubblePosition>;

    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null;
    }

    return clampAssistantBubblePosition({ x: parsed.x, y: parsed.y });
  } catch {
    return null;
  }
}

function writeAssistantBubblePosition(position: AssistantBubblePosition) {
  try {
    localStorage.setItem(
      assistantBubblePositionStorageKey,
      JSON.stringify(position),
    );
  } catch {
    // Position persistence is an enhancement only.
  }
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
      className="m-1 flex h-10 items-center justify-end gap-1 self-end"
      dir="ltr"
      style={chatAttachmentControlsStyle}
    >
      <Button
        aria-label="إرفاق صور المنتج"
        className="size-9 rounded-xl border border-border/80 bg-card text-primary shadow-sm hover:bg-accent hover:text-primary dark:border-white/10 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white"
        onClick={attachments.openFileDialog}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <ImageIcon className="size-5" />
      </Button>
    </div>
  );
}

function ChatSubmitButton({ status }: { status: ChatStatus }) {
  const isBusy = status === 'submitted' || status === 'streaming';

  return (
    <Button
      aria-label={isBusy ? 'جار الإرسال' : 'إرسال'}
      className="col-start-1 row-start-2 m-1 size-9 self-end rounded-xl bg-sky-400 text-slate-950 shadow-md shadow-sky-950/20 transition duration-200 hover:bg-sky-300 disabled:opacity-80"
      disabled={isBusy}
      onPointerDown={(event) => event.preventDefault()}
      size="icon-sm"
      style={chatSubmitButtonStyle}
      type="submit"
    >
      {status === 'submitted' ? (
        <Loader2 className="size-4 animate-spin" />
      ) : status === 'streaming' ? (
        <Square className="size-3.5" />
      ) : (
        <SendHorizontal className="size-4" />
      )}
    </Button>
  );
}

const featuredListings: ListingCard[] = [];

const starters = [
  'أريد بيع منتج',
  'أبحث عن منتج',
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

function getDurableImageUrls(...urls: Array<string | undefined>) {
  return urls.filter((url, index, list): url is string => {
    return (
      typeof url === 'string' &&
      url.length > 0 &&
      !url.startsWith('/uploads/listings/') &&
      list.indexOf(url) === index
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
    women_supplies: 'مستلزمات نسائية',
    men_supplies: 'مستلزمات رجالية',
    tools_equipment: 'معدات وأدوات',
    watches_accessories: 'ساعات وإكسسوارات',
    beauty: 'العناية والتجميل',
    other: 'أخرى',
  };

  return labels[category] ?? category;
}

const marketplaceCategoryGroups = [
  {
    label: 'إلكترونيات',
    categories: ['الجوالات', 'الأجهزة'],
  },
  {
    label: 'سيارات ومركبات',
    categories: ['السيارات', 'قطع الغيار'],
  },
  {
    label: 'العقار',
    categories: ['العقارات'],
  },
  {
    label: 'البيت والأثاث',
    categories: ['الأثاث', 'المنزل والحديقة'],
  },
  {
    label: 'أزياء ومستلزمات',
    categories: [
      'الموضة',
      'مستلزمات نسائية',
      'مستلزمات رجالية',
      'ساعات وإكسسوارات',
      'العناية والتجميل',
      'مستلزمات الأطفال',
    ],
  },
  {
    label: 'رياضة وهوايات وتعليم',
    categories: ['الرياضة', 'الألعاب والهوايات', 'الكتب والتعليم'],
  },
  {
    label: 'معدات وأدوات',
    categories: ['معدات وأدوات'],
  },
  {
    label: 'الخدمات العامة',
    categories: ['أخرى'],
  },
] satisfies Array<{ label: string; categories: string[] }>;

const manualListingCategoryOptions = [
  'cars',
  'auto_parts',
  'mobile_phones',
  'computers',
  'real_estate',
  'furniture',
  'fashion',
  'women_supplies',
  'men_supplies',
  'kids',
  'home_garden',
  'sports',
  'gaming_hobbies',
  'books_education',
  'tools_equipment',
  'watches_accessories',
  'beauty',
  'other',
] satisfies string[];

const manualListingConditionOptions = [
  { value: 'new', label: 'جديد' },
  { value: 'like_new', label: 'شبه جديد' },
  { value: 'used', label: 'مستعمل' },
  { value: 'damaged', label: 'يحتاج إصلاح' },
] as const;

type ManualListingForm = {
  title: string;
  description: string;
  priceMode: 'number' | 'bid' | 'negotiable';
  price: string;
  city: string;
  category: string;
  condition: 'new' | 'used' | 'like_new' | 'damaged';
};

type ManualListingNotice = {
  tone: 'success' | 'warning' | 'danger' | 'info';
  title?: string;
  message: string;
  statusLabel?: string;
  shareListingId?: string;
  shareTitle?: string;
};

type ManualListingSubmission = 'saving' | 'saving_and_publishing';

const defaultManualListingForm: ManualListingForm = {
  title: '',
  description: '',
  priceMode: 'number',
  price: '',
  city: '',
  category: 'other',
  condition: 'used',
};

// Shared with every city selector so listing creation, editing, and search stay aligned.

function marketplaceCityCoordinate(
  city: string,
  latitude: number,
  longitude: number,
): MarketplaceCityCoordinate | null {
  return saudiMarketplaceCities.includes(city)
    ? { city, latitude, longitude }
    : null;
}

const marketplaceCityCoordinates = [
  marketplaceCityCoordinate('الرياض', 24.7136, 46.6753),
  marketplaceCityCoordinate('الدرعية', 24.734, 46.575),
  marketplaceCityCoordinate('الخرج', 24.1557, 47.312),
  marketplaceCityCoordinate('الدوادمي', 24.5077, 44.3924),
  marketplaceCityCoordinate('المجمعة', 25.9045, 45.3455),
  marketplaceCityCoordinate('القويعية', 24.0717, 45.2808),
  marketplaceCityCoordinate('وادي الدواسر', 20.4597, 44.8501),
  marketplaceCityCoordinate('الزلفي', 26.2995, 44.8154),
  marketplaceCityCoordinate('شقراء', 25.252, 45.252),
  marketplaceCityCoordinate('عفيف', 23.9065, 42.9172),
  marketplaceCityCoordinate('مكة المكرمة', 21.3891, 39.8579),
  marketplaceCityCoordinate('جدة', 21.4858, 39.1925),
  marketplaceCityCoordinate('الطائف', 21.4373, 40.5127),
  marketplaceCityCoordinate('القنفذة', 19.1264, 41.0789),
  marketplaceCityCoordinate('رابغ', 22.7986, 39.0349),
  marketplaceCityCoordinate('بحرة', 21.4024, 39.4849),
  marketplaceCityCoordinate('المدينة المنورة', 24.5247, 39.5692),
  marketplaceCityCoordinate('ينبع', 24.0895, 38.0618),
  marketplaceCityCoordinate('العلا', 26.6085, 37.9232),
  marketplaceCityCoordinate('بدر', 23.7829, 38.7905),
  marketplaceCityCoordinate('الدمام', 26.4207, 50.0888),
  marketplaceCityCoordinate('الخبر', 26.2172, 50.1971),
  marketplaceCityCoordinate('الظهران', 26.2361, 50.0393),
  marketplaceCityCoordinate('الأحساء', 25.3833, 49.6),
  marketplaceCityCoordinate('القطيف', 26.5652, 50.0089),
  marketplaceCityCoordinate('الجبيل', 27.0046, 49.646),
  marketplaceCityCoordinate('حفر الباطن', 28.4328, 45.9708),
  marketplaceCityCoordinate('الخفجي', 28.4391, 48.4913),
  marketplaceCityCoordinate('رأس تنورة', 26.6437, 50.1592),
  marketplaceCityCoordinate('بقيق', 25.934, 49.6688),
  marketplaceCityCoordinate('بريدة', 26.3592, 43.9818),
  marketplaceCityCoordinate('عنيزة', 26.0913, 43.9875),
  marketplaceCityCoordinate('الرس', 25.8694, 43.4973),
  marketplaceCityCoordinate('البدائع', 26.1442, 43.6578),
  marketplaceCityCoordinate('أبها', 18.2164, 42.5053),
  marketplaceCityCoordinate('خميس مشيط', 18.3064, 42.7292),
  marketplaceCityCoordinate('بيشة', 20.0087, 42.5987),
  marketplaceCityCoordinate('النماص', 19.1458, 42.1207),
  marketplaceCityCoordinate('أحد رفيدة', 18.55, 42.05),
  marketplaceCityCoordinate('حائل', 27.5114, 41.7208),
  marketplaceCityCoordinate('بقعاء', 27.8877, 42.4105),
  marketplaceCityCoordinate('تبوك', 28.3838, 36.5662),
  marketplaceCityCoordinate('الوجه', 26.2455, 36.4525),
  marketplaceCityCoordinate('ضباء', 27.3493, 35.6977),
  marketplaceCityCoordinate('تيماء', 27.6338, 38.5543),
  marketplaceCityCoordinate('أملج', 25.0213, 37.2685),
  marketplaceCityCoordinate('حقل', 29.2833, 34.95),
  marketplaceCityCoordinate('جازان', 16.8892, 42.5611),
  marketplaceCityCoordinate('صبيا', 17.1495, 42.6254),
  marketplaceCityCoordinate('أبو عريش', 16.9689, 42.8325),
  marketplaceCityCoordinate('صامطة', 16.596, 42.9448),
  marketplaceCityCoordinate('بيش', 17.3753, 42.5247),
  marketplaceCityCoordinate('الدرب', 17.7229, 42.2526),
  marketplaceCityCoordinate('أحد المسارحة', 16.7059, 42.1182),
  marketplaceCityCoordinate('نجران', 17.5446, 44.2289),
  marketplaceCityCoordinate('شرورة', 17.4667, 47.1),
  marketplaceCityCoordinate('حبونا', 17.83, 44.32),
  marketplaceCityCoordinate('الباحة', 20.0129, 41.4677),
  marketplaceCityCoordinate('بلجرشي', 19.8618, 41.5776),
  marketplaceCityCoordinate('سكاكا', 29.9697, 40.2064),
  marketplaceCityCoordinate('القريات', 31.3318, 37.3428),
  marketplaceCityCoordinate('عرعر', 30.9753, 41.0381),
].filter(
  (cityCoordinate): cityCoordinate is MarketplaceCityCoordinate =>
    Boolean(cityCoordinate),
);

function getDistanceInKilometers(
  first: Pick<MarketplaceCityCoordinate, 'latitude' | 'longitude'>,
  second: Pick<MarketplaceCityCoordinate, 'latitude' | 'longitude'>,
) {
  const earthRadiusInKilometers = 6371;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    earthRadiusInKilometers *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function getNearestMarketplaceCity(
  latitude: number,
  longitude: number,
): MarketplaceCityCoordinate | null {
  return (
    marketplaceCityCoordinates
      .map((cityCoordinate) => ({
        ...cityCoordinate,
        distance: getDistanceInKilometers(
          { latitude, longitude },
          cityCoordinate,
        ),
      }))
      .sort((first, second) => first.distance - second.distance)[0] ?? null
  );
}

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

function getLatestSearchToolOutput(
  messages: UIMessage[],
  options: { afterLatestUserOnly?: boolean } = {},
) {
  const latestUserMessageIndex = messages.findLastIndex(
    (message) => message.role === 'user',
  );
  const firstEligibleAssistantIndex =
    options.afterLatestUserOnly === false
      ? 0
      : latestUserMessageIndex === -1
        ? 0
        : latestUserMessageIndex + 1;

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
        isAssistantSearchToolOutput(part.output)
      ) {
        return part.output;
      }

      if (
        part.type === 'tool-compareMarketplaceListings' &&
        'state' in part &&
        part.state === 'output-available' &&
        'output' in part &&
        isAssistantSearchToolOutput(part.output)
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
  const imageUrls = getDurableImageUrls(
    listing.image,
    ...(listing.imageUrls ?? []),
    primaryImage?.thumbnailUrl,
    primaryImage?.displayUrl,
    primaryImage?.originalUrl,
  );

  return {
    id: listing.id,
    sellerId: listing.sellerId,
    title: listing.title ?? 'إعلان بدون عنوان',
    price: formatListingPrice(listing.price),
    city: listing.city ?? 'السعودية',
    category: formatCategory(listing.category),
    description: listing.description,
    image: imageUrls[0] ?? null,
    imageFallbacks: imageUrls.slice(1),
    status: formatListingStatus(listing.status),
    timeLabel: formatListingRelativeTime(listing.createdAt ?? listing.updatedAt),
    stats:
      typeof listing.views === 'number'
        ? `${listing.views} مشاهدة · ${listing.messageCount ?? 0} رسائل`
        : undefined,
  };
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

function getListingHrefFromMarkdownLink(label: string, href: string) {
  const normalizedLabel = label.trim().toLowerCase();
  const isListingActionLabel =
    normalizedLabel === 'فتح الإعلان' ||
    normalizedLabel === 'فتح الاعلان' ||
    normalizedLabel === 'open listing';

  try {
    const url = new URL(href, 'https://smartstore-ai.local');
    const isListingPath = /^\/listings\/[^/]+/.test(url.pathname);

    if (isListingPath && (isListingActionLabel || url.pathname.startsWith('/listings/'))) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}

function getListingIdFromHref(href: string) {
  try {
    const url = new URL(href, 'https://smartstore-ai.local');
    const match = url.pathname.match(/^\/listings\/([^/]+)/);

    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

const maxChatListingCardsPerMessage = 3;
const moreChatListingsGuidance = 'يمكنك مشاهدة إعلانات أكثر في الصفحة الرئيسية.';

function ListingChatLinkCard({
  href,
  listing,
}: {
  href: string;
  listing?: ListingCard;
}) {
  return (
    <Link
      className="my-2 grid gap-2 rounded-md border border-blue-200 bg-blue-50/80 p-3 text-right text-blue-950 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-50 dark:hover:border-blue-300/40"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-blue-700 dark:text-blue-200">
            إعلان من سوق حمد
          </div>
          <div className="mt-1 text-sm font-bold">عرض بطاقة الإعلان</div>
          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
            افتح تفاصيل الإعلان والصور وخيارات التواصل من صفحة الإعلان.
          </div>
        </div>
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-slate-100 text-blue-700 shadow-sm shadow-blue-950/10 dark:bg-slate-900 dark:text-blue-200">
          {listing?.image ? (
            <>
              <ResilientImage
                alt={listing.title}
                className="h-full w-full object-contain"
                decoding="async"
                fallbackSrcs={listing.imageFallbacks}
                fallback={<Megaphone className="size-5" />}
                loading="lazy"
                src={listing.image}
              />
            </>
          ) : (
            <Megaphone className="size-5" />
          )}
        </div>
      </div>
      <span className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
        فتح الإعلان
        <ChevronLeft className="size-3.5" />
      </span>
    </Link>
  );
}

function renderTextMessagePart(
  text: string,
  index: number,
  listingsById: ReadonlyMap<string, ListingCard>,
): ReactElement[] {
  const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  const renderedParts: ReactElement[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let renderedListingCardCount = 0;
  let omittedListingCardCount = 0;

  while ((match = markdownLinkPattern.exec(text)) !== null) {
    const [rawLink, label, href] = match;
    const listingHref = getListingHrefFromMarkdownLink(label, href);

    if (!listingHref) {
      continue;
    }

    const precedingText = text.slice(lastIndex, match.index).trim();
    if (precedingText) {
      renderedParts.push(
        <MessageResponse key={`text-${index}-${renderedParts.length}`}>
          {precedingText}
        </MessageResponse>,
      );
    }

    if (renderedListingCardCount < maxChatListingCardsPerMessage) {
      renderedParts.push(
        <ListingChatLinkCard
          key={`listing-link-${index}-${renderedParts.length}`}
          href={listingHref}
          listing={
            listingsById.get(getListingIdFromHref(listingHref) ?? '') ??
            undefined
          }
        />,
      );
      renderedListingCardCount += 1;
    } else {
      omittedListingCardCount += 1;
    }
    lastIndex = match.index + rawLink.length;
  }

  const trailingText = text.slice(lastIndex).trim();
  if (trailingText) {
    renderedParts.push(
      <MessageResponse key={`text-${index}-${renderedParts.length}`}>
        {trailingText}
      </MessageResponse>,
    );
  }

  if (omittedListingCardCount > 0) {
    renderedParts.push(
      <MessageResponse key={`more-listings-${index}`}>
        {moreChatListingsGuidance}
      </MessageResponse>,
    );
  }

  return renderedParts.length > 0
    ? renderedParts
    : [<MessageResponse key={`text-${index}`}>{text}</MessageResponse>];
}

function renderMessageParts(
  parts: UIMessage['parts'],
  listingsById: ReadonlyMap<string, ListingCard>,
): ReactNode[] {
  return parts.flatMap((part, index) => {
    if (part.type === 'text') {
      if (part.text.includes(authRequiredMarker)) {
        return [<SignInCard key={`auth-${index}`} text={part.text} />];
      }

      return renderTextMessagePart(part.text, index, listingsById);
    }

    if (part.type === 'file') {
      return [<MessageAttachment key={`file-${index}`} data={part} />];
    }

    return [];
  });
}

function isUserImageMessagePart(
  part: UIMessage['parts'][number],
): part is Extract<UIMessage['parts'][number], { type: 'file' }> {
  return (
    part.type === 'file' &&
    typeof part.mediaType === 'string' &&
    part.mediaType.startsWith('image/') &&
    typeof part.url === 'string'
  );
}

function isRenderableUserBubblePart(part: UIMessage['parts'][number]) {
  if (isUserImageMessagePart(part)) {
    return false;
  }

  if (part.type === 'text') {
    return part.text.trim().length > 0;
  }

  return true;
}

function ListingCardView({
  listing,
  isFavorite,
  isOwnListing,
  className,
  onAsk,
  onFavorite,
  onOpen,
  prioritizeImage = false,
  isSmartResult = false,
  style,
  variant = 'grid',
}: {
  listing: ListingCard;
  isFavorite: boolean;
  isOwnListing: boolean;
  className?: string;
  isSmartResult?: boolean;
  onAsk: (prompt: string, listing?: ListingCard) => void;
  onFavorite: (listing: ListingCard) => void;
  onOpen: (listing: ListingCard) => void;
  prioritizeImage?: boolean;
  style?: CSSProperties;
  variant?: 'grid' | 'horizontal';
}) {
  const listingImageFallback = (
    <div className="grid h-full w-full place-items-center bg-slate-100 text-center text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
      <div className="grid gap-1">
        <ImageIcon className="mx-auto size-5" />
        <span>لا توجد صورة حقيقية</span>
      </div>
    </div>
  );
  const askToCompareListing = () => {
    onAsk(
      listing.id
        ? `قارن لي الإعلان رقم ${listing.id} (${listing.title}) بالسوق`
        : `قارن لي إعلان ${listing.title} بالسوق`,
      listing,
    );
  };

  if (variant === 'horizontal') {
    return (
      <article
        className={cn(
          'marketplace-listing-card group relative grid w-full min-w-0 cursor-pointer grid-cols-[6.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-sm transition hover:border-blue-300 hover:bg-blue-50/35 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10 sm:grid-cols-[7.25rem_minmax(0,1fr)]',
          '[contain-intrinsic-size:126px] [content-visibility:auto]',
          className,
        )}
        onClick={() => onOpen(listing)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(listing);
          }
        }}
        role="button"
        style={style}
        tabIndex={0}
      >
        <Button
          size="icon-sm"
          variant="outline"
          className={cn(
            'absolute left-1.5 top-1.5 z-10 size-7 rounded-md p-0 shadow-sm ring-1 sm:left-2 sm:top-2 sm:size-8',
            isSmartResult
              ? 'border-cyan-300 bg-cyan-50/95 text-cyan-700 shadow-cyan-400/35 ring-2 ring-cyan-200/70 hover:bg-cyan-100 hover:text-cyan-800 dark:border-cyan-300/40 dark:bg-cyan-400/15 dark:text-cyan-100 dark:ring-cyan-300/25 dark:hover:bg-cyan-400/20'
              : 'border-sky-200 bg-white/95 text-blue-600 ring-slate-950/5 hover:bg-sky-50 hover:text-blue-700 dark:border-sky-400/20 dark:bg-slate-950/85 dark:text-blue-200 dark:ring-white/10 dark:hover:bg-slate-900',
          )}
          aria-label="مقارنة الإعلان"
          onClick={(event) => {
            event.stopPropagation();
            askToCompareListing();
          }}
        >
          <Sparkles
            className={cn(
              'size-3.5 sm:size-4',
              isSmartResult &&
                'fill-current drop-shadow-[0_0_6px_rgba(34,211,238,0.85)]',
            )}
          />
        </Button>
        <div className="relative aspect-square min-h-[6.25rem] bg-slate-100 dark:bg-slate-900 sm:min-h-[7.25rem]">
          {listing.image ? (
            <>
              <ResilientImage
                alt={listing.title}
                className="h-full w-full object-cover"
                decoding="async"
                fallbackSrcs={listing.imageFallbacks}
                fallback={listingImageFallback}
                fetchPriority={prioritizeImage ? 'high' : 'auto'}
                loading={prioritizeImage ? 'eager' : 'lazy'}
                src={listing.image}
              />
            </>
          ) : (
            <div className="grid h-full w-full place-items-center bg-slate-100 text-center text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <div className="grid gap-1">
                <ImageIcon className="mx-auto size-5" />
                <span>لا توجد صورة حقيقية</span>
              </div>
            </div>
          )}
        </div>
        <div className="grid min-w-0 content-between gap-1 px-2 py-1.5 sm:px-3 sm:py-2">
          <h3 className="line-clamp-2 text-[13px] font-bold leading-5 text-emerald-600 dark:text-emerald-300 sm:text-sm">
            {listing.title}
          </h3>
          <div className="text-[15px] font-black leading-6 text-slate-900 dark:text-white">
            {listing.price}
          </div>
          <div className="flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1">
              <Clock3 className="size-3.5 shrink-0" />
              <span className="truncate">{listing.timeLabel ?? 'وقت غير محدد'}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin className="size-3.5 shrink-0" />
              <span className="truncate">{listing.city}</span>
            </span>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2 text-[11px] leading-5 text-muted-foreground">
            <span className="truncate">{listing.category ?? listing.status ?? 'إعلان'}</span>
            {listing.stats && (
              <span className="truncate text-[10px]">{listing.stats}</span>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'marketplace-listing-card relative w-full min-w-0 cursor-pointer overflow-hidden rounded-md border bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:bg-card sm:max-w-[11.5rem]',
        '[contain-intrinsic-size:320px] [content-visibility:auto]',
        className,
      )}
      onClick={() => onOpen(listing)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(listing);
        }
      }}
      role="button"
      style={style}
      tabIndex={0}
    >
      <div className="relative aspect-[16/10] bg-slate-100 dark:bg-slate-900">
        {listing.image ? (
          <>
            <ResilientImage
              alt={listing.title}
              className="h-full w-full object-contain"
              decoding="async"
              fallbackSrcs={listing.imageFallbacks}
              fallback={listingImageFallback}
              fetchPriority={prioritizeImage ? 'high' : 'auto'}
              loading={prioritizeImage ? 'eager' : 'lazy'}
              src={listing.image}
            />
          </>
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
            'absolute right-1.5 top-1.5 size-7 rounded-md border border-white/80 bg-white/95 shadow-sm ring-1 ring-slate-950/5 hover:bg-white sm:right-2 sm:top-2 sm:size-8',
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
        <Button
          size="icon-sm"
          variant="outline"
          className="absolute left-1.5 top-1.5 size-7 rounded-md border-sky-200 bg-white/95 p-0 text-blue-600 shadow-sm ring-1 ring-slate-950/5 hover:bg-sky-50 hover:text-blue-700 dark:border-sky-400/20 dark:bg-slate-950/85 dark:text-blue-200 dark:ring-white/10 dark:hover:bg-slate-900 sm:left-2 sm:top-2 sm:size-8"
          aria-label="مقارنة الإعلان"
          onClick={(event) => {
            event.stopPropagation();
            askToCompareListing();
          }}
        >
          <Sparkles className="size-3.5 sm:size-4" />
        </Button>
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
        <div className="border-t pt-1.5">
          <Button
            size="sm"
            className="h-7 w-full rounded-md bg-blue-600 text-[11px] hover:bg-blue-700"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(listing);
            }}
          >
            <MessageCircle className="size-3 sm:size-3.5" />
            تواصل
          </Button>
        </div>
      </div>
    </article>
  );
}

function AssistantMessageFrame({
  avatar = 'bot',
  children,
}: {
  avatar?: 'bot' | 'hamad';
  children: ReactNode;
}) {
  const isHamadAvatar = avatar === 'hamad';

  return (
    <div className="flex w-full items-start gap-2">
      <div
        className={cn(
          'mt-1 grid shrink-0 place-items-center overflow-hidden rounded-full border bg-slate-900/80 text-sky-300 shadow-sm shadow-sky-950/20 dark:bg-slate-950/70',
          isHamadAvatar
            ? 'size-10 border-sky-400/45 shadow-md shadow-sky-500/20'
            : 'size-7 border-sky-400/20',
        )}
      >
        {isHamadAvatar ? (
          <img
            alt=""
            aria-hidden="true"
            className="size-full rounded-full object-cover"
            src="/hamad-assistant-avatar.webp"
          />
        ) : (
          <Bot className="size-3.5" />
        )}
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
    return chatNetworkErrorMessage;
  }

  if (error.message === chatRateLimitMessage) {
    return chatRateLimitMessage;
  }

  if (error.message === chatNetworkErrorMessage) {
    return chatNetworkErrorMessage;
  }

  if (error.message === chatSessionExpiredMessage) {
    return chatSessionExpiredMessage;
  }

  return chatServiceUnavailableMessage;
}

function createClientIdempotencyKey(scope: string) {
  if (typeof crypto.randomUUID === 'function') {
    return `${scope}:${crypto.randomUUID()}`;
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const fallbackId = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${scope}:${fallbackId}`;
}

const guardedChatFetch: typeof fetch = async (input, init) => {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(chatNetworkErrorMessage);
  }

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

    if (response.status === 401 || response.status === 403) {
      throw new Error(chatSessionExpiredMessage);
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
  const { isSessionLoading, session, setSession } = useAuthSession();
  const [marketplaceListings, setMarketplaceListings] =
    useState<ListingCard[]>(featuredListings);
  const [selectedMarketCategoryGroup, setSelectedMarketCategoryGroup] =
    useState('all');
  const [selectedMarketSubcategory, setSelectedMarketSubcategory] =
    useState('all');
  const [selectedMarketCity, setSelectedMarketCity] = useState('all');
  const [nearbyMarketplaceCity, setNearbyMarketplaceCity] =
    useState<string | null>(null);
  const [nearbyMarketplaceNotice, setNearbyMarketplaceNotice] = useState('');
  const [isLocatingNearbyListings, setIsLocatingNearbyListings] =
    useState(false);
  const [marketplaceSearchInput, setMarketplaceSearchInput] = useState('');
  const [marketplaceSearchQuery, setMarketplaceSearchQuery] = useState('');
  const [isMarketFilterOpen, setIsMarketFilterOpen] = useState(false);
  const [isManualListingOpen, setIsManualListingOpen] = useState(false);
  const [manualListingForm, setManualListingForm] =
    useState<ManualListingForm>(defaultManualListingForm);
  const [manualListingImages, setManualListingImages] = useState<File[]>([]);
  const [manualListingImagePreviewUrls, setManualListingImagePreviewUrls] =
    useState<string[]>([]);
  const [manualListingImagePreviewIndex, setManualListingImagePreviewIndex] =
    useState<number | null>(null);
  const [isPreparingManualListingImages, setIsPreparingManualListingImages] =
    useState(false);
  const [manualListingNotice, setManualListingNotice] =
    useState<ManualListingNotice | null>(null);
  const [manualListingSubmission, setManualListingSubmission] =
    useState<ManualListingSubmission | null>(null);
  const manualListingSubmissionRef = useRef<ManualListingSubmission | null>(null);
  const [isManualPublishAgreementOpen, setIsManualPublishAgreementOpen] =
    useState(false);
  const [isManualListingFallbackDismissed, setIsManualListingFallbackDismissed] =
    useState(false);
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
  const [isMobileChatViewOpen, setIsMobileChatViewOpen] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(true);
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [visualViewportFrame, setVisualViewportFrame] =
    useState<VisualViewportFrame | null>(null);
  const [assistantBubblePosition, setAssistantBubblePosition] =
    useState<AssistantBubblePosition | null>(null);
  const [hasAssistantBubbleAttention, setHasAssistantBubbleAttention] =
    useState(false);
  const retainedListingImagesRef = useRef<RetainedListingImage[]>([]);
  const lastSyncedAssistantMessageIdRef = useRef<string | null>(null);
  const assistantDragStartYRef = useRef<number | null>(null);
  const assistantBubbleDragRef = useRef<AssistantBubbleDragState | null>(null);
  const assistantBubbleRef = useRef<HTMLButtonElement | null>(null);
  const lastAssistantBubbleMessageIdRef = useRef<string | null>(null);
  const handledListingAssistantRef = useRef<string | null>(null);
  const compactViewportRef = useRef<boolean | null>(null);
  const keyboardBaselineViewportHeightRef = useRef<number | null>(null);
  const chatInputContainerRef = useRef<HTMLDivElement | null>(null);
  const assistantChatTapTrackerRef = useRef<ChatTapTracker>(
    createEmptyChatTapTracker(),
  );
  const listingsRequestIdRef = useRef(0);
  const listingsAbortControllersRef = useRef(new Set<AbortController>());
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const manualListingImagePreparationRef = useRef<{
    source: File[];
    promise: Promise<File[]>;
  } | null>(null);

  useEffect(() => {
    if (manualListingImages.length === 0) {
      setManualListingImagePreviewUrls([]);
      setManualListingImagePreviewIndex(null);
      return;
    }

    const previewUrls = manualListingImages.map((image) =>
      URL.createObjectURL(image),
    );
    setManualListingImagePreviewUrls(previewUrls);

    return () => {
      for (const previewUrl of previewUrls) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [manualListingImages]);

  const stageManualListingImages = useCallback((images: File[]) => {
    const selectedImages = images.slice(0, 8);

    setManualListingImages(selectedImages);
    setIsPreparingManualListingImages(selectedImages.length > 0);

    if (selectedImages.length === 0) {
      manualListingImagePreparationRef.current = null;
      setManualListingImagePreviewIndex(null);
      return;
    }

    const preparation = {
      source: selectedImages,
      promise: prepareUploadableImageFiles(selectedImages),
    };
    manualListingImagePreparationRef.current = preparation;
    void preparation.promise.then(
      () => {
        if (manualListingImagePreparationRef.current === preparation) {
          setIsPreparingManualListingImages(false);
        }
      },
      () => {
        if (manualListingImagePreparationRef.current === preparation) {
          setIsPreparingManualListingImages(false);
        }
      },
    );
  }, []);

  const removeManualListingImage = useCallback(
    (imageIndex: number) => {
      const nextImages = manualListingImages.filter(
        (_, index) => index !== imageIndex,
      );

      stageManualListingImages(nextImages);
      setManualListingImagePreviewIndex((currentIndex) => {
        if (currentIndex === null) {
          return null;
        }

        if (nextImages.length === 0) {
          return null;
        }

        if (currentIndex === imageIndex) {
          return Math.min(imageIndex, nextImages.length - 1);
        }

        return currentIndex > imageIndex ? currentIndex - 1 : currentIndex;
      });
    },
    [manualListingImages, stageManualListingImages],
  );

  const showPreviousManualListingImage = useCallback(() => {
    setManualListingImagePreviewIndex((currentIndex) => {
      if (manualListingImages.length === 0) {
        return null;
      }

      const activeIndex = currentIndex ?? 0;
      return (activeIndex - 1 + manualListingImages.length) % manualListingImages.length;
    });
  }, [manualListingImages.length]);

  const showNextManualListingImage = useCallback(() => {
    setManualListingImagePreviewIndex((currentIndex) => {
      if (manualListingImages.length === 0) {
        return null;
      }

      const activeIndex = currentIndex ?? 0;
      return (activeIndex + 1) % manualListingImages.length;
    });
  }, [manualListingImages.length]);

  const manualListingActivePreviewIndex = manualListingImagePreviewIndex ?? 0;
  const manualListingPreviewUrl =
    manualListingImagePreviewIndex === null
      ? null
      : manualListingImagePreviewUrls[manualListingImagePreviewIndex] ?? null;
  const shouldResetSearchStateRef = useRef(true);
  const [clientIntent, setClientIntent] =
    useState<ClientIntentState>(defaultClientIntent);

  const filteredMessages = useMemo(
    () => messages.filter((message) => message.role !== 'system'),
    [messages],
  );
  const latestAssistantMessageId = useMemo(
    () =>
      filteredMessages.findLast((message) => message.role === 'assistant')?.id ??
      null,
    [filteredMessages],
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
  const assistantScrollWatchKey = useMemo(() => {
    return [
      scrollWatchKey,
      isChatInputFocused ? 'focused' : 'blurred',
      visualViewportFrame?.height ?? 'full',
      visualViewportFrame?.offsetTop ?? 0,
      isMobileChatViewOpen ? 'chat' : 'sheet',
    ].join('-');
  }, [
    isChatInputFocused,
    isMobileChatViewOpen,
    scrollWatchKey,
    visualViewportFrame?.height,
    visualViewportFrame?.offsetTop,
  ]);
  const latestSearchToolOutput = useMemo(
    () => getLatestSearchToolOutput(filteredMessages),
    [filteredMessages],
  );
  const retainedSearchToolOutput = useMemo(
    () =>
      getLatestSearchToolOutput(filteredMessages, {
        afterLatestUserOnly: false,
      }),
    [filteredMessages],
  );
  const hasActiveAssistantSearch = Boolean(activeListingQuery);
  const visibleSearchToolOutput =
    latestSearchToolOutput ??
    (hasActiveAssistantSearch ? retainedSearchToolOutput : null);
  const searchToolListings = useMemo(() => {
    if (!visibleSearchToolOutput) {
      return [];
    }

    return (visibleSearchToolOutput.listings as ApiListingRecord[]).map(
      listingRecordToCard,
    );
  }, [visibleSearchToolOutput]);
  const assistantResultListings = useMemo(() => {
    return getAssistantResultListings({
      searchToolListings,
    });
  }, [searchToolListings]);
  const activeMarketCategoryGroup =
    selectedMarketCategoryGroup !== 'all' &&
    marketplaceCategoryGroups.some(
      (group) => group.label === selectedMarketCategoryGroup,
    )
      ? selectedMarketCategoryGroup
      : 'all';
  const activeMarketCategoryGroupConfig =
    activeMarketCategoryGroup === 'all'
      ? null
      : marketplaceCategoryGroups.find(
          (group) => group.label === activeMarketCategoryGroup,
        ) ?? null;
  const activeMarketSubcategory =
    selectedMarketSubcategory !== 'all' &&
    activeMarketCategoryGroupConfig?.categories.includes(selectedMarketSubcategory)
      ? selectedMarketSubcategory
      : 'all';
  const activeMarketCity =
    selectedMarketCity !== 'all' && saudiMarketplaceCities.includes(selectedMarketCity)
      ? selectedMarketCity
      : 'all';
  const hasMarketplaceSearchQuery = marketplaceSearchQuery.trim().length > 0;
  const manuallyFilteredMarketplaceListings = useMemo(() => {
    return marketplaceListings.filter((listing) => {
      const matchesCategory =
        activeMarketCategoryGroup === 'all' ||
        (activeMarketSubcategory !== 'all'
          ? listing.category === activeMarketSubcategory
          : Boolean(
              listing.category &&
                activeMarketCategoryGroupConfig?.categories.includes(
                  listing.category,
                ),
            ));
      const matchesCity =
        activeMarketCity === 'all' || listing.city === activeMarketCity;

      return matchesCategory && matchesCity;
    });
  }, [
    activeMarketCategoryGroup,
    activeMarketCategoryGroupConfig,
    activeMarketCity,
    activeMarketSubcategory,
    marketplaceListings,
  ]);
  const hasManualMarketFilters =
    activeMarketCategoryGroup !== 'all' ||
    activeMarketSubcategory !== 'all' ||
    activeMarketCity !== 'all';
  const activeMarketFilterCount =
    Number(activeMarketCategoryGroup !== 'all') +
    Number(activeMarketSubcategory !== 'all') +
    Number(activeMarketCity !== 'all');
  const exploreMarketplaceListings = useMemo(() => {
    return getExploreListings({
      marketplaceListings: manuallyFilteredMarketplaceListings,
      searchToolListings: hasActiveAssistantSearch ? assistantResultListings : [],
    });
  }, [
    assistantResultListings,
    hasActiveAssistantSearch,
    manuallyFilteredMarketplaceListings,
  ]);
  const chatListingCardsById = useMemo(() => {
    const cardsById = new Map<string, ListingCard>();

    [
      ...marketplaceListings,
      ...searchToolListings,
      ...assistantResultListings,
      ...exploreMarketplaceListings,
    ].forEach((listing) => {
      if (listing.id) {
        cardsById.set(listing.id, listing);
      }
    });

    return cardsById;
  }, [
    assistantResultListings,
    exploreMarketplaceListings,
    marketplaceListings,
    searchToolListings,
  ]);
  const canLoadMoreListings = getCanLoadMoreExploreListings({
    hasMore: listingPagination.hasMore,
    displayedCount: marketplaceListings.length,
  });

  const isAssistantExpanded = assistantState === 'expanded';
  const assistantPanelStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isCompactViewport || isMobileChatViewOpen) {
      return undefined;
    }

    const hasKeyboardOffset = isChatInputFocused && keyboardOffset > 0;
    const expandedHeight = hasKeyboardOffset
      ? `min(68dvh, calc(100dvh - ${keyboardOffset}px - 0.75rem))`
      : '68dvh';

    return {
      // عند فتح الكيبورد على iPhone لا نضيف env(safe-area-inset-bottom)، لأن
      // visualViewport يستبعد منطقة الـ safe-area أصلاً عند حساب إزاحة
      // الكيبورد، وإضافتها هنا تُنتج فراغًا بين الحاوية والكيبورد بمقدار
      // شريط الـ Home. أما عند إغلاق الكيبورد فنعتمد عليها لتفادي شريط الـ Home.
      bottom: hasKeyboardOffset
        ? `${keyboardOffset}px`
        : 'calc(var(--marketplace-bottom-nav-space) - 0.5rem)',
      height: isAssistantExpanded ? expandedHeight : '12.75rem',
      maxHeight: isAssistantExpanded ? '42rem' : 'none',
      minHeight: isAssistantExpanded && !hasKeyboardOffset ? '26rem' : '0',
    };
  }, [
    isAssistantExpanded,
    isChatInputFocused,
    isCompactViewport,
    isMobileChatViewOpen,
    keyboardOffset,
  ]);
  const compactChatViewStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isCompactViewport || !isMobileChatViewOpen) {
      return undefined;
    }

    if (!isChatInputFocused || !visualViewportFrame) {
      return {
        blockSize: 'auto',
        bottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)',
        insetInline: '0',
        marginInline: 'auto',
        maxWidth: '40rem',
        minHeight: '0',
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top) + 0.5rem)',
        width: 'calc(100% - 2rem)',
      };
    }

    const focusedPanelHeight = Math.max(0, visualViewportFrame.height - 8);

    return {
      insetInline: '0',
      marginInline: 'auto',
      maxWidth: '40rem',
      position: 'fixed',
      top: `${visualViewportFrame.offsetTop + 8}px`,
      height: `${focusedPanelHeight}px`,
      maxHeight: `${focusedPanelHeight}px`,
      minHeight: '0',
      width: 'calc(100% - 2rem)',
    };
  }, [
    isChatInputFocused,
    isCompactViewport,
    isMobileChatViewOpen,
    visualViewportFrame,
  ]);

  const collapseAssistant = useCallback(() => {
    setAssistantState('collapsed');
  }, []);

  const expandAssistant = useCallback(() => {
    setAssistantState('expanded');
  }, []);

  const resetChatKeyboardState = useCallback(() => {
    setIsChatInputFocused(false);
    setKeyboardOffset(0);
    setVisualViewportFrame(null);
    keyboardBaselineViewportHeightRef.current = null;
  }, []);

  const handleChatInputFocus = useCallback(() => {
    const visualViewport = window.visualViewport;
    const currentViewportBottom = visualViewport
      ? visualViewport.height + visualViewport.offsetTop
      : window.innerHeight;

    // Capture the largest known viewport height *before* the keyboard opens so
    // the offset calculation has a stable reference that is never polluted by
    // the shrunken `window.innerHeight` that Android Chrome reports once the
    // keyboard is visible.
    keyboardBaselineViewportHeightRef.current = Math.max(
      keyboardBaselineViewportHeightRef.current ?? 0,
      currentViewportBottom,
      window.innerHeight,
    );
    setIsChatInputFocused(true);
    expandAssistant();
  }, [expandAssistant]);

  const handleChatInputPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // When the assistant is collapsed, tapping anywhere on the input
      // container should open the sheet and move focus into the textarea so the
      // mobile keyboard opens reliably, even when the tap lands on the padding
      // around the textarea rather than on the field itself.
      if (isAssistantExpanded) {
        return;
      }

      event.stopPropagation();
      handleChatInputFocus();

      const target = event.target;

      if (
        target instanceof Element &&
        target.closest('textarea, input, button, a, [role="button"]')
      ) {
        return;
      }

      const textarea = chatInputContainerRef.current?.querySelector('textarea');

      if (textarea instanceof HTMLTextAreaElement) {
        // Defer focus until after the expanded sheet has been committed to the
        // DOM so the browser does not scroll the freshly revealed textarea out
        // of view while the keyboard animates open.
        window.requestAnimationFrame(() => {
          textarea.focus({ preventScroll: true });
        });
      }
    },
    [handleChatInputFocus, isAssistantExpanded],
  );

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

  const handleAssistantChatPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isChatInputFocused || isKeyboardDismissIgnoredTarget(event.target)) {
        assistantChatTapTrackerRef.current.pointerId = null;
        return;
      }

      assistantChatTapTrackerRef.current = {
        ...assistantChatTapTrackerRef.current,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startAt: Date.now(),
        moved: false,
      };
    },
    [isChatInputFocused],
  );

  const handleAssistantChatPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tracker = assistantChatTapTrackerRef.current;

      if (tracker.pointerId !== event.pointerId) {
        return;
      }

      if (
        Math.hypot(event.clientX - tracker.startX, event.clientY - tracker.startY) >
        12
      ) {
        tracker.moved = true;
      }
    },
    [],
  );

  const handleAssistantChatPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tracker = assistantChatTapTrackerRef.current;

      if (
        !isChatInputFocused ||
        tracker.pointerId !== event.pointerId ||
        tracker.moved ||
        isKeyboardDismissIgnoredTarget(event.target)
      ) {
        assistantChatTapTrackerRef.current.pointerId = null;
        return;
      }

      const now = Date.now();
      const duration = now - tracker.startAt;
      const distance = Math.hypot(
        event.clientX - tracker.startX,
        event.clientY - tracker.startY,
      );
      const isTap = duration < 450 && distance <= 12;
      const isRepeatedTap =
        isTap && now - tracker.lastTapAt >= 180 && now - tracker.lastTapAt <= 900;

      if (isRepeatedTap) {
        const textarea =
          chatInputContainerRef.current?.querySelector('textarea');

        if (textarea instanceof HTMLTextAreaElement) {
          textarea.blur();
        }

        assistantChatTapTrackerRef.current = createEmptyChatTapTracker();
        return;
      }

      assistantChatTapTrackerRef.current = {
        ...tracker,
        pointerId: null,
        lastTapAt: isTap ? now : 0,
      };
    },
    [isChatInputFocused],
  );

  const handleAssistantChatPointerCancel = useCallback(() => {
    assistantChatTapTrackerRef.current.pointerId = null;
  }, []);

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

      // The keyboard is only considered open while a text-entry element keeps
      // focus. This prevents the offset from lingering after the keyboard is
      // dismissed on devices that do not fire a reliable resize event.
      const activeElement = document.activeElement;
      const isTextEntryFocused =
        activeElement instanceof Element &&
        Boolean(
          activeElement.closest(
            'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]',
          ),
        );

      if (!isTextEntryFocused) {
        setKeyboardOffset(0);
        return;
      }

            // On iOS Safari/PWA the keyboard shrinks `visualViewport.height` but the
      // baseline captured before focus still reflects the full layout viewport,
      // so `baseline - height` yields the real keyboard height. We compare
      // heights directly (without `offsetTop`) because iOS shifts `offsetTop`
      // when the page scrolls under the keyboard, which would otherwise add a
      // spurious gap. On Android `offsetTop` stays 0, so the same formula holds.
      const viewportHeight = visualViewport.height;
      const baselineViewportHeight =
        keyboardBaselineViewportHeightRef.current ??
        Math.max(window.innerHeight, viewportHeight);

      const nextKeyboardOffset = Math.max(
        0,
        Math.round(baselineViewportHeight - viewportHeight),
      );

      setKeyboardOffset(nextKeyboardOffset > 60 ? nextKeyboardOffset : 0);
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
    if (!isCompactViewport || !isMobileChatViewOpen || !isChatInputFocused) {
      return;
    }

    const syncVisualViewportFrame = () => {
      const visualViewport = window.visualViewport;

      setVisualViewportFrame({
        height: Math.round(visualViewport?.height ?? window.innerHeight),
        offsetTop: Math.round(visualViewport?.offsetTop ?? 0),
      });
    };

    syncVisualViewportFrame();
    window.visualViewport?.addEventListener('resize', syncVisualViewportFrame);
    window.visualViewport?.addEventListener('scroll', syncVisualViewportFrame);
    window.addEventListener('resize', syncVisualViewportFrame);

    return () => {
      window.visualViewport?.removeEventListener(
        'resize',
        syncVisualViewportFrame,
      );
      window.visualViewport?.removeEventListener(
        'scroll',
        syncVisualViewportFrame,
      );
      window.removeEventListener('resize', syncVisualViewportFrame);
    };
  }, [isChatInputFocused, isCompactViewport, isMobileChatViewOpen]);

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

  const restoreMarketplaceScroll = useCallback(() => {
    window.requestAnimationFrame(() => {
      const rawScroll = sessionStorage.getItem(
        assistantMarketplaceScrollStorageKey,
      );
      const scrollY = rawScroll ? Number.parseInt(rawScroll, 10) : 0;

      if (Number.isFinite(scrollY) && scrollY > 0) {
        window.scrollTo({ top: scrollY, behavior: 'instant' });
      }
    });
  }, []);

  const openMobileChatView = useCallback(() => {
    sessionStorage.setItem(
      assistantMarketplaceScrollStorageKey,
      String(window.scrollY),
    );

    resetChatKeyboardState();
    setHasAssistantBubbleAttention(false);
    setIsMobileChatViewOpen(true);
    expandAssistant();
    window.scrollTo({ top: 0, behavior: 'instant' });

    const url = new URL(window.location.href);
    url.searchParams.set('chat', '1');
    window.history.pushState({ smartstoreMobileChat: true }, '', url);
    window.dispatchEvent(new Event('smartstore:assistant-chat-view-change'));
  }, [expandAssistant, resetChatKeyboardState]);

  const closeMobileChatView = useCallback(() => {
    setIsMobileChatViewOpen(false);
    handledListingAssistantRef.current = null;
    resetChatKeyboardState();

    const url = new URL(window.location.href);
    url.searchParams.delete('chat');
    url.searchParams.delete('assistant');
    url.searchParams.delete('listingId');
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event('smartstore:assistant-chat-view-change'));
    restoreMarketplaceScroll();
  }, [resetChatKeyboardState, restoreMarketplaceScroll]);

  const closeAssistantForNavigation = useCallback(() => {
    setIsMobileChatViewOpen(false);
    handledListingAssistantRef.current = null;
    resetChatKeyboardState();
    collapseAssistant();

    const url = new URL(window.location.href);
    url.searchParams.delete('chat');
    url.searchParams.delete('assistant');
    url.searchParams.delete('listingId');
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event('smartstore:assistant-chat-view-change'));
  }, [collapseAssistant, resetChatKeyboardState]);

  useEffect(() => {
    const syncMobileChatViewFromUrl = () => {
      const shouldOpen =
        new URL(window.location.href).searchParams.get('chat') === '1';

      setIsMobileChatViewOpen(shouldOpen);
      resetChatKeyboardState();

      if (shouldOpen) {
        expandAssistant();
        window.scrollTo({ top: 0, behavior: 'instant' });
      } else {
        restoreMarketplaceScroll();
      }
    };

    syncMobileChatViewFromUrl();
    window.addEventListener('popstate', syncMobileChatViewFromUrl);

    return () => {
      window.removeEventListener('popstate', syncMobileChatViewFromUrl);
    };
  }, [expandAssistant, resetChatKeyboardState, restoreMarketplaceScroll]);

  useEffect(() => {
    window.addEventListener(
      'smartstore:close-assistant-view',
      closeAssistantForNavigation,
    );

    return () => {
      window.removeEventListener(
        'smartstore:close-assistant-view',
        closeAssistantForNavigation,
      );
    };
  }, [closeAssistantForNavigation]);

  useEffect(() => {
    if (!isCompactViewport || isMobileChatViewOpen) {
      return;
    }

    const syncBubblePosition = () => {
      setAssistantBubblePosition((current) => {
        const nextPosition = current
          ? clampAssistantBubblePosition(current)
          : readAssistantBubblePosition() ?? getDefaultAssistantBubblePosition();

        writeAssistantBubblePosition(nextPosition);
        return nextPosition;
      });
    };

    syncBubblePosition();
    window.addEventListener('resize', syncBubblePosition);
    window.visualViewport?.addEventListener('resize', syncBubblePosition);

    return () => {
      window.removeEventListener('resize', syncBubblePosition);
      window.visualViewport?.removeEventListener('resize', syncBubblePosition);
    };
  }, [isCompactViewport, isMobileChatViewOpen]);

  useEffect(() => {
    if (!latestAssistantMessageId) {
      return;
    }

    if (lastAssistantBubbleMessageIdRef.current === null) {
      lastAssistantBubbleMessageIdRef.current = latestAssistantMessageId;
      return;
    }

    if (lastAssistantBubbleMessageIdRef.current === latestAssistantMessageId) {
      return;
    }

    lastAssistantBubbleMessageIdRef.current = latestAssistantMessageId;

    if (!isCompactViewport || isMobileChatViewOpen || isLoading) {
      return;
    }

    const startAttentionTimer = window.setTimeout(() => {
      setHasAssistantBubbleAttention(true);
    }, 0);
    const stopAttentionTimer = window.setTimeout(() => {
      setHasAssistantBubbleAttention(false);
    }, 2200);

    return () => {
      window.clearTimeout(startAttentionTimer);
      window.clearTimeout(stopAttentionTimer);
    };
  }, [
    isCompactViewport,
    isLoading,
    isMobileChatViewOpen,
    latestAssistantMessageId,
  ]);

  const handleAssistantBubblePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!assistantBubblePosition) {
        return;
      }

      assistantBubbleRef.current?.setPointerCapture(event.pointerId);
      assistantBubbleDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: assistantBubblePosition.x,
        originY: assistantBubblePosition.y,
        hasDragged: false,
      };
    },
    [assistantBubblePosition],
  );

  const handleAssistantBubblePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = assistantBubbleDragRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      const hasPassedThreshold =
        Math.hypot(deltaX, deltaY) > assistantBubbleDragThreshold;

      if (!dragState.hasDragged && !hasPassedThreshold) {
        return;
      }

      dragState.hasDragged = true;
      event.preventDefault();

      setAssistantBubblePosition(
        clampAssistantBubblePosition({
          x: dragState.originX + deltaX,
          y: dragState.originY + deltaY,
        }),
      );
    },
    [],
  );

  const handleAssistantBubblePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const dragState = assistantBubbleDragRef.current;

      if (!dragState || dragState.pointerId !== event.pointerId) {
        return;
      }

      assistantBubbleDragRef.current = null;
      assistantBubbleRef.current?.releasePointerCapture(event.pointerId);

      if (!dragState.hasDragged) {
        openMobileChatView();
        return;
      }

      setAssistantBubblePosition((current) => {
        if (!current) {
          return current;
        }

        const bounds = getAssistantBubbleBounds();
        const snappedPosition = clampAssistantBubblePosition({
          ...current,
          x:
            current.x + assistantBubbleSize / 2 < window.innerWidth / 2
              ? bounds.minX
              : bounds.maxX,
        });

        writeAssistantBubblePosition(snappedPosition);
        return snappedPosition;
      });
    },
    [openMobileChatView],
  );

  const handleAssistantBubblePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      assistantBubbleDragRef.current = null;
      assistantBubbleRef.current?.releasePointerCapture(event.pointerId);
    },
    [],
  );

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

    const effectiveQuery = query ?? marketplaceSearchQuery;

    if (effectiveQuery.trim()) {
      params.set('q', effectiveQuery.trim());
    }

    if (activeMarketCity !== 'all') {
      params.set('city', activeMarketCity);
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
  }, [activeMarketCity, marketplaceSearchQuery]);

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

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshMarketplaceListings(undefined, 1, { showLoading: false });
      void refreshFavoriteListingIds();
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshFavoriteListingIds, refreshMarketplaceListings]);

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
    const restoredChatState = readHomeAssistantRuntimeState();

    if (restoredChatState) {
      retainedListingImagesRef.current = restoredChatState.retainedListingImages;
      shouldResetSearchStateRef.current = restoredChatState.shouldResetSearchState;

      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setMessages(restoredChatState.messages);
        setActiveListingQuery(restoredChatState.activeListingQuery);
        setSelectedListingContext(restoredChatState.selectedListingContext);
        setHasRestoredChat(true);
      });

      return () => {
        cancelled = true;
      };
    }

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
    if (!hasRestoredChat) {
      return;
    }

    writeHomeAssistantRuntimeState({
      messages,
      activeListingQuery,
      selectedListingContext,
      retainedListingImages: retainedListingImagesRef.current,
      shouldResetSearchState: shouldResetSearchStateRef.current,
    });
  }, [
    activeListingQuery,
    hasRestoredChat,
    messages,
    selectedListingContext,
  ]);

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
    if (isSessionLoading) {
      return;
    }

    if (session.authenticated) {
      void refreshFavoriteListingIds();
      return;
    }

    setFavoriteListingIds(new Set());
  }, [isSessionLoading, refreshFavoriteListingIds, session.authenticated]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setMarketplaceSearchQuery(marketplaceSearchInput.trim());
    }, 350);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [marketplaceSearchInput]);

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
      if (intent.kind === 'create_listing') {
        setIsManualListingFallbackDismissed(false);
      }

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
      if (intent.kind === 'create_listing') {
        setIsManualListingFallbackDismissed(false);
      }

      if (isCompactViewport && !isMobileChatViewOpen) {
        openMobileChatView();
      } else {
        expandAssistant();
      }

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
      isCompactViewport,
      isMobileChatViewOpen,
      openMobileChatView,
      filteredMessages.length,
    ],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const assistantMode = url.searchParams.get('assistant');
    const listingId = url.searchParams.get('listingId');

    if (assistantMode !== 'listing' || !isSafeListingId(listingId)) {
      handledListingAssistantRef.current = null;
      return;
    }

    if (
      handledListingAssistantRef.current === listingId ||
      isLoading ||
      !hasRestoredChat
    ) {
      return;
    }

    handledListingAssistantRef.current = listingId;
    sendStarter(`قارن لي الإعلان رقم ${listingId} مع السوق`);
  }, [hasRestoredChat, isLoading, sendStarter]);

  const submitManualListing = useCallback(async (options?: { publishAfterSave?: boolean }) => {
    if (manualListingSubmissionRef.current) {
      return;
    }

    if (!session.authenticated) {
      router.push('/api/auth/google/start');
      return;
    }

    const title = manualListingForm.title.trim();
    const description = manualListingForm.description.trim();
    const city = manualListingForm.city.trim();

    if (!title || !description || !city) {
      setManualListingNotice({
        tone: 'warning',
        message: 'أكمل العنوان والوصف والمدينة قبل حفظ الإعلان اليدوي.',
      });
      return;
    }

    const payload: {
      title: string;
      description: string;
      price?: number | 'bid' | 'negotiable';
      city: string;
      category: string;
      condition: ManualListingForm['condition'];
      attributes?: Record<string, unknown>;
    } = {
      title,
      description,
      city,
      category: manualListingForm.category,
      condition: manualListingForm.condition,
    };

    if (manualListingForm.priceMode === 'number') {
      const numericPrice = Number(manualListingForm.price);

      if (!Number.isFinite(numericPrice) || numericPrice < 0) {
        setManualListingNotice({
          tone: 'warning',
          message: 'أدخل سعرًا صحيحًا أو اختر على السوم/قابل للتفاوض.',
        });
        return;
      }

      payload.price = numericPrice;
    } else if (manualListingForm.priceMode === 'negotiable') {
      const trimmedPrice = manualListingForm.price.trim();

      if (trimmedPrice) {
        const numericPrice = Number(trimmedPrice);

        if (!Number.isFinite(numericPrice) || numericPrice < 0) {
          setManualListingNotice({
            tone: 'warning',
            message: 'أدخل سعرًا مبدئيًا صحيحًا أو اتركه فارغًا عند اختيار قابل للتفاوض.',
          });
          return;
        }

        payload.price = numericPrice;
        payload.attributes = {
          saleTerms: 'negotiable',
        };
      } else {
        payload.price = 'negotiable';
      }
    } else {
      payload.price = manualListingForm.priceMode;
    }

    const nextSubmission: ManualListingSubmission = options?.publishAfterSave
      ? 'saving_and_publishing'
      : 'saving';
    manualListingSubmissionRef.current = nextSubmission;
    setManualListingSubmission(nextSubmission);
    setManualListingNotice(null);

    const selectedImages = manualListingImages.slice(0, 8);
    const existingPreparation = manualListingImagePreparationRef.current;
    const preparedImagesPromise =
      existingPreparation && existingPreparation.source === manualListingImages
        ? existingPreparation.promise
        : prepareUploadableImageFiles(selectedImages);

    try {
      const response = await fetch('/api/marketplace/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey('manual-listing-create'),
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      const responsePayload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        listing?: ApiListingRecord;
      } | null;

      if (!response.ok || !responsePayload?.listing) {
        setManualListingNotice({
          tone: responsePayload?.error === 'listing_blocked' ? 'danger' : 'warning',
          message:
            responsePayload?.message ??
            responsePayload?.error ??
            'تعذر حفظ الإعلان اليدوي الآن. حاول مرة أخرى.',
        });
        return;
      }

      const createdListing = responsePayload.listing;
      const preparedImages = await preparedImagesPromise.catch(() => []);
      let uploadedImages = 0;
      let publishStatus: 'not_requested' | 'published' | 'blocked' = 'not_requested';
      let publishMessage = '';

      for (const image of preparedImages) {
        try {
          const formData = new FormData();
          formData.append('image', image);

          const uploadResponse = await fetch(
            `/api/marketplace/listings/${createdListing.id}/images`,
            {
              method: 'POST',
              headers: {
                'Idempotency-Key': createClientIdempotencyKey(
                  'manual-listing-image-upload',
                ),
              },
              body: formData,
            },
          );

          if (!uploadResponse.ok) {
            break;
          }

          uploadedImages += 1;
        } catch {
          break;
        }
      }

      if (options?.publishAfterSave) {
        const publishResponse = await fetch(
          `/api/marketplace/listings/${createdListing.id}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': createClientIdempotencyKey(
                'manual-listing-publish',
              ),
            },
            body: JSON.stringify({ action: 'publish' }),
          },
        );
        const publishPayload = (await publishResponse.json().catch(() => null)) as {
          message?: string;
        } | null;

        if (publishResponse.ok) {
          publishStatus = 'published';
        } else {
          publishStatus = 'blocked';
          publishMessage =
            publishPayload?.message ??
            'لم يتم نشر الإعلان بنجاح، ويتطلب بيانات إضافية. الرجاء الذهاب إلى حسابي ثم إعلاناتي لإدارة الإعلان واستكمال البيانات ثم نشره.';
        }
      }

      const hasPartialImageUpload =
        manualListingImages.length > 0 && uploadedImages < manualListingImages.length;
      const nextManualListingNotice: ManualListingNotice =
        publishStatus === 'published'
          ? {
              tone: 'success',
              title: 'تم نشر الإعلان بنجاح',
              message: '',
              statusLabel: 'منشور',
              shareListingId: createdListing.id,
              shareTitle: createdListing.title ?? title,
            }
          : publishStatus === 'blocked'
            ? {
                tone: 'warning',
                message: publishMessage,
              }
            : hasPartialImageUpload
              ? {
                  tone: 'warning',
                  message:
                    'تم حفظ الإعلان، لكن لم يتم رفع كل الصور. يمكنك تعديل الصور لاحقًا من إعلاناتي.',
                }
              : {
                  tone: 'success',
                  title: 'تم حفظ الإعلان',
                  message:
                    'إذا أردت نشره، انتقل إلى حسابي ← إعلاناتي ثم اختر نشر الإعلان.',
                };

      setManualListingForm(defaultManualListingForm);
      setManualListingImages([]);
      manualListingImagePreparationRef.current = null;
      setManualListingNotice(nextManualListingNotice);
      setIsManualListingOpen(false);
      setIsManualListingFallbackDismissed(true);
      void refreshMarketplaceListings();
    } catch {
      setManualListingNotice({
        tone: 'danger',
        message: 'تعذر حفظ الإعلان اليدوي الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      manualListingSubmissionRef.current = null;
      setManualListingSubmission(null);
    }
  }, [
    manualListingForm,
    manualListingImages,
    refreshMarketplaceListings,
    router,
    session.authenticated,
  ]);

  const confirmManualPublishAgreement = useCallback(() => {
    setIsManualPublishAgreementOpen(false);
    void submitManualListing({ publishAfterSave: true });
  }, [submitManualListing]);

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

  const handleNearbyMarketplaceSearch = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNearbyMarketplaceNotice(
        'بحث موقعي يحتاج تفعيل خدمة الموقع في المتصفح.',
      );
      return;
    }

    setIsLocatingNearbyListings(true);
    setNearbyMarketplaceNotice('جار تحديد أقرب منطقة لإعلاناتك...');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nearestCity = getNearestMarketplaceCity(
          position.coords.latitude,
          position.coords.longitude,
        );

        setIsLocatingNearbyListings(false);

        if (!nearestCity) {
          setNearbyMarketplaceNotice(
            'تعذر تحديد مدينة قريبة ضمن مناطق السوق الحالية.',
          );
          return;
        }

        setNearbyMarketplaceCity(nearestCity.city);
        setSelectedMarketCity(nearestCity.city);
        setNearbyMarketplaceNotice(`تم عرض إعلانات موقعي من ${nearestCity.city}.`);
      },
      () => {
        setIsLocatingNearbyListings(false);
        setNearbyMarketplaceNotice(
          'لم يتم السماح بالوصول للموقع. يمكنك اختيار المنطقة يدويًا.',
        );
      },
      {
        enableHighAccuracy: false,
        maximumAge: 5 * 60 * 1000,
        timeout: 10 * 1000,
      },
    );
  }, []);

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      clearHomeAssistantRuntimeState();
      setSession({ authenticated: false, user: null });
      setFavoriteListingIds(new Set());
    });
  }, [setSession]);

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
    handledListingAssistantRef.current = null;
    retainedListingImagesRef.current = [];
    shouldResetSearchStateRef.current = true;
    clearHomeAssistantRuntimeState();
    clearStoredChatState();
    const url = new URL(window.location.href);
    url.searchParams.delete('assistant');
    url.searchParams.delete('listingId');
    window.history.replaceState(null, '', url);
    void clearRetainedListingImages().catch(() => {});
    void resetAssistantSearchState().catch(() => {});
  }, [setMessages]);

  const clearAssistantSearch = useCallback(() => {
    setActiveListingQuery('');
  }, []);

  const isCompactChatView = isCompactViewport && isMobileChatViewOpen;
  const shouldRenderAssistantPanel = !isCompactViewport || isCompactChatView;
  const isAssistantContentVisible =
    !isCompactViewport || isAssistantExpanded || isCompactChatView;
  const shouldRenderAssistantBubble =
    isCompactViewport && !isMobileChatViewOpen && assistantBubblePosition;
  const assistantBubbleState = isLoading
    ? 'active'
    : hasAssistantBubbleAttention
      ? 'attention'
      : 'idle';
  const shouldShowManualListingFallback =
    Boolean(error) && clientIntent.kind === 'create_listing';
  const isManualListingVisible =
    isManualListingOpen ||
    (shouldShowManualListingFallback && !isManualListingFallbackDismissed);

  return (
    <main
      className={cn(
        'marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground',
        isCompactChatView && 'h-dvh overflow-hidden',
      )}
      dir="rtl"
    >
      <CommissionAgreementDialog
        mode="publish"
        onCancel={() => setIsManualPublishAgreementOpen(false)}
        onConfirm={confirmManualPublishAgreement}
        open={isManualPublishAgreementOpen}
      />
      <div
        className={cn(
          'mx-auto grid h-full min-h-0 max-w-7xl gap-2 px-1.5 py-2 sm:px-3 md:px-4 lg:gap-3 lg:px-6 lg:py-3',
          isCompactChatView && 'h-dvh min-h-0 max-w-none gap-0 px-0 py-0 sm:px-0',
        )}
      >
        <section
          className={cn(
            'marketplace-panel flex min-h-0 flex-col bg-white dark:bg-card',
            isCompactChatView
              ? 'h-full rounded-none border-0 bg-transparent shadow-none dark:bg-transparent'
              : 'h-full overflow-hidden rounded-md border shadow-2xl shadow-slate-950/10',
          )}
        >
          {!isCompactChatView && (
          <header className="flex h-14 items-center justify-between gap-2 border-b bg-[#f7f9fc] px-2 dark:bg-background sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
              <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
                <img alt="سوق حمد" className="size-8 object-cover" src="/hamad-market-logo.jpeg" />
              </div>
            </div>

            <div className="hidden h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-muted-foreground shadow-sm md:mx-6 md:flex dark:border-blue-400/20 dark:bg-card">
              <Sparkles className="size-4 text-blue-600" />
              <button className="flex h-full min-w-0 flex-1 items-center truncate text-start text-xs" type="button" onClick={() => sendStarter('أبحث عن منتج بمساعدة الذكاء الاصطناعي')}>
                اسأل حمد عن المنتج الذي تبحث عنه
              </button>
            </div>

            <nav className="hidden items-center gap-1 text-[11px] font-medium text-muted-foreground xl:flex">
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/terms" prefetch={false}>
                الشروط
              </Link>
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/listing-policy" prefetch={false}>
                سياسة الإعلانات
              </Link>
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/commission-policy" prefetch={false}>
                رسوم المنصة
              </Link>
            </nav>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              {session.authenticated ? (
                <PushNotificationSettings variant="icon" />
              ) : null}
              <ThemeToggle language="ar" />
              {session.authenticated ? (
                <>
                  <Button asChild variant="outline" size="sm" className="hidden rounded-md lg:inline-flex">
                    <Link href="/account" onClick={closeAssistantForNavigation} prefetch={false}>
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
          )}

          <div
            className={cn(
              'grid min-h-0 flex-1',
              isCompactChatView
                ? 'grid-cols-1 overflow-hidden'
                : 'grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_25rem]',
            )}
          >
            {!isCompactChatView && (
            <section
              className="flex min-h-0 min-w-0 flex-col overflow-hidden border-b bg-white/45 p-2 dark:bg-background/55 sm:p-3 lg:border-b-0 lg:border-l lg:p-4"
              id="suggested-listings"
              onPointerDown={collapseAssistantFromPage}
            >
              <div className={cn(
                'marketplace-home-controls shrink-0 border-b border-blue-100/70 pb-2 dark:border-blue-400/10',
                isManualListingVisible
                  ? 'max-h-[min(58dvh,34rem)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                  : 'overflow-visible',
              )}>
              <div className="mb-2 grid gap-1.5 text-center md:justify-end md:text-right">
                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:justify-end">
                  <Button className="marketplace-primary-cta h-9 rounded-md bg-blue-600 px-2 text-sm hover:bg-blue-700 sm:px-3" onClick={() => sendStarter('أريد بيع منتج')}>
                  <Megaphone className="size-4" />
                  أنشئ إعلانك مع حمد
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-md px-2 text-sm transition duration-150 active:scale-[0.98] sm:px-3"
                    onClick={() => {
                      setIsManualListingOpen((value) => !value);
                      setIsManualListingFallbackDismissed(false);
                      setManualListingNotice(null);
                    }}
                  >
                    <Megaphone className="size-4" />
                    أنشئ إعلانك يدويًا
                  </Button>
                </div>
              </div>

              <FloatingActionNotice
                action={
                  manualListingNotice?.shareListingId ? (
                    <ListingShareButton
                      className="w-full justify-center rounded-md bg-blue-600 text-white hover:bg-blue-700"
                      listingId={manualListingNotice.shareListingId}
                      title={manualListingNotice.shareTitle}
                    />
                  ) : undefined
                }
                closeLabel="إغلاق نتيجة إنشاء الإعلان"
                durationMs={manualListingNotice?.shareListingId ? 12000 : 10000}
                message={manualListingNotice?.message}
                onDismiss={() => setManualListingNotice(null)}
                open={Boolean(manualListingNotice)}
                statusLabel={manualListingNotice?.statusLabel}
                title={manualListingNotice?.title}
                tone={manualListingNotice?.tone ?? 'info'}
              />

              {isManualListingVisible && (
                <form
                  aria-busy={Boolean(manualListingSubmission) || undefined}
                  className="mb-4 grid gap-3 rounded-md border border-blue-200 bg-white/95 p-3 text-right shadow-sm dark:border-blue-400/20 dark:bg-card"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitManualListing();
                  }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-bold text-blue-700 dark:text-blue-300">
                        <Megaphone className="size-4" />
                        نموذج الإعلان
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="self-end rounded-full sm:self-auto"
                      aria-label="إغلاق الإضافة اليدوية"
                      onClick={() => {
                        setIsManualListingOpen(false);
                        setIsManualListingFallbackDismissed(true);
                      }}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold">
                      عنوان الإعلان
                      <input
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500"
                        maxLength={140}
                        value={manualListingForm.title}
                        onChange={(event) =>
                          setManualListingForm((form) => ({
                            ...form,
                            title: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="grid gap-1 text-xs font-semibold">
                      المدينة
                      <CitySelector
                        className="font-normal"
                        name="manual-listing-city"
                        value={manualListingForm.city}
                        onValueChange={(city) =>
                          setManualListingForm((form) => ({
                            ...form,
                            city,
                          }))
                        }
                      />
                    </div>
                    <label className="grid gap-1 text-xs font-semibold">
                      التصنيف
                      <select
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500"
                        value={manualListingForm.category}
                        onChange={(event) =>
                          setManualListingForm((form) => ({
                            ...form,
                            category: event.target.value,
                          }))
                        }
                      >
                        {manualListingCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {formatCategory(category)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold">
                      حالة المنتج
                      <select
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500"
                        value={manualListingForm.condition}
                        onChange={(event) =>
                          setManualListingForm((form) => ({
                            ...form,
                            condition: event.target.value as ManualListingForm['condition'],
                          }))
                        }
                      >
                        {manualListingConditionOptions.map((condition) => (
                          <option key={condition.value} value={condition.value}>
                            {condition.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold">
                      طريقة السعر
                      <select
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500"
                        value={manualListingForm.priceMode}
                        onChange={(event) =>
                          setManualListingForm((form) => ({
                            ...form,
                            priceMode: event.target.value as ManualListingForm['priceMode'],
                          }))
                        }
                      >
                        <option value="number">سعر محدد</option>
                        <option value="bid">على السوم</option>
                        <option value="negotiable">قابل للتفاوض</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs font-semibold">
                      السعر
                      <input
                        className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500 disabled:opacity-60"
                        disabled={manualListingForm.priceMode === 'bid'}
                        inputMode="numeric"
                        placeholder={
                          manualListingForm.priceMode === 'negotiable'
                            ? 'سعر مبدئي اختياري'
                            : undefined
                        }
                        value={manualListingForm.price}
                        onChange={(event) =>
                          setManualListingForm((form) => ({
                            ...form,
                            price: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>

                  <label className="grid gap-1 text-xs font-semibold">
                    الوصف
                    <textarea
                      className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500"
                      maxLength={4000}
                      value={manualListingForm.description}
                      onChange={(event) =>
                        setManualListingForm((form) => ({
                          ...form,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>

                  <div className="grid gap-2 text-xs font-semibold">
                    <span>الصور</span>
                    <label className="group grid min-h-36 cursor-pointer place-items-center rounded-md border-2 border-dashed border-blue-400/70 bg-blue-50/35 px-4 py-5 text-center transition duration-150 ease-out active:scale-[0.99] active:border-blue-500 active:bg-blue-50 hover:border-blue-500/80 hover:bg-blue-50/55 dark:border-blue-400/45 dark:bg-blue-400/5 dark:hover:border-blue-300/70">
                      <input
                        accept="image/*"
                        className="sr-only"
                        multiple
                        type="file"
                        onChange={(event) => {
                          const selectedImages = Array.from(
                            event.target.files ?? [],
                          );
                          stageManualListingImages(selectedImages);
                          event.currentTarget.value = '';
                        }}
                      />
                      <span className="grid justify-items-center gap-2">
                        <span className="grid size-16 place-items-center rounded-full bg-blue-100/80 text-blue-600 transition duration-150 group-active:bg-blue-100 dark:bg-blue-400/10 dark:text-blue-300">
                          <Download className="size-10 stroke-[2.4]" />
                        </span>
                        <span className="text-base font-bold text-foreground">
                          إضافة صور الإعلان
                        </span>
                        <span className="text-sm font-normal text-muted-foreground">
                          اضغط لاختيار الصور من جهازك
                        </span>
                      </span>
                    </label>
                    {manualListingImagePreviewUrls.length > 0 && (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                        {manualListingImagePreviewUrls.map((previewUrl, index) => (
                          <div
                            key={previewUrl + '-' + index}
                            className="relative aspect-square overflow-hidden rounded-md border bg-slate-100 shadow-sm dark:bg-slate-900"
                          >
                            <button
                              aria-label={'معاينة صورة الإعلان ' + (index + 1)}
                              className="size-full"
                              onClick={() => setManualListingImagePreviewIndex(index)}
                              type="button"
                            >
                            <img
                              alt={'صورة الإعلان ' + (index + 1)}
                              className="size-full object-cover"
                              src={previewUrl}
                            />
                            </button>
                            <button
                              aria-label={'حذف صورة الإعلان ' + (index + 1)}
                              className="absolute left-1 top-1 grid size-7 place-items-center rounded-full border border-white/70 bg-white/92 text-red-600 shadow-sm transition hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 dark:border-white/10 dark:bg-slate-950/85 dark:text-red-300 dark:hover:bg-red-500/15"
                              onClick={() => removeManualListingImage(index)}
                              type="button"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {manualListingPreviewUrl && (
                      <div
                        aria-modal="true"
                        className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/82 p-4 backdrop-blur-md"
                        onClick={() => setManualListingImagePreviewIndex(null)}
                        role="dialog"
                      >
                        <div
                          className="relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-950 shadow-2xl"
                          dir="rtl"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">
                                صورة الإعلان {manualListingActivePreviewIndex + 1} / {manualListingImages.length}
                              </p>
                              <p className="text-xs text-slate-400">قبل الرفع</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                aria-label="حذف الصورة"
                                className="rounded-xl text-red-200 hover:bg-red-500/15 hover:text-red-100"
                                onClick={() => removeManualListingImage(manualListingActivePreviewIndex)}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                              <Button
                                aria-label="إغلاق المعاينة"
                                className="rounded-xl text-white hover:bg-white/10"
                                onClick={() => setManualListingImagePreviewIndex(null)}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          </div>
                          <div className="relative grid min-h-[18rem] place-items-center bg-slate-900/80 p-3">
                            <img
                              alt={'معاينة صورة الإعلان ' + (manualListingActivePreviewIndex + 1)}
                              className="max-h-[68dvh] max-w-full rounded-xl object-contain"
                              src={manualListingPreviewUrl}
                            />
                            {manualListingImages.length > 1 && (
                              <>
                                <Button
                                  aria-label="الصورة السابقة"
                                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                                  onClick={showPreviousManualListingImage}
                                  size="icon-sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  <ChevronRight className="size-5" />
                                </Button>
                                <Button
                                  aria-label="الصورة التالية"
                                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                                  onClick={showNextManualListingImage}
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
                    {(isPreparingManualListingImages || manualListingImages.length > 0) && (
                      <div className="grid gap-1.5">
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {isPreparingManualListingImages
                            ? 'جاري تجهيز ' + manualListingImages.length + ' صور للرفع...'
                            : 'تم تجهيز ' + manualListingImages.length + ' صور للرفع.'}
                        </span>
                        <div
                          aria-hidden="true"
                          className="upload-progress-track"
                          data-indeterminate={isPreparingManualListingImages || undefined}
                        >
                          <div
                            className="upload-progress-fill"
                            style={{ width: isPreparingManualListingImages ? '45%' : '100%' }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-md"
                      disabled={Boolean(manualListingSubmission)}
                      onClick={() => {
                        setIsManualListingOpen(false);
                        setIsManualListingFallbackDismissed(true);
                      }}
                    >
                      إلغاء
                    </Button>
                    <Button
                      type="submit"
                      variant="outline"
                      className="rounded-md"
                      disabled={manualListingSubmission === 'saving_and_publishing'}
                      loading={manualListingSubmission === 'saving'}
                      loadingText="جاري حفظ الإعلان..."
                    >
                      {manualListingSubmission === 'saving'
                        ? 'جاري حفظ الإعلان...'
                        : 'حفظ الإعلان'}
                    </Button>
                    <Button
                      type="button"
                      className="rounded-md bg-blue-600 hover:bg-blue-700"
                      disabled={manualListingSubmission === 'saving'}
                      loading={manualListingSubmission === 'saving_and_publishing'}
                      loadingText="جاري حفظ ونشر الإعلان..."
                      onClick={() => {
                        if (manualListingSubmission) {
                          return;
                        }

                        setIsManualPublishAgreementOpen(true);
                      }}
                    >
                      {manualListingSubmission === 'saving_and_publishing'
                        ? 'جاري حفظ ونشر الإعلان...'
                        : 'حفظ ونشر الإعلان'}
                    </Button>
                  </div>
                </form>
              )}

              <div className="mb-2 grid gap-1.5">
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <Button
                    type="button"
                    size="sm"
                    variant={
                      activeMarketCategoryGroup === 'all' ? 'default' : 'outline'
                    }
                    className="h-8 shrink-0 rounded-full px-3 text-xs"
                    onClick={() => {
                      setSelectedMarketCategoryGroup('all');
                      setSelectedMarketSubcategory('all');
                    }}
                  >
                    الكل
                  </Button>
                  {marketplaceCategoryGroups.map((group) => (
                    <Button
                      key={group.label}
                      type="button"
                      size="sm"
                      variant={
                        activeMarketCategoryGroup === group.label
                          ? 'default'
                          : 'outline'
                      }
                      className="h-8 shrink-0 rounded-full px-3 text-xs"
                      onClick={() => {
                        setSelectedMarketCategoryGroup(group.label);
                        setSelectedMarketSubcategory('all');
                      }}
                    >
                      {group.label}
                    </Button>
                  ))}
                </div>

                {activeMarketCategoryGroupConfig && (
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        activeMarketSubcategory === 'all' ? 'default' : 'outline'
                      }
                      className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                      onClick={() => setSelectedMarketSubcategory('all')}
                    >
                      كل {activeMarketCategoryGroup}
                    </Button>
                    {activeMarketCategoryGroupConfig.categories.map((category) => (
                      <Button
                        key={category}
                        type="button"
                        size="sm"
                        variant={
                          activeMarketSubcategory === category ? 'default' : 'outline'
                        }
                        className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                        onClick={() => setSelectedMarketSubcategory(category)}
                      >
                        {category}
                      </Button>
                    ))}
                  </div>
                )}

                <div className="marketplace-filter-panel grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 rounded-md border bg-white/85 p-1.5 shadow-sm dark:bg-card sm:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_auto_auto] sm:p-2">
                  <label className="order-1 flex h-10 min-w-0 items-center gap-2 rounded-md border bg-background px-3 text-sm sm:h-9">
                    <Search className="size-4 shrink-0 text-blue-600" />
                    <input
                      className="min-w-0 flex-1 bg-transparent text-right outline-none"
                      placeholder="ابحث في كل السوق"
                      type="search"
                      value={marketplaceSearchInput}
                      onChange={(event) =>
                        setMarketplaceSearchInput(event.target.value)
                      }
                    />
                    {marketplaceSearchInput && (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="size-7 shrink-0 rounded-full"
                        aria-label="مسح البحث"
                        onClick={() => {
                          setMarketplaceSearchInput('');
                          setMarketplaceSearchQuery('');
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    )}
                  </label>
                  <CitySelector
                    allValue="all"
                    className="order-3 sm:order-2 [&>button]:h-9"
                    popoverClassName="z-[80]"
                    value={activeMarketCity}
                    onValueChange={(value) => {
                      setSelectedMarketCity(value);
                      setNearbyMarketplaceCity(null);
                      setNearbyMarketplaceNotice('');
                    }}
                  />
                  <Button
                    type="button"
                    variant={
                      nearbyMarketplaceCity &&
                      activeMarketCity === nearbyMarketplaceCity
                        ? 'default'
                        : 'outline'
                    }
                    className="order-4 h-9 rounded-md px-3 sm:order-3"
                    disabled={isLocatingNearbyListings}
                    onClick={handleNearbyMarketplaceSearch}
                    title={'موقعي يحتاج إذن الموقع الجغرافي'}
                  >
                    {isLocatingNearbyListings ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MapPin className="size-4" />
                    )}
                    {'موقعي'}
                  </Button>
                  <Button
                    type="button"
                    variant={isMarketFilterOpen ? 'default' : 'outline'}
                    className="order-2 h-10 w-10 rounded-md px-0 sm:order-4 sm:h-9 sm:w-auto sm:px-3"
                    onClick={() => setIsMarketFilterOpen((value) => !value)}
                  >
                    <SlidersHorizontal className="size-4" />
                    <span className="sr-only sm:not-sr-only">{'تصفية البحث'}</span>
                    {activeMarketFilterCount > 0 && (
                      <span className="grid size-5 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-400/20 dark:text-blue-100">
                        {activeMarketFilterCount}
                      </span>
                    )}
                  </Button>
                </div>

                {nearbyMarketplaceNotice && (
                  <div className="rounded-md border border-blue-200 bg-blue-50/80 px-3 py-2 text-right text-xs font-medium text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
                    {nearbyMarketplaceNotice}
                  </div>
                )}

                {isMarketFilterOpen && (
                  <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/70 p-3 text-right text-xs text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {hasManualMarketFilters
                        ? 'تم تطبيق تصفية البحث محليًا على الإعلانات المعروضة فقط.'
                        : 'اختر تصنيفًا أو منطقة لتصفية الإعلانات المعروضة.'}
                    </span>
                    {hasManualMarketFilters && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-md px-2 text-blue-700 hover:text-blue-800 dark:text-blue-100"
                        onClick={() => {
                          setSelectedMarketCategoryGroup('all');
                          setSelectedMarketSubcategory('all');
                          setSelectedMarketCity('all');
                          setNearbyMarketplaceCity(null);
                          setNearbyMarketplaceNotice('');
                        }}
                      >
                        <X className="size-3.5" />
                        مسح الفلاتر
                      </Button>
                    )}
                  </div>
                )}
              </div>
              </div>

              <div
                className={cn(
                  'marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3',
                  isCompactViewport
                    ? 'pb-[var(--marketplace-bottom-nav-space)] sm:pb-[var(--marketplace-bottom-nav-space)]'
                    : 'pb-1',
                )}
              >

              {hasActiveAssistantSearch && (
                <div className="smart-assistant-results-panel mb-3 grid gap-1.5">
                  <div className="flex items-center justify-between gap-2 border-b border-blue-100/80 pb-1.5 text-right dark:border-blue-400/10">
                    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold text-blue-700 dark:text-blue-200">
                      <Sparkles className="size-3.5 shrink-0" />
                      <span className="truncate">نتائج حمد حسب طلبك</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7 shrink-0 rounded-full"
                      aria-label="مسح بحث المساعد"
                      onClick={clearAssistantSearch}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>

                  {assistantResultListings.length > 0 ? (
                    <div className="smart-assistant-results-grid grid max-w-4xl gap-1.5 sm:gap-2">
                      {assistantResultListings.map((listing, index) => (
                        <ListingCardView
                          key={listing.id ?? listing.title}
                          className="smart-assistant-result-card"
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
                          isSmartResult
                          variant="horizontal"
                          style={{
                            animationDelay: `${Math.min(index, 8) * 45}ms`,
                          }}
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

              {(hasActiveAssistantSearch || hasMarketplaceSearchQuery) && (
                <div className="marketplace-section-title mb-3 flex items-center justify-end gap-3">
                  <div className="flex items-center gap-2 text-base font-bold">
                    <Sparkles className="size-4 text-blue-600" />
                    {hasActiveAssistantSearch ? 'استكشف أيضًا' : 'نتائج البحث'}
                  </div>
                </div>
              )}

              <div className="grid max-w-4xl gap-1.5">
                {exploreMarketplaceListings.map((listing, index) => (
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
                    prioritizeImage={index < 4}
                    variant="horizontal"
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
                  </div>
                </div>
              )}

              </div>
            </section>
            )}

            {shouldRenderAssistantPanel && (
            <section
              data-testid="assistant-panel"
              className={cn(
                'z-40 flex min-h-0 translate-y-0 transform-gpu flex-col overflow-hidden bg-white transition-[bottom,height,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-card',
                isCompactChatView && isChatInputFocused && 'transition-none',
                isCompactChatView
                  ? 'h-auto rounded-[1.15rem] border border-white/80 shadow-2xl shadow-slate-950/10 dark:border-white/10 dark:shadow-black/30'
                  : 'fixed inset-x-0 bottom-[calc(var(--marketplace-bottom-nav-space)-0.5rem)] h-72 rounded-t-[24px] border shadow-2xl shadow-slate-950/20 lg:static lg:h-auto lg:max-h-none lg:rounded-none lg:border-0 lg:shadow-none',
              )}
              style={isCompactChatView ? compactChatViewStyle : assistantPanelStyle}
            >
              <header
                className={cn(
                  'shrink-0 border-b px-4 py-3',
                  !isCompactChatView && 'touch-none',
                )}
                onPointerDown={
                  isCompactChatView ? undefined : handleAssistantDragStart
                }
                onPointerUp={
                  isCompactChatView ? undefined : handleAssistantDragEnd
                }
                onTouchEnd={
                  isCompactChatView ? undefined : handleAssistantTouchEnd
                }
                onTouchStart={
                  isCompactChatView ? undefined : handleAssistantTouchStart
                }
              >
                {!isCompactChatView && (
                  <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600 lg:hidden" />
                )}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {isCompactChatView && (
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="rounded-md"
                        aria-label="العودة للإعلانات"
                        onClick={closeMobileChatView}
                      >
                        <ChevronRight className="size-4" />
                      </Button>
                    )}
                    <div className="grid size-8 place-items-center overflow-hidden rounded-full border border-sky-400/20 bg-slate-900/80 text-sky-300 shadow-sm shadow-sky-950/20 dark:bg-slate-950/70">
                      <img alt="" className="size-7 rounded-full object-cover" src="/hamad-assistant-bubble.webp?v=ask-hamad-20260927" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                      onClick={startNewChat}
                      aria-label="مسح المحادثة وبدء محادثة جديدة"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </header>

              <div className={`flex min-h-0 flex-1 overflow-hidden transition-opacity duration-150 lg:pointer-events-auto lg:opacity-100 ${
                isAssistantContentVisible
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0'
              }`}>
                <Conversation
                  className="min-h-0 flex-1"
                  onPointerCancel={handleAssistantChatPointerCancel}
                  onPointerDown={handleAssistantChatPointerDown}
                  onPointerMove={handleAssistantChatPointerMove}
                  onPointerUp={handleAssistantChatPointerUp}
                >
                  <ConversationContent className="gap-4 px-4 py-5">
                    <ConversationAutoScroll
                      watchKey={assistantScrollWatchKey}
                      enabled
                    />
                    {filteredMessages.length === 0 ? (
                      <div className="grid h-full place-items-center text-center">
                        <div className="grid max-w-xs gap-4">
                          <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-100 text-blue-700">
                            <MessageCircle className="size-7" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold">كيف أساعدك؟</h3>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">
                              بيع، بحث، مقارنة، صور، أو فتح شات بخصوص إعلان.
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
                                  <span className="relative block aspect-square overflow-hidden rounded-md bg-slate-100 dark:bg-slate-900">
                                    <ResilientImage
                                      alt={listing.title}
                                      className="h-full w-full object-contain"
                                      decoding="async"
                                      fallbackSrcs={listing.imageFallbacks}
                                      fallback={<span className="grid h-full w-full place-items-center text-slate-500 dark:text-slate-400"><ImageIcon className="size-4" /></span>}
                                      loading="lazy"
                                      src={listing.image}
                                    />
                                  </span>
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
                        {filteredMessages.map((message, messageIndex) => {
                          const userImageParts =
                            message.role === 'user'
                              ? message.parts.filter(isUserImageMessagePart)
                              : [];
                          const userContentParts =
                            message.role === 'user'
                              ? message.parts.filter(isRenderableUserBubblePart)
                              : message.parts;

                          return (
                            <Message key={`${message.id}-${messageIndex}`} from={message.role}>
                              {message.role === 'assistant' ? (
                                <AssistantMessageFrame>
                                  <MessageContent>
                                    {renderMessageParts(message.parts, chatListingCardsById)}
                                  </MessageContent>
                                </AssistantMessageFrame>
                              ) : (
                                <div className="flex flex-col items-start gap-1.5">
                                  {userImageParts.length > 0 && (
                                    <div className="flex max-w-[min(74%,30rem)] flex-wrap justify-start gap-1.5">
                                      {userImageParts.map((part, partIndex) => (
                                        <MessageAttachment
                                          key={`user-image-${message.id}-${partIndex}`}
                                          className="border border-blue-500/20 bg-transparent shadow-sm"
                                          data={part}
                                        />
                                      ))}
                                    </div>
                                  )}
                                  {userContentParts.length > 0 && (
                                    <div className="max-w-[min(74%,30rem)] overflow-hidden break-words rounded-2xl rounded-br-md border border-blue-600 bg-blue-600 px-2.5 py-1.5 text-right text-[0.86rem] leading-6 text-white shadow-sm [overflow-wrap:anywhere]">
                                      {renderMessageParts(userContentParts, chatListingCardsById)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </Message>
                          );
                        })}
                        {isLoading && (
                          <Message from="assistant">
                            <AssistantMessageFrame avatar="hamad">
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
                ref={chatInputContainerRef}
                data-testid="assistant-chat-input-container"
                className="shrink-0 border-t p-1.5"
                onBlur={handleChatInputBlur}
                onFocus={handleChatInputFocus}
                onPointerDown={handleChatInputPointerDown}
              >
                <PromptInput
                  accept="image/*"
                  allowAttachments
                  className="mx-auto max-w-[52rem]"
                  dir="ltr"
                  inputGroupClassName="items-end rounded-[1.35rem] border border-border/80 bg-card shadow-lg shadow-slate-200/70 transition-[border-color,box-shadow] duration-200 focus-within:border-primary/70 focus-within:shadow-primary/15 dark:border-slate-700/80 dark:bg-slate-950/50 dark:shadow-slate-950/10 dark:focus-within:border-blue-400/70 dark:focus-within:shadow-blue-950/20"
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
                      className="col-start-2 row-start-2 max-h-20 min-h-10 resize-none px-1 py-1.5 text-right text-base leading-6 text-foreground placeholder:text-muted-foreground dark:text-slate-100 dark:placeholder:text-slate-400"
                      dir="rtl"
                      placeholder="اكتب طلبك أو أرفق صور المنتج..."
                      style={chatInputTextAreaStyle}
                    />
                  </PromptInputBody>
                  <ChatAttachmentControls />
                </PromptInput>
              </div>
            </section>
            )}
          </div>
        </section>

      </div>
      {shouldRenderAssistantBubble && (
        <button
          ref={assistantBubbleRef}
          type="button"
          aria-label="فتح حمد"
          className="smartstore-ai-bubble"
          data-state={assistantBubbleState}
          style={{
            transform: `translate3d(${assistantBubblePosition.x}px, ${assistantBubblePosition.y}px, 0)`,
          }}
          onPointerCancel={handleAssistantBubblePointerCancel}
          onPointerDown={handleAssistantBubblePointerDown}
          onPointerMove={handleAssistantBubblePointerMove}
          onPointerUp={handleAssistantBubblePointerUp}
        >
          <span className="smartstore-ai-bubble__halo" aria-hidden="true" />
          <span className="smartstore-ai-bubble__core" aria-hidden="true">
            <img alt="" src="/hamad-assistant-bubble.webp?v=ask-hamad-20260927" />
          </span>
          <span className="smartstore-ai-bubble__glint" aria-hidden="true" />
        </button>
      )}
    </main>
  );
}
