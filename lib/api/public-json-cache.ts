import { fetchWithTimeout } from './fetch-timeout';

const maxMemoryEntries = 500;
const memoryEntries = new Map<
  string,
  {
    expiresAt: number;
    value: unknown;
  }
>();

function getFromMemory<T>(key: string) {
  const entry = memoryEntries.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryEntries.delete(key);
    return null;
  }

  return entry.value as T;
}

function setInMemory(key: string, value: unknown, ttlSeconds: number) {
  if (ttlSeconds <= 0 || maxMemoryEntries <= 0) {
    return;
  }

  if (memoryEntries.size >= maxMemoryEntries && !memoryEntries.has(key)) {
    const oldestKey = memoryEntries.keys().next().value;

    if (oldestKey) {
      memoryEntries.delete(oldestKey);
    }
  }

  memoryEntries.set(key, {
    expiresAt: Date.now() + ttlSeconds * 1000,
    value,
  });
}

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function getRedisTimeoutMs() {
  const rawValue = process.env.SMARTSTORE_PUBLIC_CACHE_REDIS_TIMEOUT_MS?.trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : 1_500;

  if (!Number.isFinite(parsedValue)) {
    return 1_500;
  }

  return Math.min(Math.max(parsedValue, 250), 5_000);
}

async function runRedisPipeline(commands: unknown[][]) {
  const config = getRedisConfig();

  if (!config) {
    return null;
  }

  const response = await fetchWithTimeout(
    `${config.url}/pipeline`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
    },
    getRedisTimeoutMs(),
  );

  if (!response.ok) {
    throw new Error(`Redis public cache failed with ${response.status}.`);
  }

  return (await response.json()) as Array<{ result?: unknown }>;
}

async function getFromRedis<T>(key: string) {
  try {
    const results = await runRedisPipeline([['GET', key]]);
    const cachedValue = results?.[0]?.result;

    if (typeof cachedValue !== 'string') {
      return null;
    }

    return JSON.parse(cachedValue) as T;
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[public_json_cache] get_failure=${errorName}`);
    return null;
  }
}

async function setInRedis(key: string, value: unknown, ttlSeconds: number) {
  try {
    await runRedisPipeline([
      ['SET', key, JSON.stringify(value), 'EX', Math.max(1, ttlSeconds)],
    ]);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    console.warn(`[public_json_cache] set_failure=${errorName}`);
  }
}

export function createPublicCacheHeaders({
  browserMaxAgeSeconds = 0,
  edgeMaxAgeSeconds,
  staleWhileRevalidateSeconds,
}: {
  browserMaxAgeSeconds?: number;
  edgeMaxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
}) {
  return {
    'Cache-Control': [
      'public',
      `max-age=${browserMaxAgeSeconds}`,
      `s-maxage=${edgeMaxAgeSeconds}`,
      `stale-while-revalidate=${staleWhileRevalidateSeconds}`,
    ].join(', '),
  } as const;
}

export async function getOrSetPublicJsonCache<T>(
  key: string,
  {
    ttlSeconds,
    load,
  }: {
    ttlSeconds: number;
    load: () => Promise<T>;
  },
) {
  const redisValue = await getFromRedis<T>(key);

  if (redisValue !== null) {
    return redisValue;
  }

  const memoryValue = getFromMemory<T>(key);

  if (memoryValue !== null) {
    return memoryValue;
  }

  const value = await load();

  setInMemory(key, value, ttlSeconds);
  await setInRedis(key, value, ttlSeconds);

  return value;
}
