import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from 'ai';
import { getDeepseekApiKey } from '@/agent/deepseek-provider';
import { defaultMaxListingImages } from '@/agent/marketplace/listing-image-limits';
import type { UploadedListingImage } from '@/agent/marketplace/listing-image-storage';
import { getAuthRequiredResponse } from '@/agent/marketplace/policy';
import { dataUrlToBytes } from '@/agent/vision-messages';
import { getRequestContentLength, rejectOversizedRequest } from '@/lib/api/request-size';
import { getAuthSession } from '@/lib/auth/session';
import { chatServiceUnavailableMessage, getHamadCustomerReply } from '@/lib/chat-response-safety';
import { reserveChatGeneration } from '@/lib/chat/admission';
import { selectChatContext, buildHamadHistory, getChatMessageText, type ChatInputMessage } from '@/lib/chat/context';
import { parseChatConversationId } from '@/lib/chat/conversation';
import { hamadDraftActionSchema } from '@/lib/chat/hamad-structured-state';
import { runStructuredHamadTurn } from '@/lib/chat/hamad-structured-turn';
import { safeHamadStructuredReply } from '@/lib/chat/hamad-structured-model';
import { aiConsentRequiredResponse, hasAiSharingConsent } from '@/lib/platform/ai-consent';
import { checkChatRateLimit } from '@/lib/rate-limit';

const maxMessagesPerRequest = 40;
const maxTextCharactersPerRequest = 24_000;
const maxImagesPerChatMessage = defaultMaxListingImages;
const maxChatImageBytes = 12 * 1024 * 1024;
const maxChatRequestBytes = 140 * 1024 * 1024;
const supportedChatImageMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

type ChatRequestBody = {
  messages: Array<unknown>;
  retainedListingImages?: unknown;
  retainedListingImageMessageId?: unknown;
  creationMethod?: unknown;
  beginDraftWithHamad?: unknown;
  resetDraftContext?: unknown;
  chatOwnerId?: unknown;
  chatConversationId?: unknown;
  hamadDraftCards?: unknown;
  hamadDraftAction?: unknown;
};

type ChatMessage = ChatInputMessage;

type ChatFilePart = {
  type: string;
  mediaType?: unknown;
  url?: unknown;
  data?: unknown;
  filename?: unknown;
};

function isChatMessage(message: unknown): message is ChatMessage {
  return typeof message === 'object' && message !== null;
}

function hasMessageContent(content: unknown) {
  return (
    (Array.isArray(content) && content.length > 0) ||
    (typeof content === 'string' && content.trim().length > 0)
  );
}

function isTextPart(part: unknown): part is { type: string; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    'text' in part &&
    typeof (part as { type?: unknown }).type === 'string' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function isFilePart(part: unknown): part is ChatFilePart {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    (part as { type?: unknown }).type === 'file'
  );
}

function hasMessageParts(parts: unknown) {
  if (!Array.isArray(parts)) {
    return false;
  }

  return parts.some((part) => {
    if (isTextPart(part)) {
      return part.text.trim().length > 0;
    }

    return typeof part === 'object' && part !== null;
  });
}

function hasChatMessagePayload(message: ChatMessage) {
  return hasMessageContent(message.content) || hasMessageParts(message.parts);
}

function countTextCharacters(value: unknown): number {
  if (typeof value === 'string') {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countTextCharacters(item), 0);
  }

  if (typeof value === 'object' && value !== null) {
    if (isTextPart(value)) {
      return value.text.length;
    }

    if ('text' in value && typeof (value as { text?: unknown }).text === 'string') {
      return (value as { text: string }).text.length;
    }
  }

  return 0;
}

function getDataUrlByteLength(value: string) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/i);

  if (!match) {
    return null;
  }

  const base64 = match[2].replace(/\s/g, '');
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;

  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function getFilePartPayload(part: ChatFilePart) {
  return typeof part.url === 'string'
    ? part.url
    : typeof part.data === 'string'
      ? part.data
      : undefined;
}

function getRetainedImageParts(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((part): part is ChatFilePart => {
    return (
      isFilePart(part) &&
      typeof part.mediaType === 'string' &&
      part.mediaType.startsWith('image/')
    );
  });
}

function validateRetainedListingImages(value: unknown) {
  const imageParts = getRetainedImageParts(value);

  if (imageParts.length > maxImagesPerChatMessage) {
    return 'too_many_images';
  }

  for (const part of imageParts) {
    if (
      typeof part.mediaType !== 'string' ||
      !supportedChatImageMimeTypes.has(part.mediaType)
    ) {
      return 'unsupported_image_type';
    }

    const payload = getFilePartPayload(part);
    const byteLength = payload ? getDataUrlByteLength(payload) : null;

    if (byteLength === null) {
      return 'unsupported_image_type';
    }

    if (byteLength > maxChatImageBytes) {
      return 'image_too_large';
    }
  }

  return null;
}

function extractRetainedUploadedListingImages(
  value: unknown,
): UploadedListingImage[] {
  const images: UploadedListingImage[] = [];

  for (const part of getRetainedImageParts(value)) {
    const payload = getFilePartPayload(part);
    const bytes = payload ? dataUrlToBytes(payload) : null;

    if (!bytes || !supportedChatImageMimeTypes.has(bytes.mediaType)) {
      continue;
    }

    images.push({
      data: bytes.data,
      mediaType: bytes.mediaType,
      fileName: typeof part.filename === 'string' ? part.filename : undefined,
    });
  }

  return images.slice(0, maxImagesPerChatMessage);
}

function countMessageCharacters(message: unknown) {
  if (!isChatMessage(message)) {
    return 0;
  }

  return countTextCharacters(message.content) + countTextCharacters(message.parts);
}

function createChatResponse(
  generate: () => ReturnType<typeof runStructuredHamadTurn>,
  onGenerationSettled: () => Promise<void>,
  format = safeHamadStructuredReply,
) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        try {
          const id = 'hamad-' + crypto.randomUUID();
          writer.write({ type: 'start', messageId: id, messageMetadata: {} });
          const { text, sections, ...metadata } = await generate();
          if (metadata.hamadDraftMemory || metadata.creationChoice || metadata.hamadDraftUi) {
            writer.write({ type: 'message-metadata', messageMetadata: metadata });
          }
          for (const [index, section] of (sections ?? [{ text }]).entries()) {
            const partId = index === 0 ? id : id + '-' + index;
            writer.write({ type: 'text-start', id: partId });
            writer.write({ type: 'text-delta', id: partId, delta: format(section.text) || chatServiceUnavailableMessage });
            writer.write({ type: 'text-end', id: partId });
            if (section.preview) writer.write({ type: 'file', ...section.preview });
          }
          writer.write({ type: 'finish', finishReason: 'stop' });
        } finally { await onGenerationSettled(); }
      },
      onError: () => chatServiceUnavailableMessage,
    }),
  });
}

function createTextUIResponse(text: string) {
  return createChatResponse(async () => ({ text }), async () => {}, getHamadCustomerReply);
}

function getImageValidationMessage(reason: string | null) {
  if (reason === 'too_many_images') return 'أرفق حتى 8 صور في رسالة الشات الواحدة.';
  if (reason === 'image_too_large') return 'حجم كل صورة يجب أن يكون 12 ميغابايت أو أقل.';
  if (reason) return 'أرفق صور المنتج فقط بصيغة جي بي جي أو بي إن جي أو ويب بي.';
}

export async function POST(request: Request) {
  const declaredLength = getRequestContentLength(request);
  if (declaredLength !== null && declaredLength > maxChatRequestBytes) {
    return (await rejectOversizedRequest(request, maxChatRequestBytes,
      'حجم طلب المحادثة أكبر من الحد المسموح.'))!;
  }

  const session = getAuthSession(request);
  if (!session) return createTextUIResponse(getAuthRequiredResponse('ar'));
  if (!hasAiSharingConsent(request)) return aiConsentRequiredResponse();
  const retryAfterSeconds = await checkChatRateLimit(`user:${session.user.id}`);
  if (retryAfterSeconds !== null) {
    return new Response('Too many requests. Please try again shortly.', {
      status: 429,
      headers: { 'Retry-After': retryAfterSeconds.toString() },
    });
  }

  const oversizedRequestResponse = await rejectOversizedRequest(
    request,
    maxChatRequestBytes,
    'حجم طلب المحادثة أكبر من الحد المسموح.',
  );

  if (oversizedRequestResponse) {
    return oversizedRequestResponse;
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return new Response('تعذر قراءة طلب المحادثة.', { status: 400 });
  }

  if (!body || !Array.isArray(body.messages)) {
    return new Response('طلب المحادثة غير صالح.', { status: 400 });
  }
  const messages = selectChatContext(body.messages.filter(isChatMessage));

  if (messages.length > maxMessagesPerRequest) {
    return new Response('عدد الرسائل يتجاوز الحد المسموح في الطلب الواحد.', { status: 413 });
  }

  const totalTextCharacters = messages.reduce<number>(
    (total, message) => total + countMessageCharacters(message),
    0,
  );

  if (totalTextCharacters > maxTextCharactersPerRequest) {
    return new Response('الرسالة أطول من الحد المسموح.', { status: 413 });
  }

  const filteredMessages = messages.filter((message) => message.role === 'user' ||
    (message.role === 'assistant' && hasChatMessagePayload(message)));
  const latestUserMessage = filteredMessages.findLast(message => message.role === 'user');
  const requestKey = typeof latestUserMessage?.id === 'string' && latestUserMessage.id.length <= 200 ? latestUserMessage.id : undefined;

  if (body.chatOwnerId !== undefined && body.chatOwnerId !== session.user.id) {
    return new Response('تغيّر حساب الدخول. حدّث الصفحة لبدء محادثة تخص حسابك الحالي.', { status: 409 });
  }

  const chatConversationId = parseChatConversationId(body.chatConversationId);
  if (body.chatConversationId !== undefined && !chatConversationId) {
    return new Response('معرّف المحادثة غير صالح.', { status: 400 });
  }
  if (body.creationMethod !== undefined && body.creationMethod !== 'chat') {
    return new Response('طريقة إنشاء الإعلان غير صالحة.', { status: 400 });
  }
  if (body.beginDraftWithHamad !== undefined && (typeof body.beginDraftWithHamad !== 'boolean' || (body.beginDraftWithHamad && body.creationMethod !== 'chat'))) {
    return new Response('اختيار طريقة إنشاء الإعلان غير صالح.', { status: 400 });
  }
  const draftCards = body.hamadDraftCards === true && Boolean(chatConversationId);
  const cardAction = body.hamadDraftAction === undefined ? undefined : hamadDraftActionSchema.safeParse(body.hamadDraftAction);
  if (cardAction && !draftCards) return createTextUIResponse('تعذّر فتح بطاقة المسودة. اطلب عرض المسودات في المحادثة.');
  if (cardAction?.success === false) return new Response('اختيار المسودة غير صالح.', { status: 400 });

  if (!cardAction && !getDeepseekApiKey()) {
    console.warn('[chat_config] missing_required_env=DEEPSEEK_API_KEY');
    return createTextUIResponse('تعذر إكمال رد حمد الآن. يمكنك الإنشاء اليدوي أو مراجعة مسوداتك من إعلاناتي قبل إعادة طلب الإنشاء.');
  }

  const admission = await reserveChatGeneration(session);
  if (admission.response) return admission.response;
  let streaming = false;
  try {
    const currentParts = Array.isArray(latestUserMessage?.parts) ? latestUserMessage.parts : [];
    const unsupportedFile = currentParts.some((part) => isFilePart(part) &&
      (typeof part.mediaType !== 'string' || !supportedChatImageMimeTypes.has(part.mediaType)));
    const beforeUser = latestUserMessage ? filteredMessages.slice(0, filteredMessages.lastIndexOf(latestUserMessage)) : [];
    const previousAssistant = beforeUser.findLast((message) => message.role === 'assistant');
    const metadata = previousAssistant?.metadata as { hamadDraftMemory?: unknown } | undefined;
    const creationIntake = body.beginDraftWithHamad === true ? beforeUser.findLast((message) => message.role === 'user') : undefined;
    const creationImageId = creationIntake && typeof creationIntake.id === 'string' && creationIntake.id.length <= 200
      && creationIntake.id === body.retainedListingImageMessageId && !currentParts.some(isFilePart)
      && Array.isArray(creationIntake.parts) && creationIntake.parts.some((part) => isTextPart(part)
        && part.text === 'Earlier image attachment reference: ' + creationIntake.id)
      ? creationIntake.id : undefined;
    const imageParts = creationImageId ? body.retainedListingImages : currentParts;
    const imageFailure = cardAction ? null : unsupportedFile ? 'unsupported_image_type' : validateRetainedListingImages(imageParts);
    const response = createChatResponse(() => runStructuredHamadTurn({
      session, history: buildHamadHistory(filteredMessages), request: getChatMessageText(latestUserMessage), requestKey,
      conversationId: chatConversationId, checkpoint: metadata?.hamadDraftMemory,
      draftCards, draftAction: cardAction?.data,
      creationEnabled: body.creationMethod === 'chat', reset: body.resetDraftContext === true || body.beginDraftWithHamad === true,
      creationIntake: creationIntake ? {
        text: getChatMessageText(creationIntake).slice(0, 1_200),
        id: typeof creationIntake.id === 'string' && creationIntake.id.length <= 200 ? creationIntake.id : undefined,
      } : undefined,
      validationMessage: getImageValidationMessage(imageFailure),
      currentImages: cardAction || imageFailure ? [] : extractRetainedUploadedListingImages(imageParts),
      imageSourceId: creationImageId ?? requestKey,
      retainedImages: ({ sourceId }) => sourceId === body.retainedListingImageMessageId
        && !validateRetainedListingImages(body.retainedListingImages)
        ? extractRetainedUploadedListingImages(body.retainedListingImages) : [],
      signal: request.signal,
    }), admission.release);
    streaming = true;
    return response;
  } finally { if (!streaming) await admission.release(); }
}
