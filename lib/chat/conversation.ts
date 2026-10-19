export function parseChatConversationId(value: unknown): string | null {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value)
    ? value : null;
}

export function scopeChatSearchOwnerKey(ownerKey: string, conversationId?: string) {
  return conversationId ? `chat:${conversationId}:${ownerKey}` : ownerKey;
}
