export type MemoryJsonCacheOptions = {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export function createMemoryJsonCache<T>({
  ttlMs,
  maxEntries = 100,
  now = Date.now,
}: MemoryJsonCacheOptions) {
  const entries = new Map<string, CacheEntry<T>>();

  function get(key: string) {
    const entry = entries.get(key);

    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return null;
    }

    return entry.value;
  }

  function set(key: string, value: T) {
    if (ttlMs <= 0 || maxEntries <= 0) {
      return;
    }

    if (entries.size >= maxEntries && !entries.has(key)) {
      const oldestKey = entries.keys().next().value;

      if (oldestKey) {
        entries.delete(oldestKey);
      }
    }

    entries.set(key, {
      expiresAt: now() + ttlMs,
      value,
    });
  }

  function clear() {
    entries.clear();
  }

  return {
    clear,
    get,
    set,
    size: () => entries.size,
  };
}
