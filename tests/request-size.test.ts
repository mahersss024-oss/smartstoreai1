import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRequestContentLength,
  rejectOversizedRequest,
} from '@/lib/api/request-size';
import { POST as acceptCommissionAgreement } from '@/app/api/auth/commission-agreement/route';

test('parses valid request content length headers', () => {
  const request = new Request('http://localhost/api/test', {
    headers: { 'content-length': '42' },
  });

  assert.equal(getRequestContentLength(request), 42);
});

test('ignores missing or malformed content length headers', () => {
  assert.equal(
    getRequestContentLength(new Request('http://localhost/api/test')),
    null,
  );
  assert.equal(
    getRequestContentLength(
      new Request('http://localhost/api/test', {
        headers: { 'content-length': 'not-a-number' },
      }),
    ),
    null,
  );
  assert.equal(
    getRequestContentLength(
      new Request('http://localhost/api/test', {
        headers: { 'content-length': '1e6' },
      }),
    ),
    null,
  );
});

test('rejects requests whose declared body size exceeds the configured limit', () => {
  const request = new Request('http://localhost/api/test', {
    headers: { 'content-length': '1025' },
  });
  const response = rejectOversizedRequest(request, 1024);

  assert.equal(response?.status, 413);
});

test('rejects oversized JSON API requests before parsing the body', async () => {
  const request = new Request(
    'http://localhost/api/auth/commission-agreement',
    {
      method: 'POST',
      headers: {
        'content-length': '1025',
        'content-type': 'application/json',
      },
      body: '{"accepted":true}',
    },
  );

  const response = await acceptCommissionAgreement(request);

  assert.equal(response.status, 413);
});
