'use client';
/* eslint-disable @next/next/no-img-element */

import {
  type ReactNode,
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
  image: string;
  category?: string;
  status?: string;
  stats?: string;
  description?: string;
};

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

type StoredChatState = {
  activeListingQuery: string;
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

function getFallbackImage(category: string, index = 0) {
  const images = {
    mobile_phones:
      'https://images.unsplash.com/photo-1678685888221-cda773a3dcdb?auto=format&fit=crop&w=900&q=80',
    cars:
      'https://images.unsplash.com/photo-1550355291-bbee04a92027?auto=format&fit=crop&w=900&q=80',
    computers:
      'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=900&q=80',
    furniture:
      'https://images.unsplash.com/photo-1503602642458-232111445657?auto=format&fit=crop&w=900&q=80',
    real_estate:
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=900&q=80',
    auto_parts:
      'https://images.unsplash.com/photo-1632823469850-1b7b1e8b7e1e?auto=format&fit=crop&w=900&q=80',
    fashion:
      'https://images.unsplash.com/photo-1445205170230-053b83016050?auto=format&fit=crop&w=900&q=80',
    home_garden:
      'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80',
    sports:
      'https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=900&q=80',
    gaming_hobbies:
      'https://images.unsplash.com/photo-1612287230202-1ff1d85d1bdf?auto=format&fit=crop&w=900&q=80',
    books_education:
      'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=900&q=80',
    kids:
      'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80',
    tools_equipment:
      'https://images.unsplash.com/photo-1581147036324-c1c88bb0b379?auto=format&fit=crop&w=900&q=80',
    watches_accessories:
      'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=900&q=80',
    beauty:
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=900&q=80',
  } satisfies Record<string, string>;
  const values = Object.values(images);

  return images[category as keyof typeof images] ?? values[index % values.length];
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
      messages: sanitizeMessagesForStorage(parsed.messages),
      updatedAt: parsed.updatedAt,
    };
  } catch {
    localStorage.removeItem(currentChatStorageKey);
    return null;
  }
}

function writeStoredChatState(messages: UIMessage[], activeListingQuery: string) {
  if (typeof window === 'undefined') {
    return;
  }

  if (messages.length === 0) {
    localStorage.removeItem(currentChatStorageKey);
    return;
  }

  const state: StoredChatState = {
    activeListingQuery,
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

function isSearchToolOutput(value: unknown): value is SearchToolOutput {
  return (
    isRecord(value) &&
    value.status === 'searched' &&
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
    }
  }

  return null;
}

function listingRecordToCard(listing: ApiListingRecord, index: number): ListingCard {
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
      listing.image ??
      primaryImage?.thumbnailUrl ??
      primaryImage?.displayUrl ??
      primaryImage?.originalUrl ??
      getFallbackImage(listing.category, index),
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
  onAsk: (prompt: string) => void;
  onFavorite: (listing: ListingCard) => void;
  onOpen: (listing: ListingCard) => void;
}) {
  return (
    <article
      className="cursor-pointer overflow-hidden rounded-md border bg-white shadow-sm transition hover:border-blue-400 hover:shadow-md focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 dark:bg-card"
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
      <div className="relative aspect-square bg-slate-100">
        <img alt={listing.title} className="h-full w-full object-cover" src={listing.image} />
        <Button
          size="icon-sm"
          variant="ghost"
          className="absolute left-2 top-2 rounded-md border border-white/80 bg-white/95 text-blue-600 shadow-sm ring-1 ring-slate-950/5 hover:bg-white hover:text-blue-700 dark:border-white/20 dark:bg-slate-950/85 dark:text-blue-200 dark:ring-white/10 dark:hover:bg-slate-900 dark:hover:text-blue-100"
          aria-label="حفظ الإعلان"
          onClick={(event) => {
            event.stopPropagation();
            onFavorite(listing);
          }}
        >
          <Heart className="size-4" />
        </Button>
      </div>
      <div className="grid gap-2 p-2.5 text-right">
        <h3 className="line-clamp-1 text-xs font-bold">{listing.title}</h3>
        <div className="text-sm font-bold text-slate-950 dark:text-card-foreground">{listing.price}</div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin className="size-3" />
          {listing.city}
        </div>
        {listing.description && (
          <p className="line-clamp-1 text-[11px] leading-5 text-muted-foreground">
            {listing.description}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
            <BadgeCheck className="size-3" />
            {listing.status ?? 'موثق'}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">{listing.stats}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-1.5 border-t pt-2">
          <Button
            size="sm"
            className="h-8 rounded-md bg-blue-600 text-xs hover:bg-blue-700"
            onClick={(event) => {
              event.stopPropagation();
              onAsk(`أريد التواصل بخصوص ${listing.title}`);
            }}
          >
            <MessageCircle className="size-3.5" />
            تواصل
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            className="rounded-md"
            aria-label="مقارنة الإعلان"
            onClick={(event) => {
              event.stopPropagation();
              onAsk(`قارن لي إعلان ${listing.title} بالسوق`);
            }}
          >
            <Sparkles className="size-3.5" />
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
  const [activeListingQuery, setActiveListingQuery] = useState('');
  const [hasRestoredChat, setHasRestoredChat] = useState(false);
  const retainedListingImagesRef = useRef<RetainedListingImage[]>([]);
  const lastSyncedAssistantMessageIdRef = useRef<string | null>(null);
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

  const refreshMarketplaceListings = useCallback((query?: string) => {
    const params = new URLSearchParams();

    if (query?.trim()) {
      params.set('q', query.trim());
    }

    const endpoint = params.size
      ? `/api/marketplace/listings?${params.toString()}`
      : '/api/marketplace/listings';

    return fetch(endpoint)
      .then((response) =>
        response.json() as Promise<{ listings?: ApiListingRecord[] }>,
      )
      .then((payload) => {
        if (payload.listings) {
          setMarketplaceListings(payload.listings.map(listingRecordToCard));
        }
      })
      .catch(() => {
        setMarketplaceListings(featuredListings);
      });
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

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

    writeStoredChatState(filteredMessages, activeListingQuery);
  }, [activeListingQuery, filteredMessages, hasRestoredChat]);

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
          body: { locationSettings, retainedListingImages },
        },
      );
    },
    [activeListingQuery, hasRestoredChat, refreshMarketplaceListings, sendMessage],
  );

  const sendStarter = useCallback(
    (prompt: string) => {
      if (isLoading || !hasRestoredChat) {
        return;
      }

      const intent = inferClientIntent(prompt);
      setClientIntent(intent);

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
          body: { locationSettings },
        },
      );
    },
    [activeListingQuery, hasRestoredChat, isLoading, refreshMarketplaceListings, sendMessage],
  );

  const openListing = useCallback(
    (listing: ListingCard) => {
      if (!listing.id) {
        return;
      }

      router.push(`/listings/${listing.id}`);
    },
    [router],
  );

  const favoriteListing = useCallback(
    (listing: ListingCard) => {
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

  const startNewChat = useCallback(() => {
    setMessages([]);
    setActiveListingQuery('');
    retainedListingImagesRef.current = [];
    clearStoredChatState();
    void clearRetainedListingImages().catch(() => {});
  }, [setMessages]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground lg:h-dvh lg:overflow-hidden" dir="rtl">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-3 px-4 py-3 sm:px-6 lg:h-full lg:min-h-0">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card">
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
                  <Button asChild variant="outline" size="sm" className="rounded-md">
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

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_25rem]">
            <section className="min-w-0 overflow-y-auto border-b bg-[#eef4fb] p-4 dark:bg-background lg:border-b-0 lg:border-l">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
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

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

            <section className="flex min-h-[32rem] flex-col bg-white dark:bg-card lg:min-h-0">
              <header className="shrink-0 border-b px-4 py-3">
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
                  <Button variant="ghost" size="icon-sm" className="rounded-md" onClick={startNewChat} aria-label="محادثة جديدة">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </div>
              </header>

              <div className="flex min-h-0 flex-1 overflow-hidden">
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
                                <img alt={listing.title} className="aspect-square rounded-md object-cover" src={listing.image} />
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

              <div className="shrink-0 border-t p-3">
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
