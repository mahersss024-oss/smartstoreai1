import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '@/app/api/chat/route';
import { createSessionCookie } from '@/lib/auth/session';
import { aiConsentHeader, aiSharingConsent } from '@/lib/platform/ai-consent';

function request(body: Record<string, unknown>) {
  const owner = 'hamad-request-guard';
  return new Request('http://localhost/api/chat', { method: 'POST', headers: { 'content-type': 'application/json',
    [aiConsentHeader]: aiSharingConsent.version, cookie: createSessionCookie({ id: owner, email: owner + '@example.test' }) },
    body: JSON.stringify({ chatOwnerId: owner, messages: [{ role: 'user', id: 'latest', parts: [{ type: 'text', text: 'فيه استفسار' }] }], ...body }) });
}

test('a stale account cannot send its chat into another authenticated account', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected model call'); });
  assert.equal((await POST(request({ chatOwnerId: 'previous-owner' }))).status, 409);
  assert.equal(fetch.mock.callCount(), 0);
});

test('invalid creation mode and oversized text are rejected before model work', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected model call'); });
  assert.equal((await POST(request({ creationMethod: 'publish' }))).status, 400);
  assert.equal((await POST(request({ messages: [{ role: 'user', id: 'large', parts: [{ type: 'text', text: 'x'.repeat(24_001) }] }] }))).status, 413);
  assert.equal(fetch.mock.callCount(), 0);
});
