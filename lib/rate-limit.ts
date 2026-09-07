const rateLimitWindowMs = 60_000;
const maxRequestsPerWindow = 20;
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function checkMemoryRateLimit(clientId: string) {
  const now = Date.now();

  for (const [bucketClientId, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(bucketClientId);
    }
  }

  const bucket = memoryBuckets.get(clientId);

  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(clientId, {
      count: 1,
      resetAt: now + rateLimitWindowMs,
    });

    return null;
  }

  if (bucket.count >= maxRequestsPerWindow) {
    return Math.ceil((bucket.resetAt - now) / 1000);
  }

  bucket.count += 1;
  return null;
}

async function checkRedisRateLimit(clientId: string) {
  const config = getRedisConfig();

  if (!config) {
    return null;
  }

  const windowSeconds = Math.ceil(rateLimitWindowMs / 1000);
  const windowId = Math.floor(Date.now() / rateLimitWindowMs);
  const key = `rate-limit:chat:${clientId}:${windowId}`;
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, windowSeconds + 5],
    ]),
  });

  if (!response.ok) {
    throw new Error(`Redis rate limit failed with ${response.status}.`);
  }

  const results = (await response.json()) as Array<{ result?: unknown }>;
  const count = Number(results[0]?.result);

  if (Number.isFinite(count) && count > maxRequestsPerWindow) {
    const nextWindowAt = (windowId + 1) * rateLimitWindowMs;

    return Math.max(1, Math.ceil((nextWindowAt - Date.now()) / 1000));
  }

  return null;
}

export async function checkChatRateLimit(clientId: string) {
  if (process.env.SMARTSTORE_RATE_LIMIT_BACKEND === 'redis' || getRedisConfig()) {
    try {
      const retryAfterSeconds = await checkRedisRateLimit(clientId);

      if (retryAfterSeconds !== null) {
        return retryAfterSeconds;
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(`[chat_rate_limit] redis_failure=${errorName}`);
    }
  }

  return checkMemoryRateLimit(clientId);
}
