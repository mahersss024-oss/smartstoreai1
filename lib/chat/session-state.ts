let ownerId: string | null = null;
let snapshot: unknown = null;

export function setChatSessionOwner(nextOwnerId: string | null) {
  if (nextOwnerId !== ownerId) {
    ownerId = nextOwnerId;
    snapshot = null;
  }
}

export function readChatSessionState<T>(expectedOwnerId: string | null): T | null {
  return expectedOwnerId && expectedOwnerId === ownerId ? snapshot as T | null : null;
}

export function writeChatSessionState<T>(expectedOwnerId: string | null, state: T) {
  if (expectedOwnerId && expectedOwnerId === ownerId) snapshot = state;
}

export function clearChatSessionState() {
  snapshot = null;
}
