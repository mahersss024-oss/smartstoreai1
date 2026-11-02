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
      DEEPSEEK_MODEL: 'deepseek-flash',
      DEEPSEEK_SCOPE_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_SEARCH_MODEL: 'deepseek-v4-search',
      DEEPSEEK_VISION_MODEL: 'deepseek-flash',
    },
    () => {
      assert.equal(getDeepseekModelName('chat'), 'deepseek-flash');
      assert.equal(getDeepseekModelName('scope'), 'deepseek-v4-pro');
      assert.equal(getDeepseekModelName('search'), 'deepseek-v4-search');
      assert.equal(getDeepseekModelName('moderation'), 'deepseek-flash');
      assert.equal(getDeepseekModelName('vision'), 'deepseek-flash');
    },
  );
});

test('prefers local DeepSeek key over stale machine environment key', () => {
  const previousCwd = process.cwd();
  const tempDirectory = mkdtempSync(join(tmpdir(), 'smartstore-env-'));
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousCi = process.env.CI;

  try {
    process.chdir(tempDirectory);
    delete process.env.CI;
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

    if (previousCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = previousCi;
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
        model: 'deepseek-flash',
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
    assert.equal(await response.text(), 'ok');
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
        }).then(response => response.text()),
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
    await (await firstRequest).text();

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

    await Promise.all([firstRequest, queuedRequest].map(async request => (await request).text()));
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

test('holds the provider permit while a response body is still streaming', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let calls = 0;
  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    globalThis.fetch = (async () => {
      calls++;
      if (calls > 1) return new Response('second');
      const response = new Response(new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
          value.enqueue(new TextEncoder().encode('first'));
        },
      }));
      Object.defineProperty(response, 'url', { value: 'https://provider.test/stream' });
      return response;
    }) as typeof fetch;
    const first = await fetchDeepseekWithRetry('https://provider.test/stream', undefined, 1);
    const secondPending = fetchDeepseekWithRetry('https://provider.test/stream', undefined, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'headers alone must not release the permit');
    assert.equal(first.url, 'https://provider.test/stream');
    const reader = first.body!.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1, 'a partial body still owns its permit');
    controller.close();
    assert.equal((await reader.read()).done, true);
    const second = await secondPending;
    assert.equal(await second.text(), 'second');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    else process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
  }
});

test('cancels a transient response body before starting the provider retry', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  let calls = 0;
  let cancelled = false;
  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    globalThis.fetch = (async () => {
      calls++;
      if (calls > 1) {
        assert.equal(cancelled, true);
        return new Response('ok');
      }
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 502 });
    }) as typeof fetch;
    const response = await fetchDeepseekWithRetry('https://provider.test/retry', undefined, 2);
    assert.equal(await response.text(), 'ok');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    else process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
  }
});

test('a stalled cancellation acknowledgement cannot hang retries or an aborted retry wait', { timeout: 6_000 }, async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  const bounded = async <T>(pending: Promise<T>) => {
    let timeout!: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('stalled upstream cancellation blocked progress')), 2_000);
      })]);
    } finally { clearTimeout(timeout); }
  };
  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    for (const abort of [false, true]) {
      let calls = 0;
      let cancelStarted!: () => void;
      const cancelled = new Promise<void>(resolve => { cancelStarted = resolve; });
      globalThis.fetch = (async () => {
        calls++;
        if (calls > 1) return new Response('recovered');
        return new Response(new ReadableStream({ cancel() {
          cancelStarted();
          return new Promise<void>(() => undefined);
        } }), { status: 502 });
      }) as typeof fetch;
      const controller = new AbortController();
      const pending = fetchDeepseekWithRetry('https://provider.test/stalled-cancel', { signal: controller.signal }, 2);
      const outcome = pending.then(response => ({ ok: true as const, response }), error => ({ ok: false as const, error }));
      await bounded(cancelled);
      if (abort) controller.abort();
      const settled = await bounded(outcome);
      if (abort) {
        assert.ok(!settled.ok);
        assert.equal(settled.error.name, 'AbortError');
        assert.equal(calls, 1, 'aborting during retry backoff must not start another request');
      } else {
        assert.ok(settled.ok);
        assert.equal(await settled.response.text(), 'recovered');
        assert.equal(calls, 2);
      }
      const next = await bounded(fetchDeepseekWithRetry('https://provider.test/after-stalled-cancel', undefined, 1));
      assert.equal(await next.text(), 'recovered', 'the cancelled response must not retain its permit');
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    else process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
  }
});

test('body cancel, abort, and upstream error each release exactly one provider permit', async () => {
  const originalFetch = globalThis.fetch;
  const previousLimit = process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
  try {
    process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = '1';
    for (const mode of ['cancel', 'abort', 'error'] as const) {
      let calls = 0;
      let cancellations = 0;
      const controllers: Array<ReadableStreamDefaultController<Uint8Array>> = [];
      globalThis.fetch = (async () => {
        calls++;
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { controllers.push(controller); },
          cancel() { cancellations++; },
        }));
      }) as typeof fetch;
      const abortController = new AbortController();
      const first = await fetchDeepseekWithRetry(new Request('https://provider.test/first', { signal: abortController.signal }), undefined, 1);
      const secondPending = fetchDeepseekWithRetry('https://provider.test/second', undefined, 1);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 1);
      if (mode === 'cancel') await first.body!.cancel();
      else if (mode === 'abort') {
        abortController.abort();
        await assert.rejects(first.text(), { name: 'AbortError' });
      } else {
        controllers[0].error(new Error('upstream body failed'));
        await assert.rejects(first.text(), /upstream body failed/);
      }
      const second = await secondPending;
      const thirdPending = fetchDeepseekWithRetry('https://provider.test/third', undefined, 1);
      // A second terminal event from the old request cannot release the new one.
      abortController.abort();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls, 2);
      await second.body!.cancel();
      await (await thirdPending).body!.cancel();
      assert.equal(calls, 3);
      assert.equal(cancellations, mode === 'error' ? 2 : 3);
    }
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    assert.equal((await fetchDeepseekWithRetry('https://provider.test/no-body', undefined, 1)).status, 204);
    assert.equal((await fetchDeepseekWithRetry('https://provider.test/no-body', undefined, 1)).status, 204);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousLimit === undefined) delete process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS;
    else process.env.SMARTSTORE_DEEPSEEK_MAX_CONCURRENT_REQUESTS = previousLimit;
  }
});
