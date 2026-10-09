'use client';

type CachedPagePayload<T> = {
  savedAt: number;
  value: T;
};

const defaultMaxAgeMs = 10 * 60 * 1000;

export function readClientPageCache<T>(
  key: string,
  maxAgeMs = defaultMaxAgeMs,
): T | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(key);

    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<CachedPagePayload<T>>;

    if (
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > maxAgeMs ||
      !('value' in parsed)
    ) {
      window.localStorage.removeItem(key);
      return null;
    }

    return parsed.value as T;
  } catch {
    window.localStorage.removeItem(key);
    return null;
  }
}

export function writeClientPageCache<T>(key: string, value: T) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAt: Date.now(),
        value,
      } satisfies CachedPagePayload<T>),
    );
  } catch {
    // Storage can be unavailable in private or low-space WebView sessions.
  }
}
