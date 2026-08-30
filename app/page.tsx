'use client';
/* eslint-disable @next/next/no-img-element */

import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';
import {
  Check,
  Gift,
  Laptop,
  History,
  type LucideIcon,
  Scale,
  Settings,
  Smartphone,
  X,
  SquarePen,
  Trash2,
} from 'lucide-react';

import {
  Conversation,
  ConversationContent,
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
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@chat-elements/prompt-input';
import { SearchStatusIndicator } from '@/components/search-status-indicator';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui/tooltip';
import { appCopy, type AppLanguage } from './i18n';

type CountryCode = 'SA' | 'AE' | 'KW' | 'QA' | 'BH' | 'OM' | 'EG' | 'JO';

type LocationSettings = {
  country: CountryCode;
  city: string;
  currency: string;
  language: AppLanguage;
};

type ChatHistoryItem = {
  id: string;
  title: string;
  messages: UIMessage[];
  updatedAt: number;
};

type QuickPrompt = {
  icon: LucideIcon;
};

const chatHistoryStorageKey = 'smartstore-chat-history';
const activeChatStorageKey = 'smartstore-active-chat-id';
const maxSavedChats = 20;
const initialChatId = 'draft-chat';

const countryOptions: Array<{
  code: CountryCode;
  name: string;
  currency: string;
  defaultCity: string;
}> = [
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', defaultCity: 'Riyadh' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', defaultCity: 'Dubai' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', defaultCity: 'Kuwait City' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', defaultCity: 'Doha' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', defaultCity: 'Manama' },
  { code: 'OM', name: 'Oman', currency: 'OMR', defaultCity: 'Muscat' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', defaultCity: 'Cairo' },
  { code: 'JO', name: 'Jordan', currency: 'JOD', defaultCity: 'Amman' },
];

const currencyOptions = ['SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'EGP', 'JOD', 'USD'];

const defaultLocationSettings: LocationSettings = {
  country: 'SA',
  city: 'Riyadh',
  currency: 'SAR',
  language: 'ar',
};

const quickPrompts: QuickPrompt[] = [
  { icon: Smartphone },
  { icon: Scale },
  { icon: Laptop },
  { icon: Gift },
];

function createConversationId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCountryOption(country: CountryCode) {
  return (
    countryOptions.find((option) => option.code === country) ??
    countryOptions[0]
  );
}

function isCountryCode(value: unknown): value is CountryCode {
  return countryOptions.some((option) => option.code === value);
}

function readStoredLocationSettings(): LocationSettings {
  if (typeof window === 'undefined') {
    return defaultLocationSettings;
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem('smartstore-location') ?? '',
    ) as Partial<LocationSettings>;
    const country: CountryCode = isCountryCode(parsed.country)
      ? parsed.country
      : defaultLocationSettings.country;
    const countryOption = getCountryOption(country);

    return {
      country,
      city:
        typeof parsed.city === 'string' && parsed.city.trim()
          ? parsed.city.trim()
          : countryOption.defaultCity,
      currency:
        typeof parsed.currency === 'string' && parsed.currency.trim()
          ? parsed.currency.trim().toUpperCase()
          : countryOption.currency,
      language: parsed.language === 'en' ? 'en' : 'ar',
    };
  } catch {
    return defaultLocationSettings;
  }
}

function saveLocationSettings(settings: LocationSettings) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem('smartstore-location', JSON.stringify(settings));
  }
}

function isTextPart(part: unknown): part is { type: 'text'; text: string } {
  return (
    typeof part === 'object' &&
    part !== null &&
    'type' in part &&
    'text' in part &&
    (part as { type?: unknown }).type === 'text' &&
    typeof (part as { text?: unknown }).text === 'string'
  );
}

function getMessageText(message: UIMessage) {
  return message.parts.filter(isTextPart).map((part) => part.text).join(' ');
}

function createChatTitle(messages: UIMessage[], fallbackTitle: string) {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const text = firstUserMessage ? getMessageText(firstUserMessage).trim() : '';

  if (!text) {
    return fallbackTitle;
  }

  return text.length > 42 ? `${text.slice(0, 42)}...` : text;
}

function isChatHistoryItem(value: unknown): value is ChatHistoryItem {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<ChatHistoryItem>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.updatedAt === 'number' &&
    Array.isArray(candidate.messages)
  );
}

function readChatHistory(): ChatHistoryItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(chatHistoryStorageKey) ?? '[]',
    ) as unknown;

    return Array.isArray(parsed) ? parsed.filter(isChatHistoryItem) : [];
  } catch {
    return [];
  }
}

function saveChatHistory(history: ChatHistoryItem[]) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(
      chatHistoryStorageKey,
      JSON.stringify(history.slice(0, maxSavedChats)),
    );
  }
}

function readActiveChatId() {
  if (typeof window === 'undefined') {
    return initialChatId;
  }

  return window.localStorage.getItem(activeChatStorageKey) ?? createConversationId();
}

function saveActiveChatId(id: string) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(activeChatStorageKey, id);
  }
}

function formatHistoryTime(timestamp: number, language: AppLanguage) {
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-SA' : 'en-US', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

function renderMessageParts(parts: UIMessage['parts']): ReactNode[] {
  return parts.flatMap((part, index) => {
    if (part.type === 'text') {
      return [<MessageResponse key={`text-${index}`}>{part.text}</MessageResponse>];
    }

    if (part.type === 'file') {
      return [<MessageAttachment key={`file-${index}`} data={part} />];
    }

    return [];
  });
}

function ErrorDisplay({ message }: { message: string }) {
  return <div className="error-message">{message}</div>;
}

export default function Page() {
  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
  });
  const [locationSettings, setLocationSettings] = useState<LocationSettings>(
    defaultLocationSettings,
  );
  const [chatHistory, setChatHistory] = useState<ChatHistoryItem[]>([]);
  const [activeChatId, setActiveChatId] = useState(initialChatId);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const language = locationSettings.language;
  const copy = appCopy[language];
  const pageDirection = copy.direction;

  const localizedQuickPrompts = useMemo(
    () =>
      copy.quickPrompts.map((item, index) => ({
        ...item,
        icon: quickPrompts[index]?.icon ?? Smartphone,
      })),
    [copy],
  );

  const filteredMessages = useMemo(
    () => messages.filter((message) => message.role !== 'system'),
    [messages],
  );

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const storedLocationSettings = readStoredLocationSettings();
      const storedChatHistory = readChatHistory();
      const storedActiveChatId = readActiveChatId();
      const activeChat = storedChatHistory.find(
        (item) => item.id === storedActiveChatId,
      );

      setLocationSettings(storedLocationSettings);
      setChatHistory(storedChatHistory);
      setActiveChatId(storedActiveChatId);

      if (activeChat) {
        setMessages(activeChat.messages);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [setMessages]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = pageDirection;
  }, [language, pageDirection]);

  useEffect(() => {
    if (!isMobileHistoryOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileHistoryOpen]);

  useEffect(() => {
    if (!filteredMessages.length) {
      return;
    }

    const historyItem: ChatHistoryItem = {
      id: activeChatId,
      title: createChatTitle(filteredMessages, copy.fallbackChatTitle),
      messages: filteredMessages,
      updatedAt: Date.now(),
    };

    const frame = window.requestAnimationFrame(() => {
      setChatHistory((currentHistory) => {
        const nextHistory = [
          historyItem,
          ...currentHistory.filter((item) => item.id !== activeChatId),
        ].slice(0, maxSavedChats);

        saveChatHistory(nextHistory);
        saveActiveChatId(activeChatId);
        return nextHistory;
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeChatId, copy.fallbackChatTitle, filteredMessages]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
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

      void sendMessage({
        text,
        files,
      }, {
        body: { locationSettings },
      });
    },
    [locationSettings, sendMessage],
  );

  const isLoading = status === 'streaming' || status === 'submitted';

  const handleQuickPrompt = useCallback(
    (prompt: string) => {
      if (isLoading) {
        return;
      }

      void sendMessage(
        { text: prompt },
        {
          body: { locationSettings },
        },
      );
    },
    [isLoading, locationSettings, sendMessage],
  );

  const handleNewChat = useCallback(() => {
    const nextChatId = createConversationId();
    saveActiveChatId(nextChatId);
    setActiveChatId(nextChatId);
    setMessages([]);
    setIsMobileHistoryOpen(false);
  }, [setMessages]);

  const handleSelectChat = useCallback(
    (historyItem: ChatHistoryItem) => {
      saveActiveChatId(historyItem.id);
      setActiveChatId(historyItem.id);
      setMessages(historyItem.messages);
      setIsMobileHistoryOpen(false);
    },
    [setMessages],
  );

  const handleDeleteChat = useCallback(
    (chatId: string) => {
      setChatHistory((currentHistory) => {
        const nextHistory = currentHistory.filter((item) => item.id !== chatId);
        saveChatHistory(nextHistory);
        return nextHistory;
      });

      if (chatId === activeChatId) {
        const nextChatId = createConversationId();
        saveActiveChatId(nextChatId);
        setActiveChatId(nextChatId);
        setMessages([]);
      }

      setIsMobileHistoryOpen(false);
    },
    [activeChatId, setMessages],
  );

  const handleClearHistory = useCallback(() => {
    if (!window.confirm(copy.clearHistoryConfirm)) {
      return;
    }

    const nextChatId = createConversationId();
    saveChatHistory([]);
    saveActiveChatId(nextChatId);
    setChatHistory([]);
    setActiveChatId(nextChatId);
    setMessages([]);
    setIsMobileHistoryOpen(false);
  }, [copy.clearHistoryConfirm, setMessages]);

  const updateLocationSettings = useCallback((settings: LocationSettings) => {
    saveLocationSettings(settings);
    setLocationSettings(settings);
  }, []);

  const handleCountryChange = useCallback(
    (value: string) => {
      const country = value as CountryCode;
      const nextCountry = getCountryOption(country);

      updateLocationSettings({
        ...locationSettings,
        country,
        city: nextCountry.defaultCity,
        currency: nextCountry.currency,
      });
    },
    [locationSettings, updateLocationSettings],
  );

  const handleCityChange = useCallback(
    (value: string) => {
      updateLocationSettings({ ...locationSettings, city: value });
    },
    [locationSettings, updateLocationSettings],
  );

  const handleCurrencyChange = useCallback(
    (value: string) => {
      updateLocationSettings({
        ...locationSettings,
        currency: value.toUpperCase(),
      });
    },
    [locationSettings, updateLocationSettings],
  );

  const handleLanguageChange = useCallback(
    (value: string) => {
      updateLocationSettings({
        ...locationSettings,
        language: value === 'en' ? 'en' : 'ar',
      });
    },
    [locationSettings, updateLocationSettings],
  );

  const historyPanel = (
    <>
      <div className="chat-history-header">
        <div className="chat-history-title">{copy.historyTitle}</div>
        {chatHistory.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="chat-history-clear"
                onClick={handleClearHistory}
                aria-label={copy.clearHistory}
              >
                <Trash2 className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{copy.clearHistory}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {chatHistory.length ? (
        <div className="chat-history-list">
          {chatHistory.map((historyItem) => (
            <div
              key={historyItem.id}
              className="chat-history-item"
              data-active={historyItem.id === activeChatId}
            >
              <button
                type="button"
                className="chat-history-item-main"
                onClick={() => handleSelectChat(historyItem)}
              >
                <span className="chat-history-item-title">
                  {historyItem.title}
                </span>
                <span className="chat-history-item-time">
                  {formatHistoryTime(historyItem.updatedAt, language)}
                </span>
              </button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="chat-history-delete"
                    onClick={() => handleDeleteChat(historyItem.id)}
                    aria-label={copy.deleteChat}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{copy.deleteChat}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      ) : (
        <div className="chat-history-empty">{copy.historyEmpty}</div>
      )}
    </>
  );

  return (
    <div className="chat-container" dir={pageDirection}>
      <aside className="chat-sidebar">
        <div className="chat-sidebar-brand">
          <div className="chat-brand-mark">
            <img
              alt={copy.imageAlt}
              className="h-full w-full object-cover"
              src="/smartstore-mark.png"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">SmartStore AI</div>
            <div className="truncate text-xs text-muted-foreground">
              {copy.assistantLabel}
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          className="chat-new-button"
          onClick={handleNewChat}
          disabled={isLoading}
        >
          <SquarePen className="size-4" />
          {copy.newChat}
        </Button>

        <div className="chat-history">{historyPanel}</div>
      </aside>

      <main className="chat-main">
        <header className="chat-top-header">
          <Button
            variant="ghost"
            size="icon"
            className="chat-mobile-new-chat"
            onClick={handleNewChat}
            disabled={isLoading}
            aria-label={copy.newChat}
          >
            <SquarePen className="size-5" />
          </Button>

          <div className="chat-mobile-brand">
            <span>SmartStore AI</span>
          </div>

          <div className="chat-header-actions">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="chat-mobile-history"
                  onClick={() => setIsMobileHistoryOpen(true)}
                  aria-label={copy.historyTitle}
                >
                  <History className="size-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{copy.historyTitle}</p>
              </TooltipContent>
            </Tooltip>

            <Dialog>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label={copy.settings}>
                      <Settings className="size-5" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{copy.settings}</p>
                </TooltipContent>
              </Tooltip>

              <DialogContent className="sm:max-w-md" dir={pageDirection}>
                <DialogHeader>
                  <DialogTitle>{copy.settings}</DialogTitle>
                  <DialogDescription>
                    {copy.settingsDescription}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                  <label className="grid gap-2 text-sm font-medium">
                    {copy.country}
                    <Select value={locationSettings.country} onValueChange={handleCountryChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {countryOptions.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {copy.countries[option.code]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="grid gap-2 text-sm font-medium">
                    {copy.city}
                    <input
                      value={locationSettings.city}
                      onChange={(event) => handleCityChange(event.target.value)}
                      className="location-input"
                      placeholder="Riyadh"
                    />
                  </label>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium">
                      {copy.currency}
                      <Select
                        value={locationSettings.currency}
                        onValueChange={handleCurrencyChange}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {currencyOptions.map((currency) => (
                            <SelectItem key={currency} value={currency}>
                              {currency}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>

                    <label className="grid gap-2 text-sm font-medium">
                      {copy.language}
                      <Select
                        value={locationSettings.language}
                        onValueChange={handleLanguageChange}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ar">{copy.arabic}</SelectItem>
                          <SelectItem value="en">{copy.english}</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>

                  <div className="location-confirmation">
                    <Check className="size-4" />
                    <span>{copy.savedLocally}</span>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <ThemeToggle language={language} />
          </div>
        </header>

        <div className="chat-body">
          <Conversation>
            <ConversationContent className="chat-conversation-content">
              {filteredMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-mark">
                    <img
                      alt={copy.imageAlt}
                      className="h-10 w-10"
                      src="/smartstore-mark.png"
                    />
                  </div>
                  <div className="chat-empty-copy">
                    <h2>{copy.emptyTitle}</h2>
                    <p>{copy.emptyDescription}</p>
                  </div>
                  <div className="quick-prompt-grid">
                    {localizedQuickPrompts.map((item) => (
                      <button
                        type="button"
                        key={item.title}
                        className="quick-prompt-card"
                        onClick={() => handleQuickPrompt(item.prompt)}
                        disabled={isLoading}
                      >
                        <span className="quick-prompt-icon">
                          <item.icon className="size-5" />
                        </span>
                        <span>{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {filteredMessages.map((message, messageIndex) => (
                    <Message key={`${message.id}-${messageIndex}`} from={message.role}>
                      <MessageContent>{renderMessageParts(message.parts)}</MessageContent>
                    </Message>
                  ))}
                  {isLoading && (
                    <Message from="assistant">
                      <MessageContent>
                        <SearchStatusIndicator language={language} mode="thinking" />
                      </MessageContent>
                    </Message>
                  )}
                  {error && <ErrorDisplay message={error.message} />}
                </>
              )}
            </ConversationContent>
          </Conversation>
        </div>

        {isMobileHistoryOpen && (
          <div className="chat-mobile-history-overlay" role="dialog" aria-modal="true" aria-label={copy.historyTitle}>
            <button
              type="button"
              className="chat-mobile-history-backdrop"
              aria-label={copy.close}
              onClick={() => setIsMobileHistoryOpen(false)}
            />
            <section className="chat-mobile-history-sheet" dir={pageDirection}>
              <div className="chat-mobile-history-sheet-header">
                <div>
                  <div className="chat-mobile-history-sheet-title">{copy.historyTitle}</div>
                  <div className="chat-mobile-history-sheet-subtitle">{copy.assistantLabel}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="chat-mobile-history-close"
                  onClick={() => setIsMobileHistoryOpen(false)}
                  aria-label={copy.close}
                >
                  <X className="size-5" />
                </Button>
              </div>
              <div className="chat-history chat-history-panel">
                {historyPanel}
              </div>
            </section>
          </div>
        )}

        <div className="chat-input-wrapper">
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder={copy.inputPlaceholder} />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputSubmit status={status} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </main>
    </div>
  );
}


