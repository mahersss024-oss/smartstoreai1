import { createAgentUIStreamResponse } from 'ai';

import { chatAgent } from '@/agent/chat-agent';

const maxMessagesPerRequest = 40;
const maxTextCharactersPerRequest = 24_000;

function hasDeepseekApiKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
}

type ChatRequestBody = {
  messages: Array<unknown>;
  model?: string;
  locationSettings?: LocationSettings;
  data?: {
    model?: string;
    [key: string]: unknown;
  };
};

type ChatMessage = {
  role?: unknown;
  content?: unknown;
  parts?: unknown;
};

type LocationSettings = {
  country?: unknown;
  city?: unknown;
  currency?: unknown;
  language?: unknown;
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

function countMessageCharacters(message: unknown) {
  if (!isChatMessage(message)) {
    return 0;
  }

  return countTextCharacters(message.content) + countTextCharacters(message.parts);
}

function cleanString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildLocationSystemMessage(settings: LocationSettings | undefined) {
  const country = cleanString(settings?.country);
  const city = cleanString(settings?.city);
  const currency = cleanString(settings?.currency);
  const language = cleanString(settings?.language);

  if (!country && !city && !currency && !language) {
    return undefined;
  }

  return {
    id: 'location-context',
    role: 'system',
    parts: [
      {
        type: 'text',
        text: `User shopping region context: country=${country ?? 'unknown'}, city=${city ?? 'unknown'}, currency=${currency ?? 'unknown'}, preferred language=${language ?? 'unknown'}. Use this to tailor general shopping guidance, suggested regions, currencies, and future provider choices. Product data fetching remains disabled.`,
      },
    ],
  };
}

export async function POST(request: Request) {
  if (!hasDeepseekApiKey()) {
    return new Response(
      'DEEPSEEK_API_KEY is missing. Add it to your Render environment variables and redeploy.',
      { status: 500 },
    );
  }

  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return new Response('Invalid JSON body.', { status: 400 });
  }

  const { messages = [] } = body;

  if (!Array.isArray(messages)) {
    return new Response('Invalid request body.', { status: 400 });
  }

  if (messages.length > maxMessagesPerRequest) {
    return new Response('Too many messages in one request.', { status: 413 });
  }

  const totalTextCharacters = messages.reduce<number>(
    (total, message) => total + countMessageCharacters(message),
    0,
  );

  if (totalTextCharacters > maxTextCharactersPerRequest) {
    return new Response('Message is too long.', { status: 413 });
  }

  // Filter out empty assistant messages rejected by some model APIs.
  const filteredMessages = messages.filter((message) => {
    if (isChatMessage(message) && message.role === 'assistant') {
      return hasChatMessagePayload(message);
    }

    return true;
  });

  const locationSystemMessage = buildLocationSystemMessage(body.locationSettings);
  const messagesWithContext = locationSystemMessage
    ? [locationSystemMessage, ...filteredMessages]
    : filteredMessages;

  return createAgentUIStreamResponse({
    agent: chatAgent,
    messages: messagesWithContext,
  });
}
