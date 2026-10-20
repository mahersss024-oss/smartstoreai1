'use client';

import { getArabicCustomerMessage } from '@/lib/customer-language';
/* eslint-disable @next/next/no-img-element */

import { formatMarketplaceCategory as formatCategory, isMarketplaceCategory, marketplaceCategoryDefinitions, marketplaceCategoryGroups, marketplaceCategoryIds as manualListingCategoryOptions } from '@/lib/marketplace/categories';
import { CategoryOptionSelect } from '@/components/category-option-select';
import { CarModelSelect } from '@/components/car-model-select';
import { MarketplaceFilterRows } from '@/components/marketplace-filter-row';
import { getListingCarModel, getListingCategoryOption, getMarketplaceCategoryOption, marketplaceCategoryOptionAttribute } from '@/lib/marketplace/category-options';
import { getMarketplaceCarModel, marketplaceCarModelAttribute } from '@/lib/marketplace/car-models';
import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type ReactElement,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useOverlayViewport } from '@/hooks/use-overlay-viewport';
import { DefaultChatTransport, type ChatStatus, type FileUIPart, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
  Bot,
  Clock3,
  Download,
  ImageIcon,
  Loader2,
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
import { CitySelector } from '@/components/city-selector';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { ListingCardImage } from '@/components/listing-card-image';
import { ListingCardSkeleton } from '@/components/listing-card-skeleton';
import { ListingShareButton } from '@/components/listing-share-button';
import { ThemeSync } from '@/components/theme-toggle';
import {
  chatServiceUnavailableMessage,
  getSafeAssistantText,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAppBridge } from '@/hooks/use-app-bridge';
import { useAuthProviderVisibility } from '@/hooks/use-auth-provider-visibility';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { Button } from '@ui/button';
import { cn } from '@/lib/utils';
import { createChatImageContext, type RetainedChatImage } from '@/lib/chat/image-context';
import { clearChatSessionState, readChatSessionState, writeChatSessionState } from '@/lib/chat/session-state';
import { saudiMarketplaceCities } from '@/lib/marketplace/cities';
import { getHomeBrowseKey, readHomeBrowseState, reloadHomeBrowsePages, writeHomeBrowseState } from '@/lib/marketplace/home-browse-state';

const CommissionAgreementDialog = dynamic(
  () =>
    import('@/components/commission-agreement-dialog').then(
      (module) => module.CommissionAgreementDialog,
    ),
  { ssr: false },
);

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
  carModel?: string;
  carModelLabel?: string;
  categoryOption?: string;
  categoryOptionLabel?: string;
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


type ApiListingRecord = {
  attributes?: Record<string, unknown>;
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

type AssistantState = 'expanded' | 'collapsed';

type HomeAssistantRuntimeState = {
  conversationId: string;
  messages: UIMessage[];
  creationMethod: 'chat' | null;
  retainedListingImages: RetainedChatImage[];
  retainedListingImageMessageId: string | null;
  shouldResetDraftContext: boolean;
};

function readHomeAssistantRuntimeState(ownerId: string | null) {
  return readChatSessionState<HomeAssistantRuntimeState>(ownerId);
}

function writeHomeAssistantRuntimeState(ownerId: string | null, state: HomeAssistantRuntimeState) {
  writeChatSessionState(ownerId, state);
}

function clearHomeAssistantRuntimeState() {
  clearChatSessionState();
}

async function prepareUploadableImageFilesOnDemand(files: File[]) {
  const { prepareUploadableImageFiles } = await import(
    '@/lib/client-image-normalization'
  );

  return prepareUploadableImageFiles(files);
}


const authRequiredMarker = '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]]';
const chatRateLimitMessage =
  'الضغط مرتفع الآن على حمد. انتظر لحظات ثم أعد إرسال الطلب.';
const chatNetworkErrorMessage =
  'تعذر تحميل رد المساعد. تأكد من الاتصال ثم أعد إرسال الطلب.';
const chatSessionExpiredMessage =
  'انتهت صلاحية جلسة الدخول. يرجى تسجيل الدخول من جديد ثم إعادة المحاولة.';
const chatAccountChangedMessage =
  'تغيّر حساب الدخول. حدّث الصفحة لبدء محادثة تخص حسابك الحالي.';
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
  const banner = document.querySelector('.open-in-app-banner')?.getBoundingClientRect();
  const navigation = document.querySelector('.marketplace-bottom-nav')?.getBoundingClientRect();
  const minX = assistantBubbleMargin;
  const maxX = Math.max(minX, width - assistantBubbleSize - assistantBubbleMargin);
  const minY = Math.max(0, banner?.bottom ?? 0) + assistantBubbleMargin;
  const navigationTop = navigation && navigation.height > 0 && navigation.top > 0
    ? navigation.top - assistantBubbleMargin
    : height;
  const maxY = Math.max(
    minY,
    Math.min(height - assistantBubbleBottomReserve, navigationTop) - assistantBubbleSize,
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

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

    if (typeof parsed.x !== 'number' || !Number.isFinite(parsed.x)
      || typeof parsed.y !== 'number' || !Number.isFinite(parsed.y)) {
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
  const previewViewportRef = useOverlayViewport<HTMLDivElement>();
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

      {previewFile && createPortal(
        <div
          aria-modal="true"
          className="viewport-overlay fixed inset-0 z-[90] grid place-items-center bg-slate-950/82 p-4 backdrop-blur-md [--overlay-content-height-limit:88dvh]"
          ref={previewViewportRef}
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
        </div>,
        document.body,
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




type ManualListingForm = {
  carModel: string;
  categoryOption: string;
  autoCategory: boolean;
  title: string;
  description: string;
  priceMode: 'number' | 'bid' | 'negotiable';
  price: string;
  city: string;
  category: string;
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
  carModel: '',
  categoryOption: '',
  autoCategory: true,
  title: '',
  description: '',
  priceMode: 'number',
  price: '',
  city: '',
  category: 'other',
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

async function resetAssistantDraftContext(conversationId: string, ownerId: string | null) {
  await fetch('/api/chat/reset', {
    cache: 'no-store',
    credentials: 'include',
    method: 'POST',
    headers: { 'x-chat-conversation-id': conversationId, ...(ownerId ? { 'x-chat-owner-id': ownerId } : {}) },
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



function listingRecordToCard(listing: ApiListingRecord): ListingCard {
  const primaryImage = listing.images?.find(
    (image) => image.status === 'approved',
  );
  const imageUrls = getDurableImageUrls(
    primaryImage?.thumbnailUrl,
    primaryImage?.displayUrl,
    listing.image,
    ...(listing.imageUrls ?? []),
    primaryImage?.originalUrl,
  );

  return {
    id: listing.id,
    sellerId: listing.sellerId,
    title: listing.title ?? 'إعلان بدون عنوان',
    price: formatListingPrice(listing.price),
    city: listing.city ?? 'السعودية',
    category: formatCategory(listing.category),
    categoryOption: getListingCategoryOption(listing)?.id,
    categoryOptionLabel: getListingCategoryOption(listing)?.label,
    carModel: getListingCarModel(listing)?.id,
    carModelLabel: getListingCarModel(listing)?.label,
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
  const authProviders = useAuthProviderVisibility();
  const { session } = useAuthSession();
  const googleHref = session.commissionAgreementAccepted
    ? '/api/auth/google/start'
    : '/commission-agreement?provider=google';
  const appleHref = session.commissionAgreementAccepted
    ? '/api/auth/apple/start'
    : '/commission-agreement?provider=apple';

  return (
    <div className="grid gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-right text-blue-950 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-50">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-1 size-4 shrink-0 text-blue-700 dark:text-blue-300" />
        <p className="text-sm leading-7">{text.replace(authRequiredMarker, '').trim()}</p>
      </div>
      {authProviders.google ? (
        <Button asChild className="h-10 w-full justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
          <a href={googleHref}>
            <GoogleMark className="size-5" />
            <span>المتابعة باستخدام جوجل</span>
          </a>
        </Button>
      ) : null}
      {authProviders.apple ? (
        <Button asChild className="h-10 w-full justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
          <a href={appleHref}>
            <AppleMark className="size-5" />
            <span>المتابعة باستخدام آبل</span>
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function AuthProviderMenu() {
  const [open, setOpen] = useState(false);
  const authProviders = useAuthProviderVisibility();
  const { session } = useAuthSession();
  const googleHref = session.commissionAgreementAccepted
    ? '/api/auth/google/start'
    : '/commission-agreement?provider=google';
  const appleHref = session.commissionAgreementAccepted
    ? '/api/auth/apple/start'
    : '/commission-agreement?provider=apple';

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <div className="relative" dir="rtl">
      <Button
        size="sm"
        className="rounded-md bg-blue-600 hover:bg-blue-700"
        data-testid="auth-provider-trigger"
        aria-label="تسجيل الدخول"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <User className="size-4" />
        دخول
      </Button>
      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+0.45rem)] z-[85] grid w-56 gap-1 rounded-md border border-slate-200/70 bg-popover p-1.5 text-popover-foreground shadow-xl dark:border-white/10"
          role="menu"
          aria-label="مزودات تسجيل الدخول"
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          tabIndex={-1}
          data-testid="auth-provider-menu"
        >
          <div className="px-2 py-1.5 text-right text-xs text-muted-foreground">
            الدخول إلى حسابك
          </div>
          {authProviders.google ? (
            <a
              className="flex h-10 items-center justify-between rounded-md px-3 text-right text-sm hover:bg-accent"
              href={googleHref}
              role="menuitem"
            >
              <span>دخول جوجل</span>
              <GoogleMark className="size-5" />
            </a>
          ) : null}
          {authProviders.apple ? (
            <a
              className="flex h-10 items-center justify-between rounded-md px-3 text-right text-sm hover:bg-accent"
              href={appleHref}
              role="menuitem"
            >
              <span>دخول آبل</span>
              <AppleMark className="size-5 text-foreground" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
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
  const listingId = useMemo(() => getListingIdFromHref(href), [href]);
  const [verifiedListing, setVerifiedListing] = useState<ListingCard | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<
    'idle' | 'checking' | 'available' | 'unavailable'
  >('idle');
  const effectiveListing = listing ?? verifiedListing ?? undefined;

  useEffect(() => {
    if (listing || !listingId) {
      setVerifiedListing(null);
      setVerificationStatus('idle');
      return;
    }

    let cancelled = false;
    setVerifiedListing(null);
    setVerificationStatus('checking');

    fetch(`/api/marketplace/listings/${encodeURIComponent(listingId)}`, {
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json().catch(() => null)) as {
          listing?: ApiListingRecord;
        } | null;

        return payload?.listing ? listingRecordToCard(payload.listing) : null;
      })
      .then((fetchedListing) => {
        if (cancelled) {
          return;
        }

        setVerifiedListing(fetchedListing);
        setVerificationStatus(fetchedListing ? 'available' : 'unavailable');
      })
      .catch(() => {
        if (!cancelled) {
          setVerificationStatus('unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listing, listingId]);

  if (!effectiveListing && verificationStatus === 'checking') {
    return (
      <div className="my-2 grid gap-2 rounded-md border border-blue-200 bg-blue-50/80 p-3 text-right text-blue-950 shadow-sm dark:border-blue-400/25 dark:bg-blue-400/10 dark:text-blue-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-blue-700 dark:text-blue-200">
              جار التحقق من الإعلان
            </div>
            <div className="mt-1 text-sm font-bold">نتأكد من حالة رابط الإعلان</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              إذا كان الإعلان منشورًا سيظهر زر الفتح تلقائيًا.
            </div>
          </div>
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-blue-100 text-blue-700 shadow-sm shadow-blue-950/10 dark:bg-blue-900/40 dark:text-blue-200">
            <Loader2 className="size-5 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (!effectiveListing) {
    return (
      <div className="my-2 grid gap-2 rounded-md border border-amber-200 bg-amber-50/80 p-3 text-right text-amber-950 shadow-sm dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-50">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-amber-700 dark:text-amber-200">
              إعلان غير متاح
            </div>
            <div className="mt-1 text-sm font-bold">لا يمكن فتح هذا الإعلان</div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              قد يكون الإعلان محذوفًا أو موقوفًا عن النشر أو لم يعد منشورًا.
            </div>
          </div>
          <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md bg-amber-100 text-amber-700 shadow-sm shadow-amber-950/10 dark:bg-amber-900/40 dark:text-amber-200">
            <Megaphone className="size-5" />
          </div>
        </div>
      </div>
    );
  }

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
          {effectiveListing.image ? (
            <>
              <ListingCardImage
                alt={effectiveListing.title}
                className="h-full w-full object-contain"
                fallbackSrcs={effectiveListing.imageFallbacks}
                fallback={<Megaphone className="size-5" />}
                height={56}
                sizes="56px"
                src={effectiveListing.image}
                width={56}
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
  assistant = false,
): ReactNode[] {
  return parts.flatMap((part, index) => {
    if (part.type === 'text') {
      if (!part.text.trim()) return [];
      const text = assistant ? getSafeAssistantText(part.text) || chatServiceUnavailableMessage : part.text;
      if (text.includes(authRequiredMarker) || (assistant && part.text.includes(authRequiredMarker))) {
        return [<SignInCard key={`auth-${index}`} text={assistant ? getSafeAssistantText(part.text) || `${authRequiredMarker} يرجى تسجيل الدخول للمتابعة.` : text} />];
      }

      return renderTextMessagePart(text, index, listingsById);
    }

    if (part.type === 'file') {
      return [<MessageAttachment key={`file-${index}`} data={part} />];
    }

    return [];
  });
}

function hasVisibleAssistantContent(message: UIMessage) {
  return message.role === 'assistant' && message.parts.some(part =>
    part.type === 'file' || (part.type === 'text' && part.text.trim().length > 0));
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

function ListingImageFallback() {
  return (
    <div className="grid h-full w-full place-items-center bg-slate-100 text-center text-[11px] font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
      <div className="grid gap-1">
        <ImageIcon className="mx-auto size-5" />
        <span>لا توجد صورة حقيقية</span>
      </div>
    </div>
  );
}

function ListingCardView({
  listing,
  className,
  onOpen,
  eagerImage = false,
  prioritizeImage = false,
  style,
  variant = 'grid',
}: {
  listing: ListingCard;
  className?: string;
  onOpen: (listing: ListingCard) => void;
  eagerImage?: boolean;
  prioritizeImage?: boolean;
  style?: CSSProperties;
  variant?: 'grid' | 'horizontal';
}) {
  if (variant === 'horizontal') {
    return (
      <article
        className={cn(
          'marketplace-listing-card group relative grid min-h-[6.25rem] w-full min-w-0 cursor-pointer grid-cols-[6.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right shadow-sm transition hover:border-blue-300 hover:bg-blue-50/35 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10 sm:min-h-[7.25rem] sm:grid-cols-[7.25rem_minmax(0,1fr)]',
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
        <div className="relative aspect-square min-h-[6.25rem] bg-slate-100 dark:bg-slate-900 sm:min-h-[7.25rem]">
          {listing.image ? (
            <>
              <ListingCardImage
                alt={listing.title}
                eager={eagerImage}
                fallbackSrcs={listing.imageFallbacks}
                fallback={<ListingImageFallback />}
                height={116}
                priority={prioritizeImage}
                sizes="(min-width: 640px) 116px, 100px"
                src={listing.image}
                width={116}
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
            <span className="truncate">{listing.category ?? listing.status ?? 'إعلان'}{listing.categoryOptionLabel ? ` · ${listing.categoryOptionLabel}` : ''}{listing.carModelLabel ? ` · ${listing.carModelLabel}` : ''}</span>
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
            <ListingCardImage
              alt={listing.title}
              eager={eagerImage}
              className="h-full w-full object-contain"
              fallbackSrcs={listing.imageFallbacks}
              fallback={<ListingImageFallback />}
              height={200}
              priority={prioritizeImage}
              sizes="(min-width: 640px) 184px, 50vw"
              src={listing.image}
              width={320}
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
  avatar = 'hamad',
  children,
}: {
  avatar?: 'bot' | 'hamad';
  children: ReactNode;
}) {
  const isHamadAvatar = avatar === 'hamad';

  return (
    <div className="flex w-full items-start gap-2" data-testid="assistant-message-frame">
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
  if (error.message === chatAccountChangedMessage) return chatAccountChangedMessage;

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
    if (response.status === 409) throw new Error(chatAccountChangedMessage);

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
  useAppBridge();
  const pathname = usePathname();
  const router = useRouter();
  const { session, isSessionLoading } = useAuthSession();
  const chatOwnerId = session.authenticated ? session.user?.id ?? null : null;
  const chatImages = useMemo(() => createChatImageContext(chatOwnerId), [chatOwnerId]);
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        credentials: 'include',
        fetch: guardedChatFetch,
        prepareSendMessagesRequest: chatImages.prepareRequest,
      }),
    [chatImages],
  );
  const { messages, sendMessage, status, error, setMessages, stop } = useChat({
    id: `hamad:${chatOwnerId ?? 'signed-out'}`,
    transport: chatTransport,
  });
  useEffect(() => () => { void stop(); }, [stop]);
  const [restoredBrowseState] = useState(() => readHomeBrowseState<ListingCard>());
  const restoredBrowseResults = restoredBrowseState &&
    restoredBrowseState.listingsKey === getHomeBrowseKey(restoredBrowseState) ? restoredBrowseState : null;
  const canRestoreBrowseListings = Boolean(restoredBrowseResults);
  const [browseListingsKey, setBrowseListingsKey] = useState(restoredBrowseState?.listingsKey ?? '');
  const initialBrowseRefreshRef = useRef(true);
  const pendingBrowseViewportRef = useRef(restoredBrowseResults?.viewport ?? null);
  const [marketplaceListings, setMarketplaceListings] =
    useState<ListingCard[]>(restoredBrowseResults?.listings ?? featuredListings);
  const [selectedMarketCategoryGroup, setSelectedMarketCategoryGroup] =
    useState(restoredBrowseState?.categoryGroup ?? 'all');
  const [selectedMarketSubcategory, setSelectedMarketSubcategory] =
    useState(restoredBrowseState?.subcategory ?? 'all');
  const [selectedMarketCategoryOption, setSelectedMarketCategoryOption] = useState(restoredBrowseState?.categoryOption ?? '');
  const [selectedMarketCarModel, setSelectedMarketCarModel] = useState(restoredBrowseState?.carModel ?? '');
  const [categoryWindowStart, setCategoryWindowStart] = useState(restoredBrowseResults?.viewport.categoryWindowStart ?? 0);
  const [selectedMarketCity, setSelectedMarketCity] = useState(restoredBrowseState?.city ?? 'all');
  const [nearbyMarketplaceCity, setNearbyMarketplaceCity] =
    useState<string | null>(restoredBrowseState?.nearbyCity ?? null);
  const [nearbyMarketplaceNotice, setNearbyMarketplaceNotice] = useState('');
  const [isLocatingNearbyListings, setIsLocatingNearbyListings] =
    useState(false);
  const [marketplaceSearchInput, setMarketplaceSearchInput] = useState(restoredBrowseState?.searchInput ?? '');
  const [marketplaceSearchQuery, setMarketplaceSearchQuery] = useState(restoredBrowseState?.searchInput.trim() ?? '');
  const [isMarketFilterOpen, setIsMarketFilterOpen] = useState(restoredBrowseState?.filterOpen ?? false);
  const [isManualListingOpen, setIsManualListingOpen] = useState(false);
  const [manualListingForm, setManualListingForm] =
    useState<ManualListingForm>(defaultManualListingForm);
  const [manualCategoryStatus, setManualCategoryStatus] = useState<'idle' | 'loading' | 'suggested' | 'uncertain' | 'unavailable'>('idle');
  useEffect(() => {
    if (!isManualListingOpen || !manualListingForm.autoCategory) return;
    const title = manualListingForm.title;
    setManualListingForm(form => form.autoCategory ? { ...form, category: 'other', categoryOption: '', carModel: '' } : form);
    setManualCategoryStatus('idle');
    if (!session.authenticated || title.trim().length < 2) return;
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setManualCategoryStatus('loading');
      try {
        const response = await fetch('/api/marketplace/listing-category', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }), signal: controller.signal,
        });
        if (!response.ok) throw new Error('category_unavailable');
        const result = await response.json() as { category?: unknown; categoryOption?: unknown; carModel?: unknown; status?: string };
        if (!active) return;
        const category = typeof result.category === 'string' && isMarketplaceCategory(result.category)
          && result.status === 'suggested' ? result.category : null;
        const categoryOption = category ? getMarketplaceCategoryOption(category, result.categoryOption)?.id ?? '' : '';
        const carModel = category === 'cars' ? getMarketplaceCarModel(categoryOption, result.carModel)?.id ?? '' : '';
        setManualListingForm(form => form.autoCategory && form.title === title && !manualListingSubmissionRef.current
          ? { ...form, category: category ?? 'other', categoryOption, carModel } : form);
        setManualCategoryStatus(category ? 'suggested' : 'uncertain');
      } catch {
        if (active) setManualCategoryStatus('unavailable');
      }
    }, 900);
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [isManualListingOpen, manualListingForm.autoCategory, manualListingForm.title, session.authenticated]);
  const [manualListingImages, setManualListingImages] = useState<File[]>([]);
  const [manualListingImagePreviewUrls, setManualListingImagePreviewUrls] =
    useState<string[]>([]);
  const [manualListingImagePreviewIndex, setManualListingImagePreviewIndex] =
    useState<number | null>(null);
  const manualPreviewViewportRef = useOverlayViewport<HTMLDivElement>();
  const [isPreparingManualListingImages, setIsPreparingManualListingImages] =
    useState(false);
  const [manualListingNotice, setManualListingNotice] =
    useState<ManualListingNotice | null>(null);
  const [manualListingSubmission, setManualListingSubmission] =
    useState<ManualListingSubmission | null>(null);
  const manualListingSubmissionRef = useRef<ManualListingSubmission | null>(null);
  const marketplaceListingsScrollRef = useRef<HTMLDivElement | null>(null);
  const marketplaceContentOffsetTargetRef = useRef('var(--marketplace-tools-height, 180px)');
  const marketplaceToolsPanelRef = useRef<HTMLDivElement | null>(null);
  const marketplaceCategoriesRef = useRef<HTMLDivElement | null>(null);
  const marketplaceToolsDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    startOffset: 0,
    axis: 'pending' as 'pending' | 'horizontal' | 'vertical',
    wasHidden: false,
  });
  const suppressMarketplaceToolsClickRef = useRef(false);
  const lastMarketplaceScrollTopRef = useRef(restoredBrowseResults?.viewport.scrollTop ?? 0);
  const lastMarketplaceScrollHeightRef = useRef(0);
  const marketplaceToolsManualLockUntilRef = useRef(0);
  const marketplaceToolsTopRevealTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const marketplaceTopActionsHiddenRef = useRef(restoredBrowseResults?.viewport.toolsHidden ?? false);
  const marketplaceScrollReversalDistanceRef = useRef(0);
  const marketplaceScrollIntentRef = useRef({
    direction: 0,
    distance: 0,
    lastToggleAt: 0,
  });
  const [isMarketplaceTopActionsHidden, setIsMarketplaceTopActionsHidden] =
    useState(restoredBrowseResults?.viewport.toolsHidden ?? false);
  const [isMarketplaceToolsDragging, setIsMarketplaceToolsDragging] =
    useState(false);
  const [marketplaceToolsDragOffset, setMarketplaceToolsDragOffset] =
    useState(0);
  const [isManualPublishAgreementOpen, setIsManualPublishAgreementOpen] =
    useState(false);
  const [isManualListingFallbackDismissed, setIsManualListingFallbackDismissed] =
    useState(false);
  const [listingPagination, setListingPagination] = useState(restoredBrowseResults?.pagination ?? {
    page: 1,
    hasMore: false,
  });
  const [isLoadingListings, setIsLoadingListings] = useState(false);
  const [creationMethod, setCreationMethod] = useState<'chat' | null>(null);
  const [restoredChatOwnerId, setRestoredChatOwnerId] = useState<string | null>();
  const hasRestoredChat = !isSessionLoading && restoredChatOwnerId === chatOwnerId;
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
  const assistantDragStartYRef = useRef<number | null>(null);
  const assistantBubbleDragRef = useRef<AssistantBubbleDragState | null>(null);
  const assistantBubbleRef = useRef<HTMLButtonElement | null>(null);
  const lastAssistantBubbleMessageIdRef = useRef<string | null>(null);
  const compactViewportRef = useRef<boolean | null>(null);
  const keyboardBaselineViewportHeightRef = useRef<number | null>(null);
  const chatInputContainerRef = useRef<HTMLDivElement | null>(null);
  const assistantChatTapTrackerRef = useRef<ChatTapTracker>(
    createEmptyChatTapTracker(),
  );
  const listingsReplaceRequestIdRef = useRef(0);
  const listingsAppendRequestIdRef = useRef(0);
  const listingsAbortControllersRef = useRef(new Set<AbortController>());
  const listingsInFlightRequestsRef = useRef(new Map<string, Promise<void>>());
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
      promise: prepareUploadableImageFilesOnDemand(selectedImages),
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
  const shouldResetDraftContextRef = useRef(true);
  const filteredMessages = useMemo(
    () => hasRestoredChat ? messages.filter((message) => message.role !== 'system') : [],
    [hasRestoredChat, messages],
  );
  const latestAssistantMessageId = useMemo(
    () =>
      filteredMessages.findLast((message) => message.role === 'assistant')?.id ??
      null,
    [filteredMessages],
  );
  const isLoading = status === 'streaming' || status === 'submitted';
  const showAssistantThinking = isLoading && !filteredMessages
    .slice(filteredMessages.findLastIndex(message => message.role === 'user') + 1)
    .some(hasVisibleAssistantContent);
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
  const latestAssistantIndex = filteredMessages.findLastIndex(message => message.role === 'assistant');
  const latestAssistantMetadata = latestAssistantIndex > filteredMessages.findLastIndex(message => message.role === 'user')
    ? filteredMessages[latestAssistantIndex]?.metadata : undefined;
  const assistantIntent = isRecord(latestAssistantMetadata) ? latestAssistantMetadata.marketplaceIntent : undefined;
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
  const activeMarketCategoryId = marketplaceCategoryDefinitions.find(category => category.label === activeMarketSubcategory)?.id ?? '';
  const activeMarketCategoryOption = getMarketplaceCategoryOption(activeMarketCategoryId, selectedMarketCategoryOption)?.id ?? '';
  const activeMarketCarModel = activeMarketCategoryId === 'cars' ? getMarketplaceCarModel(activeMarketCategoryOption, selectedMarketCarModel)?.id ?? '' : '';
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

      return matchesCategory && matchesCity && (!activeMarketCategoryOption || listing.categoryOption === activeMarketCategoryOption)
        && (!activeMarketCarModel || listing.carModel === activeMarketCarModel);
    });
  }, [
    activeMarketCategoryGroup,
    activeMarketCategoryGroupConfig,
    activeMarketCity,
    activeMarketSubcategory,
    activeMarketCategoryOption,
    activeMarketCarModel,
    marketplaceListings,
  ]);
  const hasManualMarketFilters =
    Boolean(activeMarketCategoryOption) ||
    activeMarketCategoryGroup !== 'all' ||
    activeMarketSubcategory !== 'all' ||
    activeMarketCity !== 'all';
  const activeMarketFilterCount =
    Number(Boolean(activeMarketCarModel)) +
    Number(Boolean(activeMarketCategoryOption)) +
    Number(activeMarketCategoryGroup !== 'all') +
    Number(activeMarketSubcategory !== 'all') +
    Number(activeMarketCity !== 'all');
  const exploreMarketplaceListings = manuallyFilteredMarketplaceListings;
  const chatListingCardsById = useMemo(() => new Map(
    marketplaceListings.filter(listing => listing.id).map(listing => [listing.id!, listing]),
  ), [marketplaceListings]);
  const canLoadMoreListings = listingPagination.hasMore && marketplaceListings.length > 0;

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

    const visualViewportHeight = visualViewportFrame?.height;
    const hasKeyboardViewport =
      typeof visualViewportHeight === 'number' &&
      typeof window !== 'undefined' &&
      visualViewportHeight < window.innerHeight - 24;

    if (!isChatInputFocused || !visualViewportFrame || !hasKeyboardViewport) {
      return {
        blockSize: 'auto',
        bottom: 'calc(env(safe-area-inset-bottom) + 0.5rem)',
        insetInline: '0',
        marginInline: 'auto',
        maxWidth: '40rem',
        minHeight: '0',
        position: 'fixed',
        top: 'calc(var(--safe-area-top) + 0.5rem)',
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
    let observer: ResizeObserver | undefined;
    // The mobile banner mounts after platform detection, so measure after that commit.
    const layoutFrame = window.requestAnimationFrame(() => {
      syncBubblePosition();
      observer = new ResizeObserver(syncBubblePosition);
      for (const selector of ['.open-in-app-banner', '.marketplace-bottom-nav']) {
        const element = document.querySelector(selector);
        if (element) observer.observe(element);
      }
    });
    window.addEventListener('resize', syncBubblePosition);
    window.visualViewport?.addEventListener('resize', syncBubblePosition);

    return () => {
      window.cancelAnimationFrame(layoutFrame);
      observer?.disconnect();
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
    options?: { showLoading?: boolean; restorePages?: number },
  ) => {
    const isAppendRequest = page > 1;
    const params = new URLSearchParams();
    const showLoading = options?.showLoading ?? true;
    const effectiveQuery = query ?? marketplaceSearchQuery;
    const restoringWindow = !isAppendRequest && options?.restorePages !== undefined;
    const listingsKey = getHomeBrowseKey({ searchInput: effectiveQuery, city: activeMarketCity,
      categoryGroup: activeMarketCategoryGroup, subcategory: activeMarketSubcategory, categoryOption: activeMarketCategoryOption, carModel: activeMarketCarModel });

    if (effectiveQuery.trim()) {
      params.set('q', effectiveQuery.trim());
    }

    if (activeMarketCity !== 'all') {
      params.set('city', activeMarketCity);
    }
    if (activeMarketSubcategory !== 'all') {
      const category = marketplaceCategoryDefinitions.find(item => item.label === activeMarketSubcategory);
      if (category) params.set('category', category.id);
    } else if (activeMarketCategoryGroup !== 'all') {
      params.set('categories', marketplaceCategoryDefinitions.filter(item => item.group === activeMarketCategoryGroup).map(item => item.id).join(','));
    }

    if (activeMarketCategoryOption) params.set('categoryOption', activeMarketCategoryOption);
    if (activeMarketCarModel) params.set('carModel', activeMarketCarModel);
    params.set('page', String(page));
    params.set('limit', '24');

    const endpoint = `/api/marketplace/listings?${params.toString()}`;
    const requestKey = restoringWindow ? `${endpoint}|pages=${options.restorePages}` : endpoint;
    const existingRequest = listingsInFlightRequestsRef.current.get(requestKey);

    if (existingRequest) {
      return existingRequest;
    }

    const requestId = isAppendRequest
      ? ++listingsAppendRequestIdRef.current
      : ++listingsReplaceRequestIdRef.current;
    const requestController = new AbortController();
    listingsAbortControllersRef.current.add(requestController);

    if (!isAppendRequest) {
      listingsAppendRequestIdRef.current += 1;
    }

    const isCurrentRequest = () =>
      isAppendRequest
        ? requestId === listingsAppendRequestIdRef.current
        : requestId === listingsReplaceRequestIdRef.current;

    if (showLoading) {
      setIsLoadingListings(true);
    }

    const fetchPage = async (requestedPage: number) => {
      if (!isCurrentRequest()) throw new DOMException('Superseded listing request', 'AbortError');
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(requestedPage));
      const response = await fetch(`/api/marketplace/listings?${pageParams.toString()}`, {
        cache: 'no-store', signal: requestController.signal,
      });
      if (!response.ok) throw new Error('listings_unavailable');
      return response.json() as Promise<ListingsResponsePayload>;
    };
    const request = (restoringWindow
      ? reloadHomeBrowsePages(options.restorePages!, fetchPage)
      : fetchPage(page))
      .then((payload) => {
        if (!isCurrentRequest()) {
          return;
        }

        if (payload.listings) {
          setBrowseListingsKey(listingsKey);
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
        if (!isCurrentRequest()) {
          return;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        if (restoringWindow || !showLoading) return;
        if (page <= 1) {
          setMarketplaceListings(featuredListings);
        }
        setListingPagination({ page: 1, hasMore: false });
      })
      .finally(() => {
        listingsInFlightRequestsRef.current.delete(requestKey);
        listingsAbortControllersRef.current.delete(requestController);

        if (isCurrentRequest()) {
          setIsLoadingListings(false);
        }
      });

    listingsInFlightRequestsRef.current.set(requestKey, request);
    return request;
  }, [activeMarketCity, activeMarketCategoryGroup, activeMarketSubcategory, activeMarketCategoryOption, activeMarketCarModel, marketplaceSearchQuery]);

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshMarketplaceListings(undefined, 1, { showLoading: false });
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshMarketplaceListings]);

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
    if (isSessionLoading) return;
    let cancelled = false;
    const restoredChatState = readHomeAssistantRuntimeState(chatOwnerId);

    if (restoredChatState) {
      chatImages.restore(restoredChatState.retainedListingImages, restoredChatState.retainedListingImageMessageId, restoredChatState.conversationId);
      shouldResetDraftContextRef.current = restoredChatState.shouldResetDraftContext;

      queueMicrotask(() => {
        if (cancelled) {
          return;
        }

        setMessages(restoredChatState.messages);
        setCreationMethod(restoredChatState.creationMethod ?? null);
        setRestoredChatOwnerId(chatOwnerId);
      });

      return () => {
        cancelled = true;
      };
    }

    clearStaleStoredChatState();
    chatImages.clear();
    shouldResetDraftContextRef.current = true;
    void clearRetainedListingImages().catch(() => {});

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setMessages([]);
      setCreationMethod(null);
    });

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setRestoredChatOwnerId(chatOwnerId);
    });

    return () => {
      cancelled = true;
    };
  }, [chatImages, chatOwnerId, isSessionLoading, setMessages]);

  useEffect(() => {
    if (!hasRestoredChat) {
      return;
    }

    writeHomeAssistantRuntimeState(chatOwnerId, {
      conversationId: chatImages.snapshot().conversationId,
      messages,
      creationMethod,
      retainedListingImages: chatImages.snapshot().images,
      retainedListingImageMessageId: chatImages.snapshot().sourceMessageId,
      shouldResetDraftContext: shouldResetDraftContextRef.current,
    });
  }, [
    creationMethod,
    chatImages,
    chatOwnerId,
    hasRestoredChat,
    messages,
  ]);

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
      const restoreWindow = initialBrowseRefreshRef.current && canRestoreBrowseListings &&
        restoredBrowseState?.listingsKey === getHomeBrowseKey({ searchInput: marketplaceSearchQuery,
          city: activeMarketCity, categoryGroup: activeMarketCategoryGroup, subcategory: activeMarketSubcategory, categoryOption: activeMarketCategoryOption, carModel: activeMarketCarModel });
      initialBrowseRefreshRef.current = false;
      void refreshMarketplaceListings(undefined, 1, restoreWindow ? {
        showLoading: false, restorePages: restoredBrowseState!.pagination.page,
      } : undefined);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [refreshMarketplaceListings, activeMarketCategoryGroup, activeMarketCity, activeMarketSubcategory, activeMarketCategoryOption, activeMarketCarModel,
    canRestoreBrowseListings, marketplaceSearchQuery, restoredBrowseState]);


  useSmartstoreRealtime({
    connectDelayMs: 2500,
    enabled: true,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_created',
      'ad_updated',
      'ad_deleted',
      'ad_status_changed',
      'maintenance_cleanup',
    ],
    onEvent: () => {
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
      setIsManualListingFallbackDismissed(false);

      const resetDraftContext =
        shouldResetDraftContextRef.current || filteredMessages.length === 0;
      shouldResetDraftContextRef.current = false;

      void sendMessage(
        { text, files },
        {
          body: {
            locationSettings,
            resetDraftContext,
            ...(creationMethod ? { creationMethod } : {}),
          },
        },
      );
    },
    [
      hasRestoredChat,
      creationMethod,
      sendMessage,
      expandAssistant,
      filteredMessages.length,
    ],
  );

  const sendStarter = useCallback(
    (prompt: string, method?: 'chat') => {
      if (isLoading || !hasRestoredChat) {
        return;
      }

      if (method) setCreationMethod(method);

      setIsManualListingFallbackDismissed(false);

      if (isCompactViewport && !isMobileChatViewOpen) {
        openMobileChatView();
      } else {
        expandAssistant();
      }

      const resetDraftContext =
        shouldResetDraftContextRef.current || filteredMessages.length === 0;
      shouldResetDraftContextRef.current = false;

      void sendMessage(
        { text: prompt },
        {
          body: {
            locationSettings,
            resetDraftContext,
            ...((method ?? creationMethod) ? { creationMethod: method ?? creationMethod } : {}),
            ...(method === 'chat' ? { beginDraftWithHamad: true } : {}),
          },
        },
      );
    },
    [
      hasRestoredChat,
      isLoading,
      creationMethod,
      sendMessage,
      expandAssistant,
      isCompactViewport,
      isMobileChatViewOpen,
      openMobileChatView,
      filteredMessages.length,
    ],
  );


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
      autoCategory: boolean;
      title: string;
      description: string;
      price?: number | 'bid' | 'negotiable';
      city: string;
      category: string;
      attributes?: Record<string, unknown>;
    } = {
      autoCategory: false,
      title,
      description,
      city,
      category: manualListingForm.category,
      attributes: { [marketplaceCategoryOptionAttribute]: manualListingForm.categoryOption || null, [marketplaceCarModelAttribute]: manualListingForm.carModel || null },
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
          ...payload.attributes,
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
    const preparedImagesPromise = (
      existingPreparation && existingPreparation.source === manualListingImages
        ? existingPreparation.promise
        : prepareUploadableImageFilesOnDemand(selectedImages)
    ).catch(() => []);

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
            (getArabicCustomerMessage(responsePayload?.message, '') || undefined) ??
            (getArabicCustomerMessage(responsePayload?.error, '') || undefined) ??
            'تعذر حفظ الإعلان اليدوي الآن. حاول مرة أخرى.',
        });
        return;
      }

      const createdListing = responsePayload.listing;
      const preparedImages = await preparedImagesPromise;
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
            (getArabicCustomerMessage(publishPayload?.message, '') || undefined) ??
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
      if (!listing.id) {
        return;
      }

      router.push(`/listings/${listing.id}`);
    },
    [router],
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

  const isCompactChatView = isCompactViewport && isMobileChatViewOpen;
  const loadMoreListings = useCallback(() => {
    if (isCompactChatView || marketplaceListingsScrollRef.current?.clientHeight === 0 ||
        !canLoadMoreListings || isLoadingListings) {
      return;
    }

    setIsLoadingListings(true);
    void refreshMarketplaceListings(undefined, listingPagination.page + 1);
  }, [
    canLoadMoreListings,
    isCompactChatView,
    isLoadingListings,
    listingPagination.page,
    refreshMarketplaceListings,
  ]);

  const listingsLoadMoreRef = useInfiniteScroll({
    enabled: canLoadMoreListings && !isCompactChatView,
    isLoading: isLoadingListings,
    onLoadMore: loadMoreListings,
    rootRef: marketplaceListingsScrollRef,
  });

  const startNewChat = useCallback(() => {
    const previousConversationId = chatImages.snapshot().conversationId;
    void stop();
    setMessages([]);
    setCreationMethod(null);
    chatImages.clear();
    shouldResetDraftContextRef.current = true;
    clearHomeAssistantRuntimeState();
    clearStoredChatState();
    const url = new URL(window.location.href);
    url.searchParams.delete('assistant');
    url.searchParams.delete('listingId');
    window.history.replaceState(null, '', url);
    void clearRetainedListingImages().catch(() => {});
    void resetAssistantDraftContext(previousConversationId, chatOwnerId).catch(() => {});
  }, [chatImages, chatOwnerId, setMessages, stop]);

  const shouldRenderAssistantPanel = !isCompactViewport || isCompactChatView;
  const isAssistantContentVisible =
    !isCompactViewport || isAssistantExpanded || isCompactChatView;
  const shouldRenderAssistantBubble =
    pathname === '/' && isCompactViewport && !isMobileChatViewOpen && assistantBubblePosition;
  const assistantBubbleState = isLoading
    ? 'active'
    : hasAssistantBubbleAttention
      ? 'attention'
      : 'idle';
  const shouldShowManualListingFallback =
    Boolean(error) && assistantIntent === 'create_listing';
  const isManualListingVisible =
    isManualListingOpen ||
    (shouldShowManualListingFallback && !isManualListingFallbackDismissed);

  const getMarketplaceToolsClosedOffset = useCallback(() => {
    const panelHeight = marketplaceToolsPanelRef.current?.offsetHeight ?? 0;
    const categoriesHeight = marketplaceCategoriesRef.current?.offsetHeight ?? 0;
    return -Math.max(0, panelHeight - categoriesHeight);
  }, []);

  useLayoutEffect(() => {
    const categories = marketplaceCategoriesRef.current;
    const panel = marketplaceToolsPanelRef.current;
    if (!categories || !panel) return;

    const updateCategoriesHeight = () => {
      const categoriesHeight = `${categories.offsetHeight}px`;
      panel.style.setProperty(
        '--marketplace-categories-height',
        categoriesHeight,
      );
      const section = panel.closest<HTMLElement>('#suggested-listings');
      section?.style.setProperty('--marketplace-categories-height', categoriesHeight);
      section?.style.setProperty('--marketplace-tools-height', `${panel.offsetHeight}px`);
    };
    updateCategoriesHeight();
    const observer = new ResizeObserver(updateCategoriesHeight);
    observer.observe(categories);
    observer.observe(panel);
    // A confirmed manual drag must not start a native fling that absorbs the next tap.
    const preventNativeToolPan = (event: TouchEvent) => {
      if (marketplaceToolsDragRef.current.axis === 'vertical' &&
          marketplaceToolsDragRef.current.pointerId !== -1 && event.cancelable) {
        event.preventDefault();
      }
    };
    panel.addEventListener('touchmove', preventNativeToolPan, { passive: false });
    return () => {
      observer.disconnect();
      panel.removeEventListener('touchmove', preventNativeToolPan);
    };
  }, [isCompactChatView, isManualListingVisible]);

  useLayoutEffect(() => {
    const target = isManualListingVisible
      ? '0px'
      : isMarketplaceToolsDragging
        ? `calc(var(--marketplace-tools-height, 180px) + ${marketplaceToolsDragOffset}px)`
        : isMarketplaceTopActionsHidden
          ? 'var(--marketplace-categories-height, 40px)'
          : 'var(--marketplace-tools-height, 180px)';
    marketplaceContentOffsetTargetRef.current = target;
    const list = marketplaceListingsScrollRef.current;
    // Align only the beginning; floating tools must not reposition browsed cards.
    if (list && list.scrollTop <= 1) {
      (list.firstElementChild as HTMLElement | null)?.style.setProperty('--marketplace-content-offset', target);
    }
  }, [isManualListingVisible, isMarketplaceToolsDragging, marketplaceToolsDragOffset, isMarketplaceTopActionsHidden]);

  useLayoutEffect(() => {
    const viewport = pendingBrowseViewportRef.current;
    const list = marketplaceListingsScrollRef.current;
    if (!viewport || !list?.clientHeight || !hasRestoredChat || isCompactChatView || isManualListingVisible) return;
    const content = list.firstElementChild as HTMLElement | null;
    if (viewport.contentOffset) content?.style.setProperty('--marketplace-content-offset', viewport.contentOffset);
    // Restoration must bypass the list's smooth-scrolling preference before paint.
    list.scrollTo({ top: viewport.scrollTop, behavior: 'instant' });
    lastMarketplaceScrollTopRef.current = list.scrollTop;
    lastMarketplaceScrollHeightRef.current = list.scrollHeight;
    pendingBrowseViewportRef.current = null;
  }, [hasRestoredChat, isCompactChatView, isManualListingVisible, marketplaceListings]);

  // Capture before React removes the route DOM, including scrolls that did not render state.
  useLayoutEffect(() => () => {
    const list = marketplaceListingsScrollRef.current;
    writeHomeBrowseState({
      searchInput: marketplaceSearchInput, city: activeMarketCity,
      categoryGroup: activeMarketCategoryGroup, subcategory: activeMarketSubcategory, categoryOption: activeMarketCategoryOption, carModel: activeMarketCarModel,
      listings: marketplaceListings, listingsKey: browseListingsKey,
      pagination: listingPagination, nearbyCity: nearbyMarketplaceCity, filterOpen: isMarketFilterOpen,
      viewport: pendingBrowseViewportRef.current ?? {
        scrollTop: list?.scrollTop ?? lastMarketplaceScrollTopRef.current,
        contentOffset: (list?.firstElementChild as HTMLElement | null)?.style
          .getPropertyValue('--marketplace-content-offset') ?? '',
        toolsHidden: isMarketplaceTopActionsHidden,
        categoryWindowStart,
      },
    });
  }, [activeMarketCategoryGroup, activeMarketCity, activeMarketSubcategory, activeMarketCategoryOption, activeMarketCarModel, browseListingsKey, isMarketFilterOpen,
    isMarketplaceTopActionsHidden, categoryWindowStart, listingPagination, marketplaceListings, marketplaceSearchInput, nearbyMarketplaceCity]);

  const cancelMarketplaceTopReveal = useCallback(() => {
    if (marketplaceToolsTopRevealTimerRef.current !== null) {
      clearTimeout(marketplaceToolsTopRevealTimerRef.current);
      marketplaceToolsTopRevealTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => cancelMarketplaceTopReveal,
    [cancelMarketplaceTopReveal, isMobileChatViewOpen],
  );

  const setMarketplaceToolsHidden = useCallback((hidden: boolean) => {
    cancelMarketplaceTopReveal();
    marketplaceScrollReversalDistanceRef.current = 0;
    marketplaceTopActionsHiddenRef.current = hidden;
    setIsMarketplaceToolsDragging(false);
    setMarketplaceToolsDragOffset(0);
    setIsMarketplaceTopActionsHidden(hidden);
  }, [cancelMarketplaceTopReveal]);

  useEffect(() => {
    marketplaceTopActionsHiddenRef.current = isMarketplaceTopActionsHidden;
  }, [isMarketplaceTopActionsHidden]);

  useEffect(() => {
    if (isManualListingVisible) {
      marketplaceScrollIntentRef.current = {
        direction: 0,
        distance: 0,
        lastToggleAt: performance.now(),
      };
      setMarketplaceToolsHidden(false);
    }
  }, [isManualListingVisible, setMarketplaceToolsHidden]);

  const handleMarketplaceListingsScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const nextScrollTop = event.currentTarget.scrollTop;
      if (nextScrollTop <= 1) {
        (event.currentTarget.firstElementChild as HTMLElement | null)?.style.setProperty(
          '--marketplace-content-offset', marketplaceContentOffsetTargetRef.current,
        );
      }
      const nextScrollHeight = event.currentTarget.scrollHeight;
      const previousScrollTop = lastMarketplaceScrollTopRef.current;
      const previousScrollHeight = lastMarketplaceScrollHeightRef.current;
      const scrollDelta = nextScrollTop - previousScrollTop;
      const now = performance.now();
      const didListGrow =
        previousScrollHeight > 0 && nextScrollHeight > previousScrollHeight + 8;

      lastMarketplaceScrollTopRef.current = nextScrollTop;
      lastMarketplaceScrollHeightRef.current = nextScrollHeight;

      if (nextScrollTop > 1) {
        cancelMarketplaceTopReveal();
      }

      if (isMarketplaceToolsDragging || marketplaceToolsDragRef.current.pointerId !== -1) {
        return;
      }

      if (marketplaceToolsPanelRef.current?.querySelector('[aria-expanded="true"]')) {
        return;
      }

      if (isManualListingVisible) {
        marketplaceScrollIntentRef.current = {
          direction: 0,
          distance: 0,
          lastToggleAt: now,
        };
        setMarketplaceToolsHidden(false);
        return;
      }

      if (nextScrollTop <= 1) {
        marketplaceScrollReversalDistanceRef.current = 0;
        marketplaceScrollIntentRef.current = {
          direction: 0,
          distance: 0,
          lastToggleAt: now,
        };
        if (
          marketplaceTopActionsHiddenRef.current &&
          marketplaceToolsTopRevealTimerRef.current === null
        ) {
          marketplaceToolsTopRevealTimerRef.current = setTimeout(() => {
            marketplaceToolsTopRevealTimerRef.current = null;
            const scrollContainer = marketplaceListingsScrollRef.current;
            if (
              scrollContainer?.isConnected &&
              scrollContainer.scrollTop <= 1 &&
              marketplaceToolsDragRef.current.pointerId === -1
            ) {
              marketplaceScrollIntentRef.current = {
                direction: 0,
                distance: 0,
                lastToggleAt: performance.now(),
              };
              setMarketplaceToolsHidden(false);
            }
          }, 120);
        }
        return;
      }

      if (now < marketplaceToolsManualLockUntilRef.current) {
        return;
      }

      if (scrollDelta === 0) {
        return;
      }

      const direction = scrollDelta > 0 ? 1 : -1;
      const toggleCooldown = 120;
      const hideStartTop = 12;
      const hideDistance = 12;
      const showDistance = 8;
      const scrollIntent = marketplaceScrollIntentRef.current;

      if (scrollIntent.direction === 0) {
        scrollIntent.direction = direction;
        scrollIntent.distance = Math.abs(scrollDelta);
      } else if (scrollIntent.direction !== direction) {
        marketplaceScrollReversalDistanceRef.current += Math.abs(scrollDelta);
        // Require a deliberate reversal before changing the accepted direction.
        if (marketplaceScrollReversalDistanceRef.current < 4) {
          return;
        }
        scrollIntent.direction = direction;
        scrollIntent.distance = marketplaceScrollReversalDistanceRef.current;
        marketplaceScrollReversalDistanceRef.current = 0;
      } else {
        scrollIntent.distance = Math.max(
          0,
          scrollIntent.distance - marketplaceScrollReversalDistanceRef.current,
        );
        marketplaceScrollReversalDistanceRef.current = 0;
        scrollIntent.distance += Math.abs(scrollDelta);
      }

      if (now - scrollIntent.lastToggleAt < toggleCooldown) {
        return;
      }

      if (
        direction > 0 &&
        !marketplaceTopActionsHiddenRef.current &&
        nextScrollTop > hideStartTop &&
        scrollIntent.distance >= hideDistance
      ) {
        marketplaceTopActionsHiddenRef.current = true;
        marketplaceScrollIntentRef.current = {
          direction,
          distance: 0,
          lastToggleAt: now,
        };
        setMarketplaceToolsHidden(true);
        return;
      }

      if (
        direction < 0 &&
        marketplaceTopActionsHiddenRef.current &&
        !isLoadingListings &&
        !didListGrow &&
        scrollIntent.distance >= showDistance
      ) {
        marketplaceTopActionsHiddenRef.current = false;
        marketplaceScrollIntentRef.current = {
          direction,
          distance: 0,
          lastToggleAt: now,
        };
        setMarketplaceToolsHidden(false);
      }
    },
    [
      cancelMarketplaceTopReveal,
      isLoadingListings,
      isManualListingVisible,
      isMarketplaceToolsDragging,
      setMarketplaceToolsHidden,
    ],
  );

  const handleMarketplaceToolsPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target;
      if (event.isPrimary && event.button === 0) {
        suppressMarketplaceToolsClickRef.current = false;
      }
      if (
        isManualListingVisible ||
        !event.isPrimary ||
        event.button !== 0 ||
        marketplaceToolsDragRef.current.pointerId !== -1 ||
        !(target instanceof Element) ||
        !event.currentTarget.contains(target) ||
        target.closest(
            'a, input, textarea, select, label, .marketplace-tools-region, [role="listbox"], [role="option"], [role="combobox"], [role="slider"], [role="checkbox"], [role="switch"], [contenteditable]:not([contenteditable="false"])',
          ) ||
        event.currentTarget.querySelector('[aria-expanded="true"]')
      ) {
        return;
      }

      cancelMarketplaceTopReveal();
      const closedOffset = getMarketplaceToolsClosedOffset();
      marketplaceToolsDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOffset: isMarketplaceTopActionsHidden ? closedOffset : 0,
        axis: 'pending',
        wasHidden: isMarketplaceTopActionsHidden,
      };
      // Keep capture on the original target so touch taps still work after a drag.
      target.setPointerCapture(event.pointerId);
    },
    [
      cancelMarketplaceTopReveal,
      getMarketplaceToolsClosedOffset,
      isManualListingVisible,
      isMarketplaceTopActionsHidden,
    ],
  );

  const handleMarketplaceToolsPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = marketplaceToolsDragRef.current;

      if (dragState.pointerId !== event.pointerId) {
        return;
      }

      if (dragState.axis === 'pending') {
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;
        if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          dragState.axis = 'horizontal';
          suppressMarketplaceToolsClickRef.current = true;
        } else if (Math.abs(dy) >= 12 && Math.abs(dy) > Math.abs(dx) * 1.2) {
          // Grab the rendered position, including a transition already in flight.
          const transform = getComputedStyle(event.currentTarget).transform;
          dragState.startOffset = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
          dragState.startY += Math.sign(dy) * 12;
          dragState.axis = 'vertical';
          suppressMarketplaceToolsClickRef.current = true;
          setIsMarketplaceToolsDragging(true);
        }
      }
      if (dragState.axis !== 'vertical') return;

      const closedOffset = getMarketplaceToolsClosedOffset();
      const nextOffset = clampNumber(
        dragState.startOffset + event.clientY - dragState.startY,
        closedOffset,
        0,
      );
      setMarketplaceToolsDragOffset(nextOffset);
      event.preventDefault();
    },
    [getMarketplaceToolsClosedOffset],
  );

  const finishMarketplaceToolsDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const dragState = marketplaceToolsDragRef.current;

      if (dragState.pointerId !== event.pointerId) {
        return;
      }

      marketplaceToolsDragRef.current = { ...dragState, pointerId: -1 };
      if (dragState.axis !== 'vertical') return;

      const closedOffset = getMarketplaceToolsClosedOffset();
      const finalOffset = event.type === 'pointerup'
        ? clampNumber(
            dragState.startOffset + event.clientY - dragState.startY,
            closedOffset,
            0,
          )
        : dragState.startOffset;
      const shouldHide = event.type === 'pointerup'
        ? finalOffset < closedOffset * 0.45
        : dragState.wasHidden;
      const now = performance.now();
      marketplaceToolsManualLockUntilRef.current = now + 2200;
      marketplaceScrollIntentRef.current = {
        direction: 0,
        distance: 0,
        lastToggleAt: now,
      };
      setMarketplaceToolsHidden(shouldHide);

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [
      getMarketplaceToolsClosedOffset,
      setMarketplaceToolsHidden,
    ],
  );

  const marketplaceToolsTransform = isManualListingVisible
    ? 'translate3d(0, 0, 0)'
    : isMarketplaceToolsDragging
      ? `translate3d(0, ${marketplaceToolsDragOffset}px, 0)`
      : isMarketplaceTopActionsHidden
        ? 'translate3d(0, calc(-100% + var(--marketplace-categories-height, 40px)), 0)'
        : 'translate3d(0, 0, 0)';

  const creationOptions = !creationMethod && !isLoading && isRecord(latestAssistantMetadata) && latestAssistantMetadata.creationChoice === true ? (
    <div data-testid="assistant-creation-options" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Button variant="outline" className="h-auto min-h-10 whitespace-normal rounded-md py-2" disabled={!hasRestoredChat} onClick={() => sendStarter('أختار الإنشاء مع حمد.', 'chat')}>
        <MessageCircle className="size-4 shrink-0" />
        الإنشاء مع حمد
      </Button>
      <Button variant="outline" className="h-auto min-h-10 whitespace-normal rounded-md py-2" onClick={() => {
        setIsManualListingOpen(true);
        setIsManualListingFallbackDismissed(false);
        closeMobileChatView();
      }}>
        <Megaphone className="size-4 shrink-0" />
        الإنشاء اليدوي
      </Button>
    </div>
  ) : null;

  return (
    <main
      className={cn(
        'marketplace-shell overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground',
        isCompactChatView && 'h-dvh overflow-hidden',
      )}
      dir="rtl"
    >
      {isManualPublishAgreementOpen && (
        <CommissionAgreementDialog
          mode="publish"
          onCancel={() => setIsManualPublishAgreementOpen(false)}
          onConfirm={confirmManualPublishAgreement}
          open={isManualPublishAgreementOpen}
        />
      )}
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
              <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
                <img
                  alt="سوق حمد"
                  className="size-12 object-cover"
                  decoding="async"
                  fetchPriority="high"
                  height={48}
                  src="/hamad-market-logo.webp"
                  width={48}
                />
              </div>
            </div>

            <div className="hidden h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-muted-foreground shadow-sm md:mx-6 md:flex dark:border-blue-400/20 dark:bg-card">
              <Sparkles className="size-4 text-blue-600" />
              <button className="flex h-full min-w-0 flex-1 items-center truncate text-start text-xs" type="button" onClick={() => sendStarter('كيف أستخدم سوق حمد؟')}>
                اسأل حمد عن المنصة
              </button>
            </div>

            <nav className="hidden items-center gap-1 text-[11px] font-medium text-muted-foreground xl:flex">
              <Link className="inline-flex h-8 items-center rounded-md px-2 hover:bg-accent hover:text-foreground" href="/terms" prefetch={false}>
                الشروط والسياسات
              </Link>
            </nav>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              <ThemeSync />
              {session.authenticated ? (
                <Button asChild variant="outline" size="sm" className="rounded-md px-2 sm:px-3">
                  <Link href="/account" onClick={closeAssistantForNavigation} prefetch={false}>
                    <User className="size-4" />
                    <span className="hidden sm:inline">حسابي</span>
                  </Link>
                </Button>
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
            <section
              className={cn(
                'relative min-h-0 min-w-0 flex-col overflow-hidden border-b bg-white/45 p-2 [--marketplace-list-edge:0.5rem] dark:bg-background/55 sm:p-3 sm:[--marketplace-list-edge:0.75rem] lg:border-b-0 lg:border-l lg:p-4 lg:[--marketplace-list-edge:1rem] lg:[--marketplace-tools-top:1rem]',
                isCompactChatView ? 'hidden' : 'flex',
              )}
              inert={isCompactChatView}
              aria-hidden={isCompactChatView || undefined}
              id="suggested-listings"
              onPointerDown={collapseAssistantFromPage}
            >
              <div className={isManualListingVisible
                ? 'contents'
                : 'marketplace-tools-viewport pointer-events-none absolute inset-x-2 bottom-0 top-2 z-20 sm:inset-x-3 lg:inset-x-4 lg:top-4'}>
              <div className={cn(
                'marketplace-home-controls shrink-0 rounded-md border border-blue-100/70 bg-white shadow-sm dark:border-blue-400/10 dark:bg-card',
                isManualListingVisible
                  ? 'max-h-[min(58dvh,34rem)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
                  : cn(
                      'pointer-events-auto relative overflow-visible border-b-0 pb-0 will-change-transform',
                      isMarketplaceToolsDragging
                        ? 'transition-none'
                        : 'transition-transform duration-[1050ms] ease-[cubic-bezier(0.16,0.86,0.22,1)]',
                    ),
              )}
              ref={marketplaceToolsPanelRef}
              data-floating-tools={!isManualListingVisible || undefined}
              data-no-pull-refresh={!isManualListingVisible || undefined}
              aria-label="أدوات السوق"
              role="region"
              tabIndex={isManualListingVisible ? undefined : 0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || isManualListingVisible) return;
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                marketplaceToolsManualLockUntilRef.current = performance.now() + 2200;
                setMarketplaceToolsHidden(event.key === 'ArrowUp');
              }}
              onPointerDown={handleMarketplaceToolsPointerDown}
              onClickCapture={(event) => {
                if (!event.currentTarget.contains(event.target as Node)) return;
                if (event.detail > 0 && suppressMarketplaceToolsClickRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                  suppressMarketplaceToolsClickRef.current = false;
                }
              }}
              onPointerMove={handleMarketplaceToolsPointerMove}
              onPointerUp={finishMarketplaceToolsDrag}
              onPointerCancel={finishMarketplaceToolsDrag}
              onLostPointerCapture={finishMarketplaceToolsDrag}
              style={
                isManualListingVisible
                  ? undefined
                  : ({
                      transform: marketplaceToolsTransform,
                      touchAction: 'pan-x pinch-zoom',
                    } as CSSProperties)
              }
              >
              <div
                className="marketplace-tools-collapsible grid gap-1 p-1"
                inert={isMarketplaceTopActionsHidden && !isMarketplaceToolsDragging && !isManualListingVisible}
              >
              <div
                className={cn(
                  'pointer-events-auto grid gap-1.5 text-center md:justify-end md:text-right',
                  'translate-y-0 opacity-100',
                )}
              >
                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:justify-end">
                  <Button className="marketplace-primary-cta h-auto min-h-9 min-w-0 gap-1 rounded-md bg-blue-600 px-2 py-1 text-sm hover:bg-blue-700 sm:px-3" onClick={() => sendStarter('أريد إنشاء مسودة إعلان مع حمد', 'chat')}>
                  <Megaphone className="size-4" />
                  <span className="min-w-0 whitespace-normal leading-5">أنشئ إعلانك مع حمد</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-9 min-w-0 gap-1 rounded-md px-2 py-1 text-sm transition duration-150 active:scale-[0.98] sm:px-3"
                    onClick={() => {
                      setIsManualListingOpen((value) => !value);
                      setIsManualListingFallbackDismissed(false);
                      setManualListingNotice(null);
                    }}
                  >
                    <Megaphone className="size-4" />
                    <span className="min-w-0 whitespace-normal leading-5">أنشئ إعلانك يدويًا</span>
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
                  <div className="grid gap-2 sm:grid-cols-2">
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
                            categoryOption: '',
                            carModel: '',
                            autoCategory: false,
                          }))
                        }
                      >
                        {manualListingCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {formatCategory(category)}
                          </option>
                        ))}
                      </select>
                      {manualListingForm.autoCategory &&
                        (manualCategoryStatus === 'uncertain' || manualCategoryStatus === 'unavailable') && (
                          <span className="text-xs font-normal text-muted-foreground" role="status">
                            أدخل التصنيف
                          </span>
                        )}
                    </label>
                    <CategoryOptionSelect id="manual-listing-category-option" category={manualListingForm.category} value={manualListingForm.categoryOption}
                      onChange={categoryOption => setManualListingForm(form => ({ ...form, categoryOption, carModel: '', autoCategory: false }))}
                      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500" />
                    <CarModelSelect id="manual-listing-car-model" category={manualListingForm.category} brand={manualListingForm.categoryOption} value={manualListingForm.carModel}
                      onChange={carModel => setManualListingForm(form => ({ ...form, carModel, autoCategory: false }))}
                      className="h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus:border-blue-500" />
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
                    {manualListingPreviewUrl && createPortal(
                      <div
                        aria-modal="true"
                        className="viewport-overlay fixed inset-0 z-[90] grid place-items-center bg-slate-950/82 p-4 backdrop-blur-md [--overlay-content-height-limit:88dvh]"
                        ref={manualPreviewViewportRef}
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
                      </div>,
                      document.body,
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

              <div className="grid gap-1">
                <div className="marketplace-filter-panel marketplace-tools-fields">
                  <label className="marketplace-tools-search flex h-9 min-w-0 items-center gap-1 rounded-md border bg-background px-2 text-sm">
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
                        className="size-6 shrink-0 rounded-md"
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
                    allLabel="المنطقة"
                    className="marketplace-tools-region [&>button]:h-9 [&>button]:gap-1 [&>button]:px-2 [&>button>svg:first-child]:hidden [&>div]:left-0 [&>div]:right-auto [&>div]:w-64"
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
                    aria-label="موقعي"
                    className="marketplace-tools-nearby size-9 rounded-md p-0"
                    disabled={isLocatingNearbyListings}
                    onClick={handleNearbyMarketplaceSearch}
                    title={'موقعي يحتاج إذن الموقع الجغرافي'}
                  >
                    {isLocatingNearbyListings ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <MapPin className="size-4" />
                    )}
                    <span className="sr-only">موقعي</span>
                  </Button>
                  <Button
                    type="button"
                    variant={isMarketFilterOpen ? 'default' : 'outline'}
                    aria-label={activeMarketFilterCount > 0 ? `تصفية البحث، ${activeMarketFilterCount} خيارات مفعلة` : 'تصفية البحث'}
                    className="marketplace-tools-filter relative size-9 rounded-md p-0"
                    title="تصفية البحث"
                    onClick={() => setIsMarketFilterOpen((value) => !value)}
                  >
                    <SlidersHorizontal className="size-4" />
                    <span className="sr-only">{'تصفية البحث'}</span>
                    {activeMarketFilterCount > 0 && (
                      <span className="pointer-events-none absolute -left-1 -top-1 grid size-4 place-items-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 dark:bg-blue-400/20 dark:text-blue-100">
                        {activeMarketFilterCount}
                      </span>
                    )}
                  </Button>
                </div>

                <FloatingActionNotice
                  message={nearbyMarketplaceNotice}
                  open={Boolean(nearbyMarketplaceNotice) && !isLocatingNearbyListings}
                  onDismiss={() => setNearbyMarketplaceNotice('')}
                  durationMs={0}
                  tone={nearbyMarketplaceNotice.startsWith('تم') ? 'success' : 'info'}
                />
                {nearbyMarketplaceNotice && isLocatingNearbyListings && (
                  <div className="rounded-md border border-blue-200 bg-blue-50/80 px-3 py-2 text-right text-xs font-medium text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
                    {nearbyMarketplaceNotice}
                  </div>
                )}

                {isMarketFilterOpen && hasManualMarketFilters && (
                  <div className="flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-md px-2 text-blue-700 hover:text-blue-800 dark:text-blue-100"
                        onClick={() => {
                          setSelectedMarketCategoryGroup('all');
                          setSelectedMarketSubcategory('all');
                          setSelectedMarketCategoryOption('');
                          setSelectedMarketCarModel('');
                          setCategoryWindowStart(0);
                          setSelectedMarketCity('all');
                          setNearbyMarketplaceCity(null);
                          setNearbyMarketplaceNotice('');
                        }}
                      >
                        <X className="size-3.5" />
                        مسح الفلاتر
                      </Button>
                  </div>
                )}
              </div>
              </div>
              <div className="grid gap-1 p-1" ref={marketplaceCategoriesRef} data-marketplace-categories>
                <MarketplaceFilterRows category={activeMarketCategoryId} brand={activeMarketCategoryOption}
                  start={categoryWindowStart} onStartChange={setCategoryWindowStart} rows={[
                  { level: 'groups', label: 'تصنيفات السوق', value: activeMarketCategoryGroup,
                    options: marketplaceCategoryGroups.map(group => ({ id: group.label, label: group.label })),
                    onChange: value => {
                      if (value === activeMarketCategoryGroup) return;
                      setSelectedMarketCategoryGroup(value);
                      setSelectedMarketSubcategory('all');
                      setSelectedMarketCategoryOption('');
                      setSelectedMarketCarModel('');
                    } },
                  { level: 'categories', scope: activeMarketCategoryGroup, label: 'التصنيفات الفرعية', compact: true, value: activeMarketSubcategory,
                    options: activeMarketCategoryGroupConfig?.categories.map(category => ({ id: category, label: category })) ?? [],
                    onChange: value => {
                      if (value === activeMarketSubcategory) return;
                      setSelectedMarketSubcategory(value); setSelectedMarketCategoryOption(''); setSelectedMarketCarModel('');
                    } },
                  { level: 'options', scope: activeMarketCategoryId, label: 'تفريعات التصنيف', compact: true, value: activeMarketCategoryOption,
                    onChange: value => {
                      if (value === activeMarketCategoryOption) return;
                      setSelectedMarketCategoryOption(value); setSelectedMarketCarModel('');
                    } },
                  { level: 'models', scope: activeMarketCategoryOption, label: 'تفريعات الخيار', compact: true, value: activeMarketCarModel,
                    onChange: setSelectedMarketCarModel },
                ]} />
              </div>
              </div>
              </div>
              <div
                ref={marketplaceListingsScrollRef}
                onScroll={handleMarketplaceListingsScroll}
                data-floating-list={!isManualListingVisible || undefined}
                data-tools-dragging={isMarketplaceToolsDragging || undefined}
                className={cn(
                  'marketplace-listings-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3',
                )}
              >
              <div className="marketplace-listings-content pb-[var(--marketplace-bottom-nav-space)] lg:pb-1">

              {hasMarketplaceSearchQuery && (
                <div className="marketplace-section-title mb-3 flex items-center justify-end gap-3">
                  <div className="flex items-center gap-2 text-base font-bold">
                    <Sparkles className="size-4 text-blue-600" />
                    نتائج البحث
                  </div>
                </div>
              )}

              <div className="grid max-w-4xl gap-1.5">
                {exploreMarketplaceListings.map((listing, index) => (
                  <ListingCardView
                    key={listing.id ?? listing.title}
                    className={cn(
                      'marketplace-listing-card-enter',
                      index < 4 && 'marketplace-listing-card-critical',
                    )}
                    listing={listing}
                    onOpen={openListing}
                    eagerImage={index < 4}
                    prioritizeImage={index === 0}
                    style={{
                      animationDelay: `${Math.min(index % 24, 6) * 35}ms`,
                    }}
                    variant="horizontal"
                  />
                ))}
                {isLoadingListings &&
                  <ListingCardSkeleton
                    count={exploreMarketplaceListings.length > 0 ? 3 : 6}
                  />}
              </div>

              {canLoadMoreListings && (
                <div className="mt-2">
                  <div
                    ref={listingsLoadMoreRef}
                    aria-hidden="true"
                    className="h-24 w-full"
                  />
                </div>
              )}

              {!isLoadingListings && exploreMarketplaceListings.length === 0 && (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed bg-white p-6 text-center dark:bg-card">
                  <div className="grid max-w-sm gap-3">
                    <Sparkles className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد إعلانات متاحة</h3>
                  </div>
                </div>
              )}

              </div>
              </div>
            </section>

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
                      <div data-testid="assistant-empty-state" className="grid h-full place-items-center text-center">
                        <div className="grid max-w-xs gap-4">
                          <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-100 text-blue-700">
                            <MessageCircle className="size-7" />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold">كيف أساعدك؟</h3>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {filteredMessages.map((message, messageIndex) => {
                          if (message.role === 'assistant' && !hasVisibleAssistantContent(message)) return null;
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
                                    {renderMessageParts(message.parts, chatListingCardsById, true)}
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
                        {creationOptions}
                        {showAssistantThinking && (
                          <Message from="assistant" data-testid="assistant-thinking">
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
