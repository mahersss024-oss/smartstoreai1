import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildContentSecurityPolicy,
  getSecurityHeaders,
} from '@/lib/security/headers';
import {
  isSameOriginApiMutationAllowed,
  isUnsafeMutationMethod,
} from '@/lib/security/same-origin';

function headerMap(headers: Array<{ key: string; value: string }>) {
  return new Map(headers.map((header) => [header.key, header.value]));
}

test('includes the core hardening headers', () => {
  const map = headerMap(getSecurityHeaders());

  assert.equal(map.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(map.get('X-Frame-Options'), 'DENY');
  assert.equal(
    map.get('Referrer-Policy'),
    'strict-origin-when-cross-origin',
  );
  assert.ok(map.get('Content-Security-Policy'));
});

test('csp locks down framing and object embedding', () => {
  const csp = buildContentSecurityPolicy();

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /upgrade-insecure-requests/);
});

test('csp permits framework eval but no remote scripts', () => {
  const csp = buildContentSecurityPolicy();
  const scriptSrc = csp
    .split('; ')
    .find((directive) => directive.startsWith('script-src'));

  assert.ok(scriptSrc);
  assert.match(scriptSrc, /'unsafe-eval'/);
  assert.match(scriptSrc, /'self'/);
  // No remote script origin is allowed to execute JavaScript.
  assert.equal(/https?:\/\//.test(scriptSrc.replace("'self'", '')), false);
});

test('csp allows the marketplace image and auth origins', () => {
  const csp = buildContentSecurityPolicy();

  assert.match(csp, /img-src[^;]*https:/);
  assert.match(csp, /img-src[^;]*lh3\.googleusercontent\.com/);
  assert.match(csp, /connect-src[^;]*accounts\.google\.com/);
});

test('csp appends a configured public storage origin when provided', () => {
  const previous = process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL;
  process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL =
    'https://cdn.smartstore.example/bucket';

  try {
    const csp = buildContentSecurityPolicy();

    assert.match(csp, /img-src[^;]*https:\/\/cdn\.smartstore\.example/);
  } finally {
    if (previous === undefined) {
      delete process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL;
    } else {
      process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL = previous;
    }
  }
});

test('adds HSTS only in production', () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  env.NODE_ENV = 'development';

  try {
    const map = headerMap(getSecurityHeaders());

    assert.equal(map.has('Strict-Transport-Security'), false);
  } finally {
    env.NODE_ENV = previousNodeEnv;
  }
});

test('same-origin guard allows safe methods and same-origin api mutations', () => {
  assert.equal(isUnsafeMutationMethod('GET'), false);
  assert.equal(isUnsafeMutationMethod('POST'), true);
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/marketplace/listings', {
        method: 'POST',
        headers: { origin: 'https://souqhamad.com' },
      }),
    ),
    true,
  );
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/marketplace/listings', {
        method: 'GET',
        headers: { origin: 'https://evil.example' },
      }),
    ),
    true,
  );
});

test('same-origin guard blocks cross-site api mutations', () => {
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/marketplace/listings', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/marketplace/listings', {
        method: 'DELETE',
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/marketplace/listings', {
        method: 'PATCH',
        headers: { origin: 'not a url' },
      }),
    ),
    false,
  );
});

test('same-origin guard preserves required external auth callbacks', () => {
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/auth/apple/callback', {
        method: 'POST',
        headers: {
          origin: 'https://appleid.apple.com',
          'sec-fetch-site': 'cross-site',
        },
      }),
    ),
    true,
  );
});

test('same-origin guard preserves the public analytics visit beacon', () => {
  assert.equal(
    isSameOriginApiMutationAllowed(
      new Request('https://souqhamad.com/api/analytics/visit', {
        method: 'POST',
        headers: {
          origin: 'https://www.souqhamad.com',
          'sec-fetch-site': 'cross-site',
        },
      }),
    ),
    true,
  );
});

test('proxy enforces the same-origin api mutation guard centrally', async () => {
  const proxy = await readFile(new URL('../proxy.ts', import.meta.url), 'utf8');

  assert.match(proxy, /isSameOriginApiMutationAllowed/);
  assert.match(proxy, /cross_site_request_blocked/);
});
