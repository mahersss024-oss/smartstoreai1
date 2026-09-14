import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

function stalledFetch() {
  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    await new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });

    throw new Error('unreachable');
  };
}

test('fetchWithTimeout aborts even when an external signal is provided', async () => {
  const originalFetch = globalThis.fetch;
  const externalController = new AbortController();

  globalThis.fetch = stalledFetch() as typeof fetch;

  try {
    await assert.rejects(
      () =>
        fetchWithTimeout(
          'https://api.example.test/stalled',
          { signal: externalController.signal },
          1,
        ),
      /TimeoutError|timed out/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchWithTimeout respects an external abort before its timeout', async () => {
  const originalFetch = globalThis.fetch;
  const externalController = new AbortController();

  globalThis.fetch = stalledFetch() as typeof fetch;
  setTimeout(
    () => externalController.abort(new DOMException('Client aborted.', 'AbortError')),
    1,
  );

  try {
    await assert.rejects(
      () =>
        fetchWithTimeout(
          'https://api.example.test/stalled',
          { signal: externalController.signal },
          10_000,
        ),
      /AbortError|Client aborted/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
