import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  fetchDeepseekWithRetry,
  getDeepseekApiKey,
  getDeepseekMaxConcurrentRequests,
  getDeepseekMaxQueuedRequests,
  getDeepseekModelName,
  getDeepseekQueueTimeoutMs,
  isTransientDeepseekResponse,
  normalizeDeepseekChatBody,
} from '@/agent/deepseek-provider';
import { appConfig } from '@/app/app-config';

const modelEnvKeys = [
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_CHAT_MODEL',
  'DEEPSEEK_SCOPE_MODEL',
  'DEEPSEEK_SEARCH_MODEL',
  'DEEPSEEK_MODERATION_MODEL',
  'DEEPSEEK_VISION_MODEL',
  'SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS',
  'SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS',
  'SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS',
] as const;

function withModelEnvironment(
  values: Partial<Record<(typeof modelEnvKeys)[number], string>>,
  run: () => void,
) {
  const previousValues = Object.fromEntries(
    modelEnvKeys.map((key) => [key, process.env[key]]),
  );

  for (const key of modelEnvKeys) {
    delete process.env[key];
  }

  Object.assign(process.env, values);

  try {
    run();
  } finally {
    for (const key of modelEnvKeys) {
      const previousValue = previousValues[key];

      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

test('uses configured default DeepSeek models for every profile', () => {
  withModelEnvironment({}, () => {
    assert.equal(getDeepseekModelName('chat'), appConfig.models.chat);
    assert.equal(getDeepseekModelName('scope'), appConfig.models.scope);
    assert.equal(getDeepseekModelName('search'), appConfig.models.search);
    assert.equal(
      getDeepseekModelName('moderation'),
      appConfig.models.moderation,
    );
    assert.equal(getDeepseekModelName('vision'), appConfig.models.vision);
  });
});

test('allows one global DeepSeek model override', () => {
  withModelEnvironment({ DEEPSEEK_MODEL: 'deepseek-v4-pro' }, () => {
    assert.equal(getDeepseekModelName('chat'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('scope'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('search'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('moderation'), 'deepseek-v4-pro');
    assert.equal(getDeepseekModelName('vision'), 'deepseek-v4-pro');
  });
});

test('uses profile-specific DeepSeek model overrides first', () => {
  withModelEnvironment(
    {
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_SCOPE_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_SEARCH_MODEL: 'deepseek-v4-search',
      DEEPSEEK_VISION_MODEL: 'deepseek-v4-flash-vision-exp',
    },
    () => {
      assert.equal(getDeepseekModelName('chat'), 'deepseek-v4-flash');
      assert.equal(getDeepseekModelName('scope'), 'deepseek-v4-pro');
      assert.equal(getDeepseekModelName('search'), 'deepseek-v4-search');
      assert.equal(getDeepseekModelName('moderation'), 'deepseek-v4-flash');
      assert.equal(
        getDeepseekModelName('vision'),
        'deepseek-v4-flash-vision-exp',
      );
    },
  );
});

test('prefers local DeepSeek key over stale machine environment key', () => {
  const previousCwd = process.cwd();
  const tempDirectory = mkdtempSync(join(tmpdir(), 'smartstore-env-'));
  const previousKey = process.env.DEEPSEEK_API_KEY;

  try {
    process.chdir(tempDirectory);
    process.env.DEEPSEEK_API_KEY = 'sk-stale-machine-key';
    writeFileSync('.env.local', 'DEEPSEEK_API_KEY=sk-local-file-key\n');

    assert.equal(getDeepseekApiKey(), 'sk-local-file-key');
  } finally {
    process.chdir(previousCwd);

    if (previousKey === undefined) {
      delete process.env.DEEPSEEK_API_KEY;
    } else {
      process.env.DEEPSEEK_API_KEY = previousKey;
    }

    rmSync(tempDirectory, { recursive: true, force: true });
  }
});

test('uses load-tested DeepSeek concurrency defaults', () => {
  withModelEnvironment({}, () => {
    assert.equal(getDeepseekMaxConcurrentRequests(), 100);
    assert.equal(getDeepseekMaxQueuedRequests(), 2_000);
    assert.equal(getDeepseekQueueTimeoutMs(), 60_000);
  });
});

test('normalizes DeepSeek requests for non-thinking marketplace responses', () => {
  const normalized = JSON.parse(
    normalizeDeepseekChatBody(
      JSON.stringify({
        model: 'deepseek-v4-flash',
        messages: [
          { role: 'developer', content: 'hidden rule' },
          { role: 'user', content: 'مرحبا' },
        ],
      }),
    ),
  ) as {
    thinking: { type: string };
    messages: Array<{ role: string; content: string }>;
  };

  assert.deepEqual(normalized.thinking, { type: 'disabled' });
  assert.equal(normalized.messages[0]?.role, 'system');
  assert.equal(normalized.messages[1]?.role, 'user');
});

test('recognizes transient DeepSeek response statuses', () => {
  assert.equal(isTransientDeepseekResponse(429), true);
  assert.equal(isTransientDeepseekResponse(502), true);
  assert.equal(isTransientDeepseekResponse(401), false);
  assert.equal(isTransientDeepseekResponse(400), false);
});

test('retries transient DeepSeek fetch responses', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  try {
    globalThis.fetch = (async () => {
      calls += 1;

      return new Response(calls === 1 ? 'temporary' : 'ok', {
        status: calls === 1 ? 502 : 200,
      });
    }) as typeof fetch;

    const response = await fetchDeepseekWithRetry('https://api.deepseek.test', {
      method: 'POST',
    });

    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('limits concurrent DeepSeek fetch attempts', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  let inFlight = 0;
  let maxInFlight = 0;

  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '2';
    globalThis.fetch = (async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      await new Promise((resolve) => setTimeout(resolve, 25));
      inFlight -= 1;

      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    await Promise.all(
      Array.from({ length: 8 }, () =>
        fetchDeepseekWithRetry('https://api.deepseek.test', {
          method: 'POST',
        }),
      ),
    );

    assert.equal(getDeepseekMaxConcurrentRequests(), 2);
    assert.equal(maxInFlight <= 2, true);
  } finally {
    globalThis.fetch = originalFetch;

    if (previousLimit === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
    }
  }
});

test('times out queued DeepSeek requests before they hang', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  const previousTimeout = process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS;

  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS = '1000';
    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));

      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    const firstRequest = fetchDeepseekWithRetry('https://api.deepseek.test', {
      method: 'POST',
    });
    const secondRequest = fetchDeepseekWithRetry(
      'https://api.deepseek.test',
      { method: 'POST' },
      1,
    );

    await assert.rejects(secondRequest, { name: 'AbortError' });
    await firstRequest;

    assert.equal(getDeepseekQueueTimeoutMs(), 1000);
  } finally {
    globalThis.fetch = originalFetch;

    if (previousLimit === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
    }

    if (previousTimeout === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS = previousTimeout;
    }
  }
});

test('rejects DeepSeek requests when the in-memory queue is full', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  const previousQueueLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS;
  const previousTimeout = process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS;
  let releaseActiveRequest: () => void = () => {
    throw new Error('Expected the active DeepSeek request to be releasable.');
  };
  let fetchCalls = 0;
  const activeRequestStarted = new Promise<void>((resolve) => {
    globalThis.fetch = (async () => {
      fetchCalls += 1;

      if (fetchCalls > 1) {
        return new Response('ok', { status: 200 });
      }

      resolve();
      await new Promise<void>((release) => {
        releaseActiveRequest = release;
      });

      return new Response('ok', { status: 200 });
    }) as typeof fetch;
  });

  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    process.env.SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS = '1';
    process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS = '5000';

    const firstRequest = fetchDeepseekWithRetry('https://api.deepseek.test', {
      method: 'POST',
    });

    await activeRequestStarted;

    const queuedRequest = fetchDeepseekWithRetry(
      'https://api.deepseek.test',
      { method: 'POST' },
      1,
    );

    await assert.rejects(
      fetchDeepseekWithRetry(
        'https://api.deepseek.test',
        { method: 'POST' },
        1,
      ),
      { name: 'AbortError' },
    );

    releaseActiveRequest();

    await Promise.all([firstRequest, queuedRequest]);
    assert.equal(getDeepseekMaxQueuedRequests(), 1);
  } finally {
    globalThis.fetch = originalFetch;

    if (previousLimit === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
    }

    if (previousQueueLimit === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_MAX_QUEUED_REQUESTS = previousQueueLimit;
    }

    if (previousTimeout === undefined) {
      delete process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS;
    } else {
      process.env.SMARTSTORE_DEEPSEEK_QUEUE_TIMEOUT_MS = previousTimeout;
    }
  }
});
