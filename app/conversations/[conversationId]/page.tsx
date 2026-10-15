'use client';
/* eslint-disable @next/next/no-img-element */

import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useOverlayViewport } from '@/hooks/use-overlay-viewport';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  Ban,
  Flag,
  MessageCircle,
  MoreVertical,
  Phone,
  Send,
  Megaphone,
  Unlock,
} from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { ListingCardImage } from '@/components/listing-card-image';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { Textarea } from '@ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ui/dropdown-menu';

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

type ConversationMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  status: 'sent' | 'blocked';
  type?: 'text' | 'contact_share' | 'message_deleted';
  reasons: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type ConversationListing = {
  id: string;
  sellerId?: string;
  title?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  category: string;
  status?: string;
  images?: Array<{
    displayUrl?: string;
    originalUrl?: string;
    thumbnailUrl?: string;
  }>;
};

type ConversationParticipant = {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  lastActiveAt?: string;
  deletedAt?: string;
};

type ConversationRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  status: 'open' | 'closed' | 'reported';
  messages: ConversationMessage[];
  updatedAt: string;
  listing: ConversationListing | null;
  seller?: ConversationParticipant;
  buyer?: ConversationParticipant;
};

type ConversationBlockStatus = {
  blocked: boolean;
  blockedByMe: boolean;
  blockerId?: string;
  blockedUserId?: string;
};

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22900%22 height=%22675%22 viewBox=%220 0 900 675%22%3E%3Crect width=%22900%22 height=%22675%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M382 291h136a28 28 0 0 1 28 28v95a28 28 0 0 1-28 28H382a28 28 0 0 1-28-28v-95a28 28 0 0 1 28-28z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22/%3E%3Ccircle cx=%22417%22 cy=%22342%22 r=%2220%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m382 414 53-55 43 43 25-27 43 39%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2214%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22450%22 y=%22492%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';
const conversationOnlineWindowMs = 6 * 60 * 1000;

function pickLatestConversation(
  current: ConversationRecord | null,
  incoming: ConversationRecord,
) {
  if (current?.id !== incoming.id) {
    return incoming;
  }

  const currentTimestamp = Date.parse(current.updatedAt);
  const incomingTimestamp = Date.parse(incoming.updatedAt);

  if (
    Number.isFinite(currentTimestamp) &&
    Number.isFinite(incomingTimestamp) &&
    incomingTimestamp < currentTimestamp
  ) {
    return current;
  }

  return incoming;
}

function formatPrice(price: ConversationListing['price']) {
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

function getListingImage(listing: ConversationListing | null) {
  const image = listing?.images?.[0];

  return (
    image?.thumbnailUrl ??
    image?.displayUrl ??
    image?.originalUrl ??
    missingListingImageDataUrl
  );
}

function isListingPubliclyOpenable(listing: ConversationListing | null | undefined) {
  return listing?.status === 'published';
}

function getUnavailableListingLabel(status: string | undefined) {
  const labels: Record<string, string> = {
    deleted: 'الإعلان محذوف',
    paused: 'الإعلان موقوف عن النشر',
    sold: 'الإعلان مباع',
    rejected: 'الإعلان غير منشور',
    pending: 'الإعلان قيد المراجعة',
    draft: 'الإعلان غير منشور',
  };

  return labels[status ?? ''] ?? 'الإعلان غير متاح';
}

function getParticipantFallbackName(participantId?: string | null) {
  if (!participantId) {
    return 'عميل سوق حمد';
  }

  if (participantId.startsWith('google:') || participantId.startsWith('apple:')) {
    return 'عميل سوق حمد';
  }

  return participantId;
}

function getParticipantDisplayName(participant?: ConversationParticipant | null) {
  return (
    participant?.name?.trim() ||
    participant?.email?.trim() ||
    getParticipantFallbackName(participant?.id)
  );
}

function getParticipantInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || 'ح';
}

function formatMessageTime(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMessageDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  if (sameDay(date, now)) {
    return 'اليوم';
  }

  if (sameDay(date, yesterday)) {
    return 'أمس';
  }

  return new Intl.DateTimeFormat('ar-SA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatLastSeen(value: string) {
  const date = new Date(value);
  const timestamp = date.getTime();

  if (!Number.isFinite(timestamp)) {
    return 'آخر ظهور غير متاح';
  }

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  const time = new Intl.DateTimeFormat('ar-SA', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);

  if (sameDay(date, now)) {
    return `آخر ظهور اليوم ${time}`;
  }

  if (sameDay(date, yesterday)) {
    return `آخر ظهور أمس ${time}`;
  }

  return `آخر ظهور ${new Intl.DateTimeFormat('ar-SA', {
    day: 'numeric',
    month: 'short',
  }).format(date)}`;
}

function getParticipantPresence(participant?: ConversationParticipant | null) {
  if (!participant?.lastActiveAt) {
    return { label: 'آخر ظهور غير متاح', online: false };
  }

  const lastActiveTimestamp = Date.parse(participant.lastActiveAt);

  if (!Number.isFinite(lastActiveTimestamp)) {
    return { label: 'آخر ظهور غير متاح', online: false };
  }

  const elapsed = Date.now() - lastActiveTimestamp;

  if (elapsed >= 0 && elapsed <= conversationOnlineWindowMs) {
    return { label: 'متصل الآن', online: true };
  }

  return { label: formatLastSeen(participant.lastActiveAt), online: false };
}

function isSameMessageDay(left: string, right?: string) {
  if (!right) {
    return false;
  }

  const leftDate = new Date(left);
  const rightDate = new Date(right);

  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function normalizeContactDigits(value: string) {
  const digitMap: Record<string, string> = {
    '٠': '0',
    '١': '1',
    '٢': '2',
    '٣': '3',
    '٤': '4',
    '٥': '5',
    '٦': '6',
    '٧': '7',
    '٨': '8',
    '٩': '9',
    '۰': '0',
    '۱': '1',
    '۲': '2',
    '۳': '3',
    '۴': '4',
    '۵': '5',
    '۶': '6',
    '۷': '7',
    '۸': '8',
    '۹': '9',
  };

  return value.replace(/[٠-٩۰-۹]/g, (digit) => digitMap[digit] ?? digit);
}

function containsManualContactDetails(value: string) {
  const normalized = normalizeContactDigits(value);
  const compact = normalized.replace(/[\s().-]/g, '');

  return (
    /(?:05|5)\d{8}/.test(compact) ||
    /\+9665\d{8}/.test(compact) ||
    /\b[^@\s]+@[^@\s]+\.[A-Za-z]{2,}\b/.test(normalized)
  );
}

function getSharedPhoneNumber(message: ConversationMessage) {
  const phoneNumber = message.metadata?.phoneNumber;

  return typeof phoneNumber === 'string' ? phoneNumber : '';
}

function isMessageReadBy(message: ConversationMessage, userId?: string | null) {
  if (!userId) {
    return false;
  }

  const readBy = message.metadata?.readBy;

  return (
    typeof readBy === 'object' &&
    readBy !== null &&
    !Array.isArray(readBy) &&
    typeof (readBy as Record<string, unknown>)[userId] === 'string'
  );
}

function isMessageDeliveredTo(
  message: ConversationMessage,
  userId?: string | null,
) {
  if (!userId) {
    return false;
  }

  const deliveredTo = message.metadata?.deliveredTo;

  return (
    typeof deliveredTo === 'object' &&
    deliveredTo !== null &&
    !Array.isArray(deliveredTo) &&
    typeof (deliveredTo as Record<string, unknown>)[userId] === 'string'
  );
}

function isMessageDeletedFor(
  message: ConversationMessage,
  userId?: string | null,
) {
  if (!userId) {
    return false;
  }

  const deletedFor = message.metadata?.deletedFor;

  return (
    typeof deletedFor === 'object' &&
    deletedFor !== null &&
    !Array.isArray(deletedFor) &&
    typeof (deletedFor as Record<string, unknown>)[userId] === 'string'
  );
}

function isMessageDeletedForEveryone(message: ConversationMessage) {
  return (
    message.type === 'message_deleted' ||
    Boolean(message.metadata?.deletedForEveryone)
  );
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

export default function ConversationPage() {
  const router = useRouter();
  const params = useParams<{ conversationId: string }>();
  const searchParams = useSearchParams();
  const conversationId = params.conversationId;
  const entryListingId = searchParams.get('listingId')?.trim() ?? '';
  const { isSessionLoading, session } = useAuthSession();
  const [conversation, setConversation] = useState<ConversationRecord | null>(
    null,
  );
  const [entryListing, setEntryListing] = useState<ConversationListing | null>(
    null,
  );
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const messageActionsViewportRef = useOverlayViewport<HTMLDivElement>();
  const [pendingConversationAction, setPendingConversationAction] = useState<
    'block' | 'unblock' | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isSharingContact, setIsSharingContact] = useState(false);
  const [isReportingUser, setIsReportingUser] = useState(false);
  const [isBlockingUser, setIsBlockingUser] = useState(false);
  const [isUnblockingUser, setIsUnblockingUser] = useState(false);
  const [messageActionTarget, setMessageActionTarget] =
    useState<ConversationMessage | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [blockStatus, setBlockStatus] =
    useState<ConversationBlockStatus | null>(null);
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false);
  const [visualViewportFrame, setVisualViewportFrame] = useState<{
    height: number;
    offsetTop: number;
  } | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageLongPressTimerRef = useRef<number | null>(null);
  const hasInitialScrollRef = useRef(false);
  const chatTapTrackerRef = useRef<ChatTapTracker>(
    createEmptyChatTapTracker(),
  );

  useEffect(() => {
    document.body.dataset.smartstoreConversationPage = 'true';

    return () => {
      delete document.body.dataset.smartstoreConversationPage;
    };
  }, []);

  const scrollConversationToLatest = useCallback(() => {
    const messagesContainer = messagesContainerRef.current;

    if (!messagesContainer) {
      return;
    }

    messagesContainer.scrollTo({
      top: messagesContainer.scrollHeight,
      behavior: 'auto',
    });
  }, []);

  const mobileConversationStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMessageInputFocused || !visualViewportFrame) {
      return undefined;
    }

    return {
      height: `${visualViewportFrame.height}px`,
      insetInline: '0',
      maxHeight: `${visualViewportFrame.height}px`,
      overflow: 'hidden',
      position: 'fixed',
      top: `${visualViewportFrame.offsetTop}px`,
      width: '100%',
    };
  }, [isMessageInputFocused, visualViewportFrame]);

  const otherParticipantId =
    conversation && session.user?.id
      ? session.user.id === conversation.sellerId
        ? conversation.buyerId
        : conversation.sellerId
      : null;
  const otherParticipant =
    conversation && session.user?.id
      ? session.user.id === conversation.sellerId
        ? conversation.buyer
        : conversation.seller
      : null;
  const otherParticipantName =
    getParticipantDisplayName(otherParticipant) ||
    getParticipantFallbackName(otherParticipantId);
  const otherParticipantPresence = getParticipantPresence(otherParticipant);
  const canOpenOtherParticipantProfile = Boolean(
    otherParticipantId && !otherParticipant?.deletedAt,
  );
  const otherParticipantProfileHref = canOpenOtherParticipantProfile && otherParticipantId
    ? `/sellers/${encodeURIComponent(otherParticipantId)}?source=conversation&conversationId=${encodeURIComponent(conversationId)}`
    : null;
  const displayListing =
    entryListing && entryListing.sellerId === conversation?.sellerId
      ? entryListing
      : conversation?.listing;
  const canOpenDisplayListing = isListingPubliclyOpenable(displayListing);
  const unavailableListingLabel = getUnavailableListingLabel(displayListing?.status);
  const conversationListingHref = displayListing && canOpenDisplayListing
    ? `/listings/${encodeURIComponent(displayListing.id)}?source=conversation&conversationId=${encodeURIComponent(conversationId)}`
    : null;
  const visibleMessages = useMemo(
    () =>
      conversation?.messages.filter(
        (message) =>
          message.status === 'sent' &&
          !isMessageDeletedFor(message, session.user?.id),
      ) ?? [],
    [conversation?.messages, session.user?.id],
  );
  const draftHasManualContact = containsManualContactDetails(draft);
  const isConversationBlocked = Boolean(blockStatus?.blocked);
  const canUnblockConversation = Boolean(
    isConversationBlocked && blockStatus?.blockedByMe,
  );

  const handleMessageInputFocus = useCallback(() => {
    setIsMessageInputFocused(true);
    window.requestAnimationFrame(scrollConversationToLatest);
    window.setTimeout(scrollConversationToLatest, 180);
  }, [scrollConversationToLatest]);

  const prepareConversationListNavigation = useCallback(() => {
    messageInputRef.current?.blur();
    setIsMessageInputFocused(false);
    setVisualViewportFrame({
      height: window.innerHeight,
      offsetTop: 0,
    });
  }, []);

  const handleMessagesPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMessageInputFocused || isKeyboardDismissIgnoredTarget(event.target)) {
        chatTapTrackerRef.current.pointerId = null;
        return;
      }

      chatTapTrackerRef.current = {
        ...chatTapTrackerRef.current,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startAt: Date.now(),
        moved: false,
      };
    },
    [isMessageInputFocused],
  );

  const handleMessagesPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tracker = chatTapTrackerRef.current;

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

  const handleMessagesPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const tracker = chatTapTrackerRef.current;

      if (
        !isMessageInputFocused ||
        tracker.pointerId !== event.pointerId ||
        tracker.moved ||
        isKeyboardDismissIgnoredTarget(event.target)
      ) {
        chatTapTrackerRef.current.pointerId = null;
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
        messageInputRef.current?.blur();
        chatTapTrackerRef.current = createEmptyChatTapTracker();
        return;
      }

      chatTapTrackerRef.current = {
        ...tracker,
        pointerId: null,
        lastTapAt: isTap ? now : 0,
      };
    },
    [isMessageInputFocused],
  );

  const handleMessagesPointerCancel = useCallback(() => {
    chatTapTrackerRef.current.pointerId = null;
  }, []);

  const clearMessageLongPressTimer = useCallback(() => {
    if (messageLongPressTimerRef.current) {
      window.clearTimeout(messageLongPressTimerRef.current);
      messageLongPressTimerRef.current = null;
    }
  }, []);

  const openMessageActions = useCallback((message: ConversationMessage) => {
    if (isMessageDeletedForEveryone(message)) {
      return;
    }

    setMessageActionTarget(message);
  }, []);

  const handleMessageLongPressStart = useCallback(
    (message: ConversationMessage) => {
      clearMessageLongPressTimer();
      messageLongPressTimerRef.current = window.setTimeout(() => {
        openMessageActions(message);
      }, 520);
    },
    [clearMessageLongPressTimer, openMessageActions],
  );

  const deleteConversationMessage = useCallback(
    async (mode: 'for_me' | 'for_everyone') => {
      if (!messageActionTarget || deletingMessageId) {
        return;
      }

      const targetMessage = messageActionTarget;
      setDeletingMessageId(targetMessage.id);
      setNotice('');

      try {
        const response = await fetch(
          `/api/marketplace/conversations/${conversationId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': createClientIdempotencyKey(
                `message-delete-${mode}`,
              ),
            },
            body: JSON.stringify({
              action: 'delete_message',
              messageId: targetMessage.id,
              mode,
            }),
          },
        );
        let payload: {
          conversation?: ConversationRecord | null;
          error?: string;
        } = {};

        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          payload = {};
        }

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok || !payload.conversation) {
          setNotice(
            response.status === 403
              ? 'لا يمكنك حذف هذه الرسالة لدى الجميع.'
              : 'تعذر حذف الرسالة الآن.',
          );
          return;
        }

        setMessageActionTarget(null);
        setConversation((currentConversation) =>
          pickLatestConversation(currentConversation, payload.conversation!),
        );
      } finally {
        setDeletingMessageId(null);
      }
    },
    [
      conversationId,
      deletingMessageId,
      messageActionTarget,
      router,
    ],
  );

  const refreshConversation = useCallback(async (
    options?: { showLoading?: boolean; clearNotice?: boolean },
  ) => {
    const showLoading = options?.showLoading ?? true;
    const clearNotice = options?.clearNotice ?? true;

    if (showLoading) {
      setIsLoading(true);
    }

    if (clearNotice) {
      setNotice('');
    }

    try {
      if (!session.authenticated) {
        router.push('/api/auth/google/start');
        return;
      }

      const conversationResponse = await fetch(
        `/api/marketplace/conversations/${conversationId}`,
        {
          cache: 'no-store',
        },
      );

      if (!conversationResponse.ok) {
        setNotice('تعذر العثور على هذه المحادثة أو ليس لديك صلاحية لعرضها.');
        setConversation(null);
        return;
      }

      const payload = (await conversationResponse.json()) as {
        conversation: ConversationRecord;
        blockStatus?: ConversationBlockStatus | null;
      };
      setConversation((currentConversation) =>
        pickLatestConversation(currentConversation, payload.conversation),
      );
      setBlockStatus(payload.blockStatus ?? null);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, [conversationId, router, session.authenticated]);

  useEffect(() => {
    if (!entryListingId || entryListingId === conversation?.listing?.id) {
      setEntryListing(null);
      return;
    }

    let isActive = true;

    async function loadEntryListing() {
      try {
        const response = await fetch(
          `/api/marketplace/listings/${encodeURIComponent(entryListingId)}`,
          { cache: 'no-store' },
        );

        if (!response.ok) {
          if (isActive) {
            setEntryListing(null);
          }
          return;
        }

        const payload = (await response.json()) as {
          listing?: ConversationListing | null;
        };

        if (isActive) {
          setEntryListing(payload.listing ?? null);
        }
      } catch {
        if (isActive) {
          setEntryListing(null);
        }
      }
    }

    void loadEntryListing();

    return () => {
      isActive = false;
    };
  }, [conversation?.listing?.id, entryListingId]);

  useEffect(() => {
    const onPullRefresh = () => {
      void refreshConversation({ showLoading: false, clearNotice: false });
    };

    window.addEventListener('smartstore:pull-refresh', onPullRefresh);

    return () => {
      window.removeEventListener('smartstore:pull-refresh', onPullRefresh);
    };
  }, [refreshConversation]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    return () => {
      clearMessageLongPressTimer();
    };
  }, [clearMessageLongPressTimer]);

  useLayoutEffect(() => {
    const syncVisualViewport = () => {
      const viewport = window.visualViewport;

      setVisualViewportFrame({
        height: Math.round(viewport?.height ?? window.innerHeight),
        offsetTop: Math.round(viewport?.offsetTop ?? 0),
      });
    };

    syncVisualViewport();
    window.visualViewport?.addEventListener('resize', syncVisualViewport);
    window.visualViewport?.addEventListener('scroll', syncVisualViewport);
    window.addEventListener('resize', syncVisualViewport);

    return () => {
      window.visualViewport?.removeEventListener('resize', syncVisualViewport);
      window.visualViewport?.removeEventListener('scroll', syncVisualViewport);
      window.removeEventListener('resize', syncVisualViewport);
    };
  }, []);

  useEffect(() => {
    if (isSessionLoading) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshConversation();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isSessionLoading, refreshConversation]);

  // First render after the conversation messages exist: jump to the latest
  // message before the browser paints, so the thread never flashes at the top
  // and shifts down afterwards.
  useLayoutEffect(() => {
    if (isLoading) {
      return;
    }

    if (!hasInitialScrollRef.current) {
      hasInitialScrollRef.current = true;
      scrollConversationToLatest();
      return;
    }

    const animationFrame = window.requestAnimationFrame(
      scrollConversationToLatest,
    );

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isLoading, scrollConversationToLatest, visibleMessages.length]);

  useEffect(() => {
    if (!isMessageInputFocused) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(
      scrollConversationToLatest,
    );
    const keyboardAnimationTimer = window.setTimeout(
      scrollConversationToLatest,
      180,
    );

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(keyboardAnimationTimer);
    };
  }, [
    isMessageInputFocused,
    scrollConversationToLatest,
    visualViewportFrame?.height,
    visualViewportFrame?.offsetTop,
  ]);

  useSmartstoreRealtime({
    enabled: Boolean(conversationId) && session.authenticated,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'message_created',
      'conversation_updated',
      'ad_status_changed',
      'maintenance_cleanup',
    ],
    onEvent: (event) => {
      if (
        event.type === 'message_created' ||
        event.type === 'conversation_updated'
      ) {
        if (event.payload.conversationId !== conversationId) {
          return;
        }

        void refreshConversation({ showLoading: false, clearNotice: false });
        return;
      }

      if (
        event.type === 'ad_status_changed' &&
        event.payload.listingId === conversation?.listingId
      ) {
        void refreshConversation({ showLoading: false, clearNotice: false });
        return;
      }

      if (event.type === 'maintenance_cleanup') {
        void refreshConversation({ showLoading: false, clearNotice: false });
      }
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return refreshConversation({ showLoading: false, clearNotice: false });
    },
  });

  const sendConversationMessage = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const messageBody = draft.trim();

      if (
        !messageBody ||
        isSending ||
        conversation?.status !== 'open' ||
        isConversationBlocked
      ) {
        return;
      }

      setIsSending(true);
      setNotice('');

      try {
        const response = await fetch(
          `/api/marketplace/conversations/${conversationId}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Idempotency-Key': createClientIdempotencyKey('message-send'),
            },
            body: JSON.stringify({ body: messageBody }),
          },
        );
        let payload: {
          conversation?: ConversationRecord;
          blockStatus?: ConversationBlockStatus;
          error?: string;
        } = {};

        try {
          payload = (await response.json()) as typeof payload;
        } catch {
          payload = {};
        }

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (response.status === 422) {
          setNotice(
            'لا يمكن إرسال هذه الرسالة لأنها تحتوي على محتوى مخالف لسياسة السوق.',
          );
          return;
        }

        if (response.status === 409 && payload.error === 'conversation_blocked') {
          setBlockStatus(payload.blockStatus ?? { blocked: true, blockedByMe: false });
          setNotice('لا يمكن إرسال رسائل جديدة في هذه المحادثة بعد الحظر.');
          return;
        }

        if (!response.ok || !payload.conversation) {
          setNotice('تعذر إرسال الرسالة الآن.');
          return;
        }

        setDraft((currentDraft) =>
          currentDraft.trim() === messageBody ? '' : currentDraft,
        );
        setConversation((currentConversation) =>
          pickLatestConversation(
            currentConversation,
            payload.conversation as ConversationRecord,
          ),
        );
        void refreshConversation({ showLoading: false, clearNotice: false });
      } finally {
        setIsSending(false);
      }
    },
    [
      conversationId,
      conversation?.status,
      draft,
      isConversationBlocked,
      isSending,
      refreshConversation,
      router,
    ],
  );

  const sendConversationMessageWithEnter = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Enter' || event.shiftKey) {
        return;
      }

      event.preventDefault();

      if (
        !draft.trim() ||
        isSending ||
        conversation?.status !== 'open' ||
        isConversationBlocked
      ) {
        return;
      }

      event.currentTarget.form?.requestSubmit();
    },
    [
      conversation?.status,
      draft,
      isConversationBlocked,
      isSending,
    ],
  );

  const shareOfficialContact = useCallback(async () => {
    if (!conversation || isSharingContact || isConversationBlocked) {
      return;
    }

    setIsSharingContact(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/conversations/${conversationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('contact-share'),
          },
          body: JSON.stringify({ action: 'share_contact' }),
        },
      );
      let payload: {
        conversation?: ConversationRecord;
        blockStatus?: ConversationBlockStatus;
        error?: string;
      } = {};

      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        payload = {};
      }

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (payload.conversation) {
        setConversation((currentConversation) =>
          pickLatestConversation(
            currentConversation,
            payload.conversation as ConversationRecord,
          ),
        );
      }

      if (payload.error === 'contact_phone_required') {
        setNotice(
          'أضف رقم الجوال من صفحة حسابي أولًا، ثم ارجع للمحادثة لمشاركته رسميًا.',
        );
        return;
      }

      if (payload.error === 'conversation_blocked') {
        setBlockStatus(payload.blockStatus ?? { blocked: true, blockedByMe: false });
        setNotice('لا يمكن مشاركة رقم التواصل بعد حظر هذه المحادثة.');
        return;
      }

      if (!response.ok || !payload.conversation) {
        setNotice('تعذر مشاركة رقم التواصل الآن.');
        return;
      }

      setNotice('تمت مشاركة رقم التواصل الرسمي داخل المحادثة. تنبيه: لا تحول أي مبالغ قبل المعاينة والتأكد.');
      void refreshConversation({ showLoading: false, clearNotice: false });
    } finally {
      setIsSharingContact(false);
    }
  }, [
    conversation,
    conversationId,
    isConversationBlocked,
    isSharingContact,
    refreshConversation,
    router,
  ]);

  const reportConversationUser = useCallback(async () => {
    if (!conversation || isReportingUser) {
      return;
    }

    const details = window.prompt('اكتب سبب البلاغ للإدارة')?.trim();

    if (details === undefined) {
      return;
    }

    setIsReportingUser(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/conversations/${conversationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('user-report'),
          },
          body: JSON.stringify({
            action: 'report_user',
            reason: 'conversation_report',
            details: details || undefined,
          }),
        },
      );

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر إرسال البلاغ الآن.');
        return;
      }

      setNotice('تم إرسال البلاغ للإدارة.');
    } finally {
      setIsReportingUser(false);
    }
  }, [conversation, conversationId, isReportingUser, router]);

  const blockConversationParticipant = useCallback(async () => {
    if (!conversation || isBlockingUser || isConversationBlocked) {
      return;
    }

    setPendingConversationAction(null);
    setIsBlockingUser(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/conversations/${conversationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('user-block'),
          },
          body: JSON.stringify({
            action: 'block_user',
            reason: 'conversation_block',
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        blockStatus?: ConversationBlockStatus;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر حظر المستخدم الآن.');
        return;
      }

      setBlockStatus(payload?.blockStatus ?? { blocked: true, blockedByMe: true });
      setNotice('تم حظر المستخدم. لن يتم إرسال رسائل جديدة في هذه المحادثة.');
      void refreshConversation({ showLoading: false, clearNotice: false });
    } finally {
      setIsBlockingUser(false);
    }
  }, [
    conversation,
    conversationId,
    isBlockingUser,
    isConversationBlocked,
    refreshConversation,
    router,
  ]);

  const unblockConversationParticipant = useCallback(async () => {
    if (!conversation || isUnblockingUser || !canUnblockConversation) {
      return;
    }

    setPendingConversationAction(null);
    setIsUnblockingUser(true);
    setNotice('');

    try {
      const response = await fetch(
        `/api/marketplace/conversations/${conversationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': createClientIdempotencyKey('user-unblock'),
          },
          body: JSON.stringify({
            action: 'unblock_user',
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        blockStatus?: ConversationBlockStatus;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر إزالة الحظر الآن.');
        return;
      }

      setBlockStatus(
        payload?.blockStatus ?? { blocked: false, blockedByMe: false },
      );
      setNotice('تمت إزالة الحظر. يمكن إرسال رسائل جديدة في هذه المحادثة.');
      void refreshConversation({ showLoading: false, clearNotice: false });
    } finally {
      setIsUnblockingUser(false);
    }
  }, [
    canUnblockConversation,
    conversation,
    conversationId,
    isUnblockingUser,
    refreshConversation,
    router,
  ]);

  return (
    <main
      className="customer-conversation-page h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground"
      dir="rtl"
      style={mobileConversationStyle}
    >
      <FloatingActionNotice
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={
          notice.startsWith('تعذر') || notice.startsWith('لا يمكن')
            ? 'danger'
            : 'success'
        }
      />
      <ActionConfirmDialog
        confirmLabel={
          pendingConversationAction === 'unblock' ? 'إزالة الحظر' : 'حظر المستخدم'
        }
        description={
          pendingConversationAction === 'unblock'
            ? 'سيتم السماح بالرسائل الجديدة في هذه المحادثة.'
            : 'سيتم إيقاف الرسائل الجديدة من هذا المستخدم.'
        }
        loading={
          pendingConversationAction === 'unblock'
            ? isUnblockingUser
            : isBlockingUser
        }
        loadingText="جاري التنفيذ..."
        onCancel={() => setPendingConversationAction(null)}
        onConfirm={() => {
          if (pendingConversationAction === 'unblock') {
            void unblockConversationParticipant();
          } else if (pendingConversationAction === 'block') {
            void blockConversationParticipant();
          }
        }}
        open={Boolean(pendingConversationAction)}
        title={
          pendingConversationAction === 'unblock'
            ? 'تأكيد إزالة الحظر'
            : 'تأكيد حظر المستخدم'
        }
        tone={pendingConversationAction === 'block' ? 'danger' : 'default'}
      />
      <div
        className={`customer-conversation-shell mx-auto flex h-full w-full max-w-6xl flex-col gap-0 overflow-hidden px-0 pt-0 sm:gap-2 sm:px-4 sm:pt-2 lg:grid lg:h-full lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-4 lg:px-6 lg:py-5 ${
          isMessageInputFocused
            ? 'pb-0 sm:pb-0'
            : 'pb-[env(safe-area-inset-bottom)] sm:pb-[calc(0.5rem+env(safe-area-inset-bottom))]'
        }`}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-2 py-2 sm:px-1 sm:py-1.5 lg:py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link
                href="/conversations"
                onClick={prepareConversationListNavigation}
                onPointerDown={prepareConversationListNavigation}
              >
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="customer-conversation-card flex h-full min-h-0 flex-col overflow-hidden rounded-none bg-white dark:bg-card sm:rounded-md">
            <div className="flex shrink-0 items-center justify-between gap-3 px-2 py-2 lg:px-1 lg:py-3">
              <div className="flex min-w-0 items-center gap-3">
                {otherParticipantProfileHref ? (
                  <Link
                    href={otherParticipantProfileHref}
                    className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 shadow-sm transition hover:opacity-85 active:scale-95 dark:border-blue-300/20 dark:bg-blue-400/10 dark:text-blue-100"
                  >
                    {otherParticipant?.picture ? (
                      <SellerAvatar
                        alt={otherParticipantName}
                        picture={otherParticipant.picture}
                      />
                    ) : (
                      <span>{getParticipantInitial(otherParticipantName)}</span>
                    )}
                  </Link>
                ) : (
                  <div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 text-sm font-black text-slate-500 shadow-sm dark:border-white/10 dark:bg-slate-800 dark:text-slate-300">
                    <span>{getParticipantInitial(otherParticipantName)}</span>
                  </div>
                )}
                <div className="min-w-0">
                  {otherParticipantProfileHref ? (
                    <Link
                      href={otherParticipantProfileHref}
                      className="block truncate text-sm font-bold transition hover:opacity-85"
                    >
                      {otherParticipantName}
                    </Link>
                  ) : (
                    <h1 className="truncate text-sm font-bold">
                      {otherParticipant?.deletedAt ? 'حساب محذوف' : otherParticipantName}
                    </h1>
                  )}
                  <p
                    className={`mt-0.5 flex items-center gap-1 truncate text-xs ${
                      otherParticipantPresence.online
                        ? 'text-emerald-600 dark:text-emerald-300'
                        : 'text-muted-foreground'
                    }`}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        otherParticipantPresence.online
                          ? 'bg-emerald-500'
                          : 'bg-slate-300 dark:bg-slate-600'
                      }`}
                    />
                    <span className="truncate">
                      {otherParticipantPresence.label}
                    </span>
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="خيارات المحادثة"
                      className="size-9 rounded-md"
                      disabled={!conversation}
                      size="icon-sm"
                      type="button"
                      variant="outline"
                    >
                      <MoreVertical className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-40">
                    <DropdownMenuItem
                      disabled={!conversation || isReportingUser}
                      onSelect={(event) => {
                        event.preventDefault();
                        void reportConversationUser();
                      }}
                    >
                      <Flag className="size-4" />
                      {isReportingUser ? 'جار الإبلاغ...' : 'إبلاغ'}
                    </DropdownMenuItem>
                    {canUnblockConversation ? (
                      <DropdownMenuItem
                        disabled={!conversation || isUnblockingUser}
                        onSelect={(event) => {
                          event.preventDefault();
                          setPendingConversationAction('unblock');
                        }}
                      >
                        <Unlock className="size-4" />
                        {isUnblockingUser ? 'جار إزالة الحظر...' : 'إزالة الحظر'}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="text-red-700 focus:text-red-700 dark:text-red-200 dark:focus:text-red-200"
                        disabled={!conversation || isBlockingUser || isConversationBlocked}
                        onSelect={(event) => {
                          event.preventDefault();
                          setPendingConversationAction('block');
                        }}
                      >
                        <Ban className="size-4" />
                        {isConversationBlocked ? 'محظورة' : isBlockingUser ? 'جار الحظر...' : 'حظر'}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            <div className="shrink-0 border-t bg-white px-3 py-2 dark:bg-card lg:hidden">
              <div className="flex items-center gap-2">
                {displayListing && conversationListingHref ? (
                  <Link
                    href={conversationListingHref}
                    className="size-12 shrink-0 overflow-hidden rounded-md transition hover:opacity-85 active:scale-95"
                  >
                    <ListingCardImage
                      alt={displayListing.title ?? 'صورة الإعلان'}
                      className="size-full object-cover"
                      fallback={
                        <img
                          alt="صورة الإعلان"
                          className="size-full object-cover"
                          decoding="async"
                          loading="lazy"
                          src={missingListingImageDataUrl}
                        />
                      }
                      height={48}
                      sizes="48px"
                      src={getListingImage(displayListing)}
                      width={48}
                    />
                  </Link>
                ) : (
                  <img
                    alt="صورة الإعلان"
                    className="size-12 shrink-0 rounded-md object-cover"
                    decoding="async"
                    loading="lazy"
                    src={missingListingImageDataUrl}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                    <Megaphone className="size-3.5" />
                    الإعلان
                  </div>
                  {displayListing && conversationListingHref ? (
                    <Link
                      href={conversationListingHref}
                      className="block truncate text-xs font-bold transition hover:text-blue-600"
                    >
                      {displayListing.title ?? 'إعلان غير متاح'}
                    </Link>
                  ) : (
                    <h2 className="truncate text-xs font-bold">إعلان غير متاح</h2>
                  )}
                  <p className="mt-0.5 truncate text-xs font-bold text-blue-700">
                    {formatPrice(displayListing?.price)}
                  </p>
                  {displayListing && !conversationListingHref && (
                    <p className="mt-0.5 truncate text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      {unavailableListingLabel}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div
              ref={messagesContainerRef}
              className="customer-conversation-messages min-h-0 flex-1 overscroll-contain overflow-y-auto smartstore-fade-scroll bg-[#f7f9fc] px-3 py-2 dark:bg-background sm:px-4 sm:py-4"
              onPointerCancel={handleMessagesPointerCancel}
              onPointerDown={handleMessagesPointerDown}
              onPointerMove={handleMessagesPointerMove}
              onPointerUp={handleMessagesPointerUp}
            >
              {isLoading ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  جار تحميل المحادثة...
                </div>
              ) : visibleMessages.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div className="grid max-w-xs gap-2">
                    <MessageCircle className="mx-auto size-10 text-blue-600" />
                    <h3 className="text-base font-bold">ابدأ المحادثة</h3>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-full flex-col justify-end gap-1">
                  {visibleMessages.map((message, index) => {
                    const mine = message.senderId === session.user?.id;
                    const sharedPhoneNumber = getSharedPhoneNumber(message);
                    const isDeletedForEveryone =
                      isMessageDeletedForEveryone(message);
                    const previousMessage = visibleMessages[index - 1];
                    const shouldShowDateSeparator = !isSameMessageDay(
                      message.createdAt,
                      previousMessage?.createdAt,
                    );
                    const isReadByOther =
                      mine &&
                      Boolean(otherParticipantId) &&
                      isMessageReadBy(message, otherParticipantId);
                    const isDeliveredToOther =
                      mine &&
                      Boolean(otherParticipantId) &&
                      isMessageDeliveredTo(message, otherParticipantId);
                    const deliveryLabel = isReadByOther
                      ? 'تمت القراءة'
                      : isDeliveredToOther
                        ? 'تم التسليم'
                        : 'تم الإرسال';

                    return (
                      <div key={message.id} className="contents">
                        {shouldShowDateSeparator && (
                          <div className="my-3 flex justify-center">
                            <span className="rounded-full bg-white/85 px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm ring-1 ring-slate-200/70 dark:bg-card/80 dark:ring-white/10">
                              {formatMessageDate(message.createdAt)}
                            </span>
                          </div>
                        )}
                        <div
                          className={`grid w-fit max-w-[min(74%,30rem)] gap-0.5 ${
                            mine
                              ? 'self-start text-right'
                              : 'self-end text-right'
                          }`}
                        >
                          <div
                            className={`grid gap-0.5 rounded-2xl border px-2.5 py-1.5 text-[0.86rem] leading-6 shadow-sm ${
                              mine
                                ? 'rounded-br-md border-blue-600 bg-blue-600 text-white'
                                : 'rounded-bl-md border-slate-200 bg-white text-foreground dark:border-white/10 dark:bg-card'
                            }`}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              openMessageActions(message);
                            }}
                            onPointerCancel={clearMessageLongPressTimer}
                            onPointerDown={() =>
                              handleMessageLongPressStart(message)
                            }
                            onPointerLeave={clearMessageLongPressTimer}
                            onPointerUp={clearMessageLongPressTimer}
                          >
                            {isDeletedForEveryone ? (
                              <p className="text-xs italic opacity-75">
                                تم حذف هذه الرسالة
                              </p>
                            ) : message.type === 'contact_share' ? (
                              <div className="grid gap-2">
                                <div className="flex items-center gap-2 font-bold">
                                  <Phone className="size-4" />
                                  رقم التواصل الرسمي من المعلن
                                </div>
                                {sharedPhoneNumber ? (
                                  <a
                                    className={`w-fit rounded-md px-3 py-1 font-semibold underline-offset-4 hover:underline ${
                                      mine
                                        ? 'bg-white/15 text-white'
                                        : 'bg-emerald-50 text-emerald-800 dark:bg-background dark:text-emerald-100'
                                    }`}
                                    dir="ltr"
                                    href={`tel:${sharedPhoneNumber}`}
                                  >
                                    {sharedPhoneNumber}
                                  </a>
                                ) : (
                                  <span className="text-xs">
                                    تمت مشاركة رقم التواصل الرسمي.
                                  </span>
                                )}
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap break-words">
                                {message.body}
                              </p>
                            )}
                            <span
                              className={`flex items-center justify-end gap-1 text-[10px] leading-none ${
                                mine
                                  ? 'text-white/75'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              <span>{formatMessageTime(message.createdAt)}</span>
                              {mine && (
                                <span
                                  aria-label={deliveryLabel}
                                  className={`tracking-[-0.18em] ${
                                    isReadByOther ? 'text-sky-200' : ''
                                  }`}
                                  title={deliveryLabel}
                                >
                                  {isReadByOther || isDeliveredToOther
                                    ? '✓✓'
                                    : '✓'}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {isConversationBlocked && (
              <div className="border-t bg-red-50 px-4 py-2 text-sm leading-7 text-red-900 dark:bg-red-400/10 dark:text-red-100">
                لا يمكن إرسال رسائل جديدة في هذه المحادثة بعد الحظر.
              </div>
            )}

            {messageActionTarget && createPortal(
              <div
                className="viewport-overlay fixed inset-0 z-[80] grid place-items-end bg-black/20 p-3 backdrop-blur-[1px] [--overlay-padding-x:0.75rem] [--overlay-padding-y:0.75rem] [--overlay-padding-bottom:max(0.75rem,var(--marketplace-bottom-nav-space))] sm:place-items-center"
                ref={messageActionsViewportRef}
                onClick={() => setMessageActionTarget(null)}
              >
                <div
                  className="grid w-full max-w-sm gap-2 rounded-2xl border bg-white p-3 text-sm shadow-xl dark:bg-card"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="rounded-xl px-3 py-3 text-right font-semibold transition hover:bg-slate-100 dark:hover:bg-white/10"
                    disabled={deletingMessageId === messageActionTarget.id}
                    onClick={() => void deleteConversationMessage('for_me')}
                    type="button"
                  >
                    حذف لدي
                  </button>
                  {messageActionTarget.senderId === session.user?.id && (
                    <button
                      className="rounded-xl px-3 py-3 text-right font-semibold text-red-700 transition hover:bg-red-50 dark:text-red-200 dark:hover:bg-red-400/10"
                      disabled={deletingMessageId === messageActionTarget.id}
                      onClick={() =>
                        void deleteConversationMessage('for_everyone')
                      }
                      type="button"
                    >
                      حذف لدى الجميع
                    </button>
                  )}
                  <button
                    className="rounded-xl px-3 py-3 text-center font-semibold text-muted-foreground transition hover:bg-slate-100 dark:hover:bg-white/10"
                    onClick={() => setMessageActionTarget(null)}
                    type="button"
                  >
                    إلغاء
                  </button>
                </div>
              </div>,
              document.body,
            )}

            <form
              className={`customer-conversation-composer grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5 border-t bg-white p-1.5 dark:bg-card sm:p-2 ${
                isMessageInputFocused
                  ? 'pb-1.5 sm:pb-2'
                  : 'pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))]'
              }`}
              onSubmit={sendConversationMessage}
            >
              <Textarea
                ref={messageInputRef}
                className="col-start-1 row-start-1 max-h-20 min-h-10 resize-none rounded-full px-4 py-2 text-sm leading-6"
                disabled={conversation?.status !== 'open' || isConversationBlocked}
                name="conversationMessage"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => setIsMessageInputFocused(false)}
                onFocus={handleMessageInputFocus}
                onKeyDown={sendConversationMessageWithEnter}
                placeholder="اكتب رسالتك هنا..."
                value={draft}
              />
              {draftHasManualContact && (
                <p className="col-span-2 text-xs leading-6 text-amber-700 dark:text-amber-200">
                  تذكير: مشاركة معلومات التواصل أو الدفع خارج المنصة مسؤوليتك. لا تحول مبالغ قبل التأكد.
                </p>
              )}
              <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5">
                <Button
                  aria-label="مشاركة الرقم"
                  className="size-10 rounded-full px-0 text-[0px]"
                  disabled={
                    isSharingContact ||
                    conversation?.status !== 'open' ||
                    isConversationBlocked
                  }
                  onClick={shareOfficialContact}
                  type="button"
                  variant="outline"
                >
                  <Phone className="size-4" />
                  {isSharingContact ? 'جار المشاركة...' : 'مشاركة الرقم'}
                </Button>
                <Button
                  aria-label="إرسال"
                  className="size-10 rounded-full bg-blue-600 px-0 text-[0px] hover:bg-blue-700"
                  disabled={
                    !draft.trim() ||
                    isSending ||
                    !conversation ||
                    isConversationBlocked
                  }
                  onPointerDown={(event) => event.preventDefault()}
                  type="submit"
                >
                  <Send className="size-4" />
                  إرسال
                </Button>
              </div>
            </form>
          </section>

          <aside className="hidden h-fit gap-4 px-1 py-3 lg:grid">
            <div className="flex items-start gap-3">
              {displayListing && conversationListingHref ? (
                <Link
                  href={conversationListingHref}
                  className="size-20 shrink-0 overflow-hidden rounded-md transition hover:opacity-85 active:scale-95"
                >
                  <ListingCardImage
                    alt={displayListing.title ?? 'صورة الإعلان'}
                    className="size-full object-cover"
                    fallback={
                      <img
                        alt="صورة الإعلان"
                        className="size-full object-cover"
                        decoding="async"
                        loading="lazy"
                        src={missingListingImageDataUrl}
                      />
                    }
                    height={80}
                    sizes="80px"
                    src={getListingImage(displayListing)}
                    width={80}
                  />
                </Link>
              ) : (
                <img
                  alt="صورة الإعلان"
                  className="size-20 shrink-0 rounded-md object-cover"
                  decoding="async"
                  loading="lazy"
                  src={missingListingImageDataUrl}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  <Megaphone className="size-4" />
                  الإعلان
                </div>
                {displayListing && conversationListingHref ? (
                  <Link
                    href={conversationListingHref}
                    className="line-clamp-2 text-sm font-bold leading-6 transition hover:text-blue-600"
                  >
                    {displayListing.title ?? 'إعلان غير متاح'}
                  </Link>
                ) : (
                  <h2 className="line-clamp-2 text-sm font-bold leading-6">
                    إعلان غير متاح
                  </h2>
                )}
                <p className="mt-1 text-sm font-bold text-blue-700">
                  {formatPrice(displayListing?.price)}
                </p>
                {displayListing && !conversationListingHref && (
                  <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {unavailableListingLabel}
                  </p>
                )}
                <p className="mt-1 text-sm text-muted-foreground">
                  {displayListing?.city ?? 'السعودية'}
                </p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
