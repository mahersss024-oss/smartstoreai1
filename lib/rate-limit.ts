const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

type RateLimitInput = {
  namespace: string;
  clientId: string;
  maxRequests?: number;
  windowMs?: number;
};

function getRedisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

function getBucketKey(input: RateLimitInput) {
  return `${input.namespace}:${input.clientId}`;
}

function checkMemoryRateLimit(input: Required<RateLimitInput>) {
  const now = Date.now();
  const bucketKey = getBucketKey(input);

  for (const [bucketClientId, bucket] of memoryBuckets) {
    if (bucket.resetAt <= now) {
      memoryBuckets.delete(bucketClientId);
    }
  }

  const bucket = memoryBuckets.get(bucketKey);

  if (!bucket || bucket.resetAt <= now) {
    memoryBuckets.set(bucketKey, {
      count: 1,
      resetAt: now + input.windowMs,
    });

    return null;
  }

  if (bucket.count >= input.maxRequests) {
    return Math.ceil((bucket.resetAt - now) / 1000);
  }

  bucket.count += 1;
  return null;
}

async function checkRedisRateLimit(input: Required<RateLimitInput>) {
  const config = getRedisConfig();

  if (!config) {
    return null;
  }

  const windowSeconds = Math.ceil(input.windowMs / 1000);
  const windowId = Math.floor(Date.now() / input.windowMs);
  const key = `rate-limit:${input.namespace}:${input.clientId}:${windowId}`;
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

  if (Number.isFinite(count) && count > input.maxRequests) {
    const nextWindowAt = (windowId + 1) * input.windowMs;

    return Math.max(1, Math.ceil((nextWindowAt - Date.now()) / 1000));
  }

  return null;
}

export async function checkRateLimit(input: RateLimitInput) {
  const normalizedInput: Required<RateLimitInput> = {
    namespace: input.namespace,
    clientId: input.clientId,
    maxRequests: input.maxRequests ?? 20,
    windowMs: input.windowMs ?? 60_000,
  };

  if (process.env.SMARTSTORE_RATE_LIMIT_BACKEND === 'redis' || getRedisConfig()) {
    try {
      const retryAfterSeconds = await checkRedisRateLimit(normalizedInput);

      if (retryAfterSeconds !== null) {
        return retryAfterSeconds;
      }
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.warn(
        `[rate_limit] namespace=${normalizedInput.namespace} redis_failure=${errorName}`,
      );
    }
  }

  return checkMemoryRateLimit(normalizedInput);
}

export async function checkChatRateLimit(clientId: string) {
  return checkRateLimit({
    namespace: 'chat',
    clientId,
    maxRequests: 20,
    windowMs: 60_000,
  });
}
