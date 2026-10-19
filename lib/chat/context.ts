import type { UIMessage } from 'ai';

export const chatContextMessageLimit = 40;
export const chatContextTextLimit = 24_000;

export function chatMessageTextLength(message: unknown): number {
  if (!message || typeof message !== 'object') return 0;
  const { content, parts } = message as { content?: unknown; parts?: unknown };
  return (typeof content === 'string' ? content.length : 0) +
    (Array.isArray(parts) ? parts.reduce((total, part) => total +
      (part?.type === 'text' && typeof part.text === 'string' ? part.text.length : 0), 0) : 0);
}

// Keep complete recent turns. Earlier images are supplied separately by explicit reference.
export function selectChatContext<T extends { role?: unknown }>(messages: T[]): T[] {
  const latestUserIndex = messages.findLastIndex(message => message.role === 'user');
  const selected: T[] = [];
  let textLength = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const rawParts = (message as T & { parts?: UIMessage['parts'] }).parts;
    const parts = Array.isArray(rawParts) ? rawParts : undefined;
    const textParts = parts?.filter(part => part?.type !== 'file');
    const candidate = index !== latestUserIndex && Array.isArray(parts)
      ? { ...message, parts: parts.some(part => part?.type === 'file')
        ? [...textParts!, { type: 'text', text: `Earlier image attachment reference: ${(message as T & { id?: string }).id ?? 'unavailable'}` }]
        : textParts } : message;
    const length = chatMessageTextLength(candidate);
    if (selected.length && (selected.length >= chatContextMessageLimit || textLength + length > chatContextTextLimit)) break;
    selected.unshift(candidate);
    textLength += length;
  }
  while (selected.length && selected[0].role !== 'user') selected.shift();
  return selected;
}
