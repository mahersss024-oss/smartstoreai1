'use client';
/* eslint-disable @next/next/no-img-element */

import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DefaultChatTransport, type FileUIPart, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Bell,
  Bot,
  Heart,
  ImageIcon,
  LogOut,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Sparkles,
  Store,
  User,
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
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@chat-elements/prompt-input';
import { SearchStatusIndicator } from '@/components/search-status-indicator';
import {
  chatServiceUnavailableMessage,
  isRawServiceErrorResponse,
} from '@/lib/chat-response-safety';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';

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
const locationSettings: LocationSettings = {
  country: 'SA',
  currency: 'SAR',
  language: 'ar',
};
const currentChatStorageKey = 'smartstore-current-chat-v1';
const retainedListingImagesDatabaseName = 'smartstore-listing-images-v1';
const retainedListingImagesStoreName = 'listing-images';
const retainedListingImagesRecordKey = 'latest';
const maxStoredChatMessages = 60;
const storedChatMaxAgeMs = 1000 * 60 * 60 * 24 * 14;
const assistantDragThreshold = 60;

type StoredChatState = {
  activeListingQuery: string;
  selectedListingContext?: SelectedListingContext | null;
  messages: UIMessage[];
  updatedAt: number;
};

type StoredListingImagesState = {
  id: string;
  images: RetainedListingImage[];
  updatedAt: number;
};

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

function getStoredAttachmentLabel(part: UIMessage['parts'][number]) {
  const filename =
    'filename' in part && typeof part.filename === 'string'
      ? part.filename
      : '';
  const mediaType =
    'mediaType' in part && typeof part.mediaType === 'string'
      ? part.mediaType
      : '';

  if (mediaType.startsWith('image/')) {
    return filename
      ? `صورة مرفقة محفوظة في السجل: ${filename}`
      : 'صورة مرفقة محفوظة في السجل';
  }

  return filename
    ? `ملف مرفق محفوظ في السجل: ${filename}`
    : 'ملف مرفق محفوظ في السجل';
}

function sanitizeMessagesForStorage(messages: UIMessage[]) {
  return messages
    .filter((message) => message.role !== 'system')
    .slice(-maxStoredChatMessages)
    .map((message) => ({
      ...message,
      parts: message.parts.flatMap((part) => {
        if (part.type === 'file') {
          return [
            {
              type: 'text',
              text: getStoredAttachmentLabel(part),
            } satisfies UIMessage['parts'][number],
          ];
        }

        return [part];
      }),
    }));
}

function compactMessagesForStorage(messages: UIMessage[]) {
  return sanitizeMessagesForStorage(messages).map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type === 'text'),
  }));
}

function readStoredChatState(): StoredChatState | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawState = localStorage.getItem(currentChatStorageKey);

    if (!rawState) {
      return null;
    }

    const parsed = JSON.parse(rawState) as Partial<StoredChatState>;

    if (
      typeof parsed.updatedAt !== 'number' ||
      Date.now() - parsed.updatedAt > storedChatMaxAgeMs ||
      !Array.isArray(parsed.messages)
    ) {
      localStorage.removeItem(currentChatStorageKey);
      return null;
    }

    return {
      activeListingQuery:
        typeof parsed.activeListingQuery === 'string'
          ? parsed.activeListingQuery
          : '',
      selectedListingContext:
        parsed.selectedListingContext &&
        typeof parsed.selectedListingContext === 'object'
          ? parsed.selectedListingContext
          : null,
      messages: sanitizeMessagesForStorage(parsed.messages),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    localStorage.removeItem(currentChatStorageKey);
    return null;
  }
}

function writeStoredChatState(
  messages: UIMessage[],
  activeListingQuery: string,
  selectedListingContext: SelectedListingContext | null,
) {
  if (typeof window === 'undefined') {
    return;
  }

  if (messages.length === 0) {
    localStorage.removeItem(currentChatStorageKey);
    return;
  }

  const state: StoredChatState = {
    activeListingQuery,
    selectedListingContext,
    messages: sanitizeMessagesForStorage(messages),
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(currentChatStorageKey, JSON.stringify(state));
  } catch {
    localStorage.setItem(
      currentChatStorageKey,
      JSON.stringify({
        ...state,
        messages: compactMessagesForStorage(messages),
      }),
    );
  }
}

function clearStoredChatState() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(currentChatStorageKey);
  }
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
  const database = await openRetainedListingImagesDatabase();

  return new Promise<RetainedListingImage[]>((resolve, reject) => {
    const transaction = database.transaction(
      retainedListingImagesStoreName,
      'readonly',
    );
    const store = transaction.objectStore(retainedListingImagesStoreName);
    const request = store.get(retainedListingImagesRecordKey);

    request.onsuccess = () => {
      const record = request.result as StoredListingImagesState | undefined;

      if (
        !record ||
        Date.now() - record.updatedAt > storedChatMaxAgeMs ||
        !Array.isArray(record.images)
      ) {
        resolve([]);
        return;
      }

      resolve(record.images.filter(isRetainableListingImage).slice(0, 8));
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function writeRetainedListingImages(images: RetainedListingImage[]) {
  const database = await openRetainedListingImagesDatabase();

  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      retainedListingImagesStoreName,
      'readwrite',
    );
    const store = transaction.objectStore(retainedListingImagesStoreName);

    store.put({
      id: retainedListingImagesRecordKey,
      images: images.slice(0, 8),
      updatedAt: Date.now(),
    } satisfies StoredListingImagesState);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
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
      <Button asChild className="h-9 w-full rounded-md bg-white text-[#1f1f1f] hover:bg-white/90">
        <a href="/api/auth/google/start">
          <span className="grid size-5 place-items-center rounded-full border text-sm font-bold text-blue-600">
            G
          </span>
          المتابعة باستخدام Google
        </a>
      </Button>
    </div>
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
  onAsk,
  onFavorite,
  onOpen,
}: {
  listing: ListingCard;
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
        <Button
          size="icon-sm"
          variant="ghost"
          className="absolute left-1.5 top-1.5 size-7 rounded-md border border-white/80 bg-white/95 text-blue-600 shadow-sm ring-1 ring-slate-950/5 hover:bg-white hover:text-blue-700 dark:border-white/20 dark:bg-slate-950/85 dark:text-blue-200 dark:ring-white/10 dark:hover:bg-slate-900 dark:hover:text-blue-100 sm:left-2 sm:top-2 sm:size-8"
          aria-label="حفظ الإعلان"
          onClick={(event) => {
            event.stopPropagation();
            onFavorite(listing);
          }}
        >
          <Heart className="size-3.5 sm:size-4" />
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
      <div className="mt-1 grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 text-blue-700">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1 text-right">{children}</div>
    </div>
  );
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
    useState<AssistantState>('expanded');
  const retainedListingImagesRef = useRef<RetainedListingImage[]>([]);
  const lastSyncedAssistantMessageIdRef = useRef<string | null>(null);
  const assistantDragStartYRef = useRef<number | null>(null);
  const [, setClientIntent] = useState<ClientIntentState>(defaultClientIntent);

  const filteredMessages = useMemo(
    () => messages.filter((message) => message.role !== 'system'),
    [messages],
  );
  const isLoading = status === 'streaming' || status === 'submitted';
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
  const displayedMarketplaceListings = useMemo(() => {
    if (latestSearchToolOutput) {
      return (latestSearchToolOutput.listings as ApiListingRecord[]).map(
        listingRecordToCard,
      );
    }

    return marketplaceListings;
  }, [latestSearchToolOutput, marketplaceListings]);
  const canLoadMoreListings =
    !latestSearchToolOutput &&
    listingPagination.hasMore &&
    displayedMarketplaceListings.length > 0;
  const isAssistantExpanded = assistantState === 'expanded';

  const collapseAssistant = useCallback(() => {
    setAssistantState('collapsed');
  }, []);

  const expandAssistant = useCallback(() => {
    setAssistantState('expanded');
  }, []);

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

  const refreshMarketplaceListings = useCallback((query?: string, page = 1) => {
    const params = new URLSearchParams();

    if (query?.trim()) {
      params.set('q', query.trim());
    }

    params.set('page', String(page));
    params.set('limit', '24');

    const endpoint = `/api/marketplace/listings?${params.toString()}`;

    return fetch(endpoint)
      .then((response) =>
        response.json() as Promise<ListingsResponsePayload>,
      )
      .then((payload) => {
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
      .catch(() => {
        if (page <= 1) {
          setMarketplaceListings(featuredListings);
        }
        setListingPagination({ page: 1, hasMore: false });
      })
      .finally(() => {
        setIsLoadingListings(false);
      });
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
    const storedState = readStoredChatState();

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      if (storedState) {
        setMessages(storedState.messages);
        setActiveListingQuery(storedState.activeListingQuery);
        setSelectedListingContext(storedState.selectedListingContext ?? null);
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

    writeStoredChatState(
      filteredMessages,
      activeListingQuery,
      selectedListingContext,
    );
  }, [
    activeListingQuery,
    filteredMessages,
    hasRestoredChat,
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
    let mounted = true;

    void fetch('/api/auth/session')
      .then((response) => response.json() as Promise<AuthSessionPayload>)
      .then((payload) => {
        if (mounted) {
          setSession(payload);
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
  }, []);

  useEffect(() => {
    void refreshMarketplaceListings();
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
    void refreshMarketplaceListings(activeListingQuery);
  }, [
    activeListingQuery,
    filteredMessages,
    latestSearchToolOutput,
    refreshMarketplaceListings,
    status,
  ]);

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

      const nextListingQuery = getNextListingQuery(
        text,
        activeListingQuery,
        intent,
      );

      if (nextListingQuery) {
        setActiveListingQuery(nextListingQuery);
        void refreshMarketplaceListings(nextListingQuery);
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
            selectedListing: selectedListingContext,
          },
        },
      );
    },
    [
      activeListingQuery,
      hasRestoredChat,
      refreshMarketplaceListings,
      selectedListingContext,
      sendMessage,
      expandAssistant,
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

      const nextListingQuery = getNextListingQuery(
        prompt,
        activeListingQuery,
        intent,
      );

      if (nextListingQuery) {
        setActiveListingQuery(nextListingQuery);
        void refreshMarketplaceListings(nextListingQuery);
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
            selectedListing: nextSelectedListingContext,
          },
        },
      );
    },
    [
      activeListingQuery,
      hasRestoredChat,
      isLoading,
      refreshMarketplaceListings,
      selectedListingContext,
      sendMessage,
      expandAssistant,
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

      void fetch(`/api/marketplace/listings/${listing.id}/favorite`, {
        method: 'POST',
      }).then((response) => {
        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (response.ok) {
          void refreshMarketplaceListings(activeListingQuery);
        }
      });
    },
    [activeListingQuery, refreshMarketplaceListings, router],
  );

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      setSession({ authenticated: false, user: null });
    });
  }, []);

  const loadMoreListings = useCallback(() => {
    if (!canLoadMoreListings || isLoadingListings) {
      return;
    }

    setIsLoadingListings(true);
    void refreshMarketplaceListings(
      activeListingQuery,
      listingPagination.page + 1,
    );
  }, [
    activeListingQuery,
    canLoadMoreListings,
    isLoadingListings,
    listingPagination.page,
    refreshMarketplaceListings,
  ]);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveListingQuery('');
    setSelectedListingContext(null);
    retainedListingImagesRef.current = [];
    clearStoredChatState();
    void clearRetainedListingImages().catch(() => {});
  }, [setMessages]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground lg:h-dvh lg:overflow-hidden" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-3 px-3 py-3 sm:px-6 lg:h-full lg:min-h-0">
        <section className="flex min-h-0 flex-col rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card lg:overflow-hidden">
          <header className="flex h-14 items-center justify-between border-b bg-[#f7f9fc] px-4 dark:bg-background">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
                <img alt="SmartStore AI" className="size-8 object-cover" src="/smartstore-mark.png" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-bold">SmartStore AI</h1>
                <p className="truncate text-[11px] text-muted-foreground">سوق ذكي للتسويق للمنتجات</p>
              </div>
            </div>

            <div className="hidden h-9 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-blue-200 bg-white px-3 text-muted-foreground shadow-sm md:mx-6 md:flex dark:border-blue-400/20 dark:bg-card">
              <Sparkles className="size-4 text-blue-600" />
              <button className="min-w-0 truncate text-start text-xs" type="button" onClick={() => sendStarter('أبحث عن منتج بمساعدة الذكاء الاصطناعي')}>
                اسأل مساعد SmartStore AI عن المنتج الذي تبحث عنه
              </button>
            </div>

            <nav className="hidden items-center gap-1 text-[11px] font-medium text-muted-foreground xl:flex">
              <Link className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground" href="/terms">
                الشروط
              </Link>
              <Link className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground" href="/listing-policy">
                سياسة الإعلانات
              </Link>
              <Link className="rounded-md px-2 py-1.5 hover:bg-accent hover:text-foreground" href="/commission-policy">
                العمولة
              </Link>
            </nav>

            <div className="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="الإشعارات">
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
                <Button asChild size="sm" className="rounded-md bg-blue-600 hover:bg-blue-700">
                  <a href="/api/auth/google/start">
                    <User className="size-4" />
                    دخول
                  </a>
                </Button>
              )}
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_25rem] lg:overflow-hidden">
            <section
              className={`min-w-0 border-b bg-[#eef4fb] p-3 dark:bg-background sm:p-4 lg:overflow-y-auto lg:border-b-0 lg:border-l lg:pb-4 ${
                isAssistantExpanded
                  ? 'pb-[calc(70dvh+6rem)] sm:pb-[calc(70dvh+6rem)]'
                  : 'pb-[calc(15rem+env(safe-area-inset-bottom))] sm:pb-[calc(15rem+env(safe-area-inset-bottom))]'
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

              <div className="mb-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-1 rounded-md px-1 text-sm font-semibold text-blue-700 dark:text-blue-300"
                  onClick={() => {
                    collapseAssistant();
                    loadMoreListings();
                  }}
                >
                  عرض الكل
                </button>
                <div className="flex items-center gap-2 text-base font-bold">
                  <Sparkles className="size-4 text-blue-600" />
                  الإعلانات المقترحة
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10.25rem,11.5rem))] sm:justify-start">
                {displayedMarketplaceListings.map((listing) => (
                  <ListingCardView
                    key={listing.id ?? listing.title}
                    listing={listing}
                    onAsk={sendStarter}
                    onFavorite={favoriteListing}
                    onOpen={openListing}
                  />
                ))}
              </div>

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

              {displayedMarketplaceListings.length === 0 && (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed bg-white p-6 text-center dark:bg-card">
                  <div className="grid max-w-sm gap-3">
                    <Sparkles className="mx-auto size-9 text-blue-600" />
                    <h3 className="text-base font-bold">لا توجد نتائج مطابقة</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      اكتب طلبًا آخر في مساعد SmartStore AI.
                    </p>
                  </div>
                </div>
              )}

            </section>

            <section
              className={`fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex h-[68dvh] min-h-[26rem] max-h-[42rem] transform-gpu flex-col overflow-hidden rounded-t-[24px] border bg-white shadow-2xl shadow-slate-950/20 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] dark:bg-card lg:static lg:h-auto lg:max-h-none lg:min-h-0 lg:translate-y-0 lg:rounded-none lg:border-0 lg:shadow-none ${
                isAssistantExpanded
                  ? 'translate-y-0'
                  : 'translate-y-[calc(100%-10.25rem)]'
              }`}
              onPointerDown={handleAssistantDragStart}
              onPointerUp={handleAssistantDragEnd}
              onTouchEnd={handleAssistantTouchEnd}
              onTouchStart={handleAssistantTouchStart}
            >
              <header className="shrink-0 border-b px-4 py-3">
                <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600 lg:hidden" />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-8 place-items-center overflow-hidden rounded-full bg-blue-100 text-blue-700">
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
                        {error && (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error.message}
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
                onFocus={expandAssistant}
                onPointerDown={(event) => {
                  if (!isAssistantExpanded) {
                    event.stopPropagation();
                    expandAssistant();
                  }
                }}
              >
                <PromptInput
                  accept="image/jpeg,image/png,image/webp"
                  allowAttachments
                  maxFileSize={12 * 1024 * 1024}
                  maxFiles={8}
                  multiple
                  onSubmit={handleSubmit}
                >
                  <PromptInputHeader>
                    <PromptInputAttachments>
                      {(attachment) => <PromptInputAttachment data={attachment} />}
                    </PromptInputAttachments>
                  </PromptInputHeader>
                  <PromptInputBody>
                    <PromptInputTextarea className="max-h-28 min-h-12" placeholder="اكتب طلبك أو أرفق صور المنتج..." />
                  </PromptInputBody>
                  <PromptInputFooter>
                    <PromptInputTools>
                      <PromptInputActionMenu>
                        <PromptInputActionMenuTrigger aria-label="إرفاق صورة" />
                        <PromptInputActionMenuContent>
                          <PromptInputActionAddAttachments label="إرفاق صور المنتج" />
                        </PromptInputActionMenuContent>
                      </PromptInputActionMenu>
                    </PromptInputTools>
                    <PromptInputSubmit status={status} />
                  </PromptInputFooter>
                </PromptInput>
              </div>
            </section>
          </div>
        </section>

      </div>
    </main>
  );
}
