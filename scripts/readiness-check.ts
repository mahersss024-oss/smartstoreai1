import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type ReadinessStatus = 'pass' | 'warn' | 'fail';

export type ReadinessCheck = {
  name: string;
  status: ReadinessStatus;
  message: string;
};

type Env = Record<string, string | undefined>;

const maxDeepseekConcurrency = 512;
const maxDeepseekQueueTimeoutMs = 60_000;
const defaultDeepseekConcurrency = 100;
const defaultDeepseekQueueLimit = 2_000;
const defaultDeepseekQueueTimeoutMs = 60_000;
const defaultObjectStorageTimeoutMs = 30_000;
const defaultRateLimitRedisTimeoutMs = 2_000;
const defaultPushTimeoutMs = 10_000;
const productionAppHosts = new Set(['www.smartstore-ai.com', 'smartstore-ai.com']);

function present(env: Env, key: string) {
  return Boolean(env[key]?.trim());
}

function pushCheck(
  checks: ReadinessCheck[],
  name: string,
  status: ReadinessStatus,
  message: string,
) {
  checks.push({ name, status, message });
}

function parseInteger(env: Env, key: string) {
  const value = Number.parseInt(env[key] ?? '', 10);

  return Number.isFinite(value) ? value : null;
}

function parseEnvFile(content: string) {
  const values: Env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');

    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    const rawValue = trimmed.slice(equalsIndex + 1).trim();
    const unquoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    values[key] = unquoted.replace(/\\n/g, '\n');
  }

  return values;
}

export function loadReadinessEnv(baseEnv: Env = process.env) {
  const merged: Env = { ...baseEnv };

  for (const fileName of ['.env', '.env.local']) {
    if (!existsSync(fileName)) {
      continue;
    }

    Object.assign(merged, parseEnvFile(readFileSync(fileName, 'utf8')), baseEnv);
  }

  return merged;
}

function getStoreMode(env: Env) {
  return env.SMARTSTORE_MARKETPLACE_STORE?.trim().toLowerCase() || 'file';
}

function getImageStorageMode(env: Env) {
  return env.SMARTSTORE_IMAGE_STORAGE?.trim().toLowerCase() || '';
}

function addRequiredEnvCheck(
  checks: ReadinessCheck[],
  env: Env,
  key: string,
  production: boolean,
  purpose: string,
) {
  if (present(env, key)) {
    pushCheck(checks, key, 'pass', `${purpose} is configured.`);
    return;
  }

  pushCheck(
    checks,
    key,
    production ? 'fail' : 'warn',
    `${purpose} is missing.`,
  );
}

function validateStore(checks: ReadinessCheck[], env: Env, production: boolean) {
  const storeMode = getStoreMode(env);

  if (storeMode === 'database') {
    pushCheck(checks, 'marketplace_store', 'pass', 'Database marketplace store is enabled.');
    addRequiredEnvCheck(checks, env, 'DATABASE_URL', true, 'Database URL');
    return;
  }

  pushCheck(
    checks,
    'marketplace_store',
    production ? 'fail' : 'warn',
    `Marketplace store is "${storeMode}", expected "database" for durable production data.`,
  );
}

function validateAuth(checks: ReadinessCheck[], env: Env, production: boolean) {
  const authSecret = env.AUTH_SECRET?.trim() ?? '';

  if (!authSecret) {
    pushCheck(
      checks,
      'AUTH_SECRET',
      production ? 'fail' : 'warn',
      'AUTH_SECRET is missing.',
    );
    return;
  }

  pushCheck(
    checks,
    'AUTH_SECRET',
    authSecret.length >= 32 ? 'pass' : production ? 'fail' : 'warn',
    authSecret.length >= 32
      ? 'AUTH_SECRET length is acceptable.'
      : 'AUTH_SECRET should be at least 32 characters.',
  );
}

function validateAppUrl(checks: ReadinessCheck[], env: Env, production: boolean) {
  const configuredUrl = env.NEXT_PUBLIC_APP_URL?.trim() ?? '';

  if (!configuredUrl) {
    pushCheck(
      checks,
      'NEXT_PUBLIC_APP_URL',
      production ? 'fail' : 'warn',
      'Application public URL is missing.',
    );
    return;
  }

  let url: URL;

  try {
    url = new URL(configuredUrl);
  } catch {
    pushCheck(
      checks,
      'NEXT_PUBLIC_APP_URL',
      'fail',
      'Application public URL is not a valid URL.',
    );
    return;
  }

  if (production) {
    const trusted =
      url.protocol === 'https:' &&
      productionAppHosts.has(url.hostname.toLowerCase());

    pushCheck(
      checks,
      'NEXT_PUBLIC_APP_URL',
      trusted ? 'pass' : 'fail',
      trusted
        ? 'Application public URL is trusted for production.'
        : 'Production application public URL must use the canonical SmartStore domain over HTTPS.',
    );
    return;
  }

  pushCheck(
    checks,
    'NEXT_PUBLIC_APP_URL',
    'pass',
    'Application public URL is configured.',
  );
}

function validateDeepseek(checks: ReadinessCheck[], env: Env, production: boolean) {
  addRequiredEnvCheck(checks, env, 'DEEPSEEK_API_KEY', production, 'DeepSeek API key');

  const concurrency =
    parseInteger(env, 'SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS') ??
    defaultDeepseekConcurrency;
  const queueLimit =
    parseInteger(env, 'SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS') ??
    defaultDeepseekQueueLimit;
  const queueTimeoutMs =
    parseInteger(env, 'SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS') ??
    defaultDeepseekQueueTimeoutMs;

  pushCheck(
    checks,
    'deepseek_concurrency',
    concurrency >= 1 && concurrency <= maxDeepseekConcurrency ? 'pass' : 'fail',
    `DeepSeek concurrency is ${concurrency}.`,
  );

  pushCheck(
    checks,
    'deepseek_queue_limit',
    queueLimit >= 0 && queueLimit <= 10_000 ? 'pass' : 'fail',
    `DeepSeek queued request limit is ${queueLimit}.`,
  );

  pushCheck(
    checks,
    'deepseek_queue_timeout',
    queueTimeoutMs >= 1_000 && queueTimeoutMs <= maxDeepseekQueueTimeoutMs
      ? 'pass'
      : 'fail',
    `DeepSeek queue timeout is ${queueTimeoutMs}ms.`,
  );
}

function validateAuthProviders(
  checks: ReadinessCheck[],
  env: Env,
  production: boolean,
) {
  addRequiredEnvCheck(checks, env, 'GOOGLE_CLIENT_ID', production, 'Google OAuth client ID');
  addRequiredEnvCheck(
    checks,
    env,
    'GOOGLE_CLIENT_SECRET',
    production,
    'Google OAuth client secret',
  );

  const appleKeys = [
    'APPLE_CLIENT_ID',
    'APPLE_TEAM_ID',
    'APPLE_KEY_ID',
    'APPLE_PRIVATE_KEY',
  ];
  const missingAppleKeys = appleKeys.filter((key) => !present(env, key));

  pushCheck(
    checks,
    'apple_oauth',
    missingAppleKeys.length === 0 ? 'pass' : 'warn',
    missingAppleKeys.length === 0
      ? 'Apple OAuth is configured.'
      : `Apple OAuth is not fully configured: ${missingAppleKeys.join(', ')}.`,
  );
}

function validateImageStorage(
  checks: ReadinessCheck[],
  env: Env,
  production: boolean,
) {
  const mode = getImageStorageMode(env);

  if (!mode) {
    pushCheck(
      checks,
      'image_storage',
      production ? 'fail' : 'warn',
      'Production listing images require object storage.',
    );
    return;
  }

  if (mode === 'cloudinary') {
    const missing = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ].filter((key) => !present(env, key));

    pushCheck(
      checks,
      'image_storage',
      missing.length ? 'fail' : 'pass',
      missing.length
        ? `Cloudinary configuration is missing: ${missing.join(', ')}.`
        : 'Cloudinary image storage is configured.',
    );
    return;
  }

  if (mode === 'object' || mode === 's3') {
    const missing = [
      'SMARTSTORE_OBJECT_STORAGE_ENDPOINT',
      'SMARTSTORE_OBJECT_STORAGE_BUCKET',
      'SMARTSTORE_OBJECT_STORAGE_ACCESS_KEY_ID',
      'SMARTSTORE_OBJECT_STORAGE_SECRET_ACCESS_KEY',
    ].filter((key) => !present(env, key));

    pushCheck(
      checks,
      'image_storage',
      missing.length ? 'fail' : 'pass',
      missing.length
        ? `S3-compatible image storage is missing: ${missing.join(', ')}.`
        : 'S3-compatible image storage is configured.',
    );
    return;
  }

  pushCheck(
    checks,
    'image_storage',
    'fail',
    `Unsupported image storage mode "${mode}".`,
  );
}

function validateOperationalTimeouts(checks: ReadinessCheck[], env: Env) {
  const objectStorageTimeoutMs =
    parseInteger(env, 'SMARTSTORE_OBJECT_STORAGE_TIMEOUT_MS') ??
    defaultObjectStorageTimeoutMs;
  const rateLimitRedisTimeoutMs =
    parseInteger(env, 'SMARTSTORE_RATE_LIMIT_REDIS_TIMEOUT_MS') ??
    defaultRateLimitRedisTimeoutMs;
  const pushTimeoutMs =
    parseInteger(env, 'SMARTSTORE_PUSH_TIMEOUT_MS') ?? defaultPushTimeoutMs;

  pushCheck(
    checks,
    'object_storage_timeout',
    objectStorageTimeoutMs >= 1_000 && objectStorageTimeoutMs <= 60_000
      ? 'pass'
      : 'fail',
    `Object storage timeout is ${objectStorageTimeoutMs}ms.`,
  );

  pushCheck(
    checks,
    'rate_limit_redis_timeout',
    rateLimitRedisTimeoutMs >= 250 && rateLimitRedisTimeoutMs <= 5_000
      ? 'pass'
      : 'fail',
    `Rate limit Redis timeout is ${rateLimitRedisTimeoutMs}ms.`,
  );

  pushCheck(
    checks,
    'push_timeout',
    pushTimeoutMs >= 1_000 && pushTimeoutMs <= 30_000 ? 'pass' : 'fail',
    `Push notification timeout is ${pushTimeoutMs}ms.`,
  );
}

function validateRateLimiting(
  checks: ReadinessCheck[],
  env: Env,
  production: boolean,
) {
  const backend = env.SMARTSTORE_RATE_LIMIT_BACKEND?.trim().toLowerCase() ?? '';
  const hasRedisUrl = present(env, 'UPSTASH_REDIS_REST_URL');
  const hasRedisToken = present(env, 'UPSTASH_REDIS_REST_TOKEN');
  const hasRedis = hasRedisUrl && hasRedisToken;

  if (backend && backend !== 'redis') {
    pushCheck(
      checks,
      'rate_limit_backend',
      'fail',
      `Unsupported rate limit backend "${backend}".`,
    );
    return;
  }

  if (backend === 'redis' && !hasRedis) {
    pushCheck(
      checks,
      'rate_limit_backend',
      'fail',
      'Redis rate limiting is requested but Upstash Redis URL/token are missing.',
    );
    return;
  }

  if (hasRedis) {
    pushCheck(
      checks,
      'rate_limit_backend',
      'pass',
      'Shared Redis rate limiting is configured.',
    );
    return;
  }

  pushCheck(
    checks,
    'rate_limit_backend',
    production ? 'warn' : 'pass',
    production
      ? 'Rate limiting will use instance-local memory; configure Upstash Redis before scaling to multiple instances.'
      : 'Instance-local memory rate limiting is acceptable for local development.',
  );
}

export function evaluateReadiness(env: Env = process.env) {
  const production = env.NODE_ENV === 'production';
  const checks: ReadinessCheck[] = [];

  pushCheck(
    checks,
    'node_env',
    production ? 'pass' : 'warn',
    production ? 'NODE_ENV is production.' : `NODE_ENV is "${env.NODE_ENV ?? 'unset'}".`,
  );
  validateStore(checks, env, production);
  validateAuth(checks, env, production);
  validateAppUrl(checks, env, production);
  validateDeepseek(checks, env, production);
  validateAuthProviders(checks, env, production);
  validateImageStorage(checks, env, production);
  validateOperationalTimeouts(checks, env);
  validateRateLimiting(checks, env, production);

  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;

  return {
    status: failures ? 'fail' : warnings ? 'warn' : 'pass',
    failures,
    warnings,
    checks,
  };
}

async function checkHealthEndpoint(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(new URL('/api/health', baseUrl), {
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as {
      status?: unknown;
    } | null;

    if (!response.ok || body?.status !== 'ok') {
      return {
        name: 'health_endpoint',
        status: 'fail' as const,
        message: `Health endpoint returned ${response.status} with status "${String(
          body?.status ?? 'unknown',
        )}".`,
      };
    }

    return {
      name: 'health_endpoint',
      status: 'pass' as const,
      message: 'Health endpoint is reachable and ok.',
    };
  } catch (error) {
    return {
      name: 'health_endpoint',
      status: 'fail' as const,
      message:
        error instanceof Error
          ? `Health endpoint failed: ${error.name}.`
          : 'Health endpoint failed.',
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printSummary(result: ReturnType<typeof evaluateReadiness>) {
  console.log(`Readiness: ${result.status.toUpperCase()}`);

  for (const check of result.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.name}: ${check.message}`);
  }
}

async function main() {
  const env = loadReadinessEnv(process.env);
  const result = evaluateReadiness(env);

  if (env.READINESS_BASE_URL?.trim()) {
    const health = await checkHealthEndpoint(env.READINESS_BASE_URL);

    result.checks.push(health);
    if (health.status === 'fail') {
      result.failures += 1;
      result.status = 'fail';
    }
  }

  if (env.READINESS_JSON === '1') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printSummary(result);
  }

  process.exitCode = result.failures ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
