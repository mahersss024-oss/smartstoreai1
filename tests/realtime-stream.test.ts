import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { GET } from '@/app/api/realtime/stream/route';
import { publishRealtimeEvent } from '@/lib/realtime/event-bus';
import { prisma } from '@/lib/db/prisma';
import { createSignedSession } from '@/lib/auth/session';
import { resolveRealtimeSubscriberContext } from '@/lib/realtime/authorization';
import { mockDatabaseMethod } from './helpers/mock-database-method';

function mockAccount(t: TestContext, id: string, initialRole = 'admin') {
  const environment = {
    SMARTSTORE_MARKETPLACE_STORE: 'database', DATABASE_URL: 'postgresql://mock-only@127.0.0.1/never-connected',
    SMARTSTORE_ADMIN_EMAILS: '', AUTH_SECRET: 'isolated-realtime-authorization-test-secret',
    SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let current: { role: string; deletedAt: Date | null } | null = { role: initialRole, deletedAt: null };
  let unavailable = false;
  mockDatabaseMethod(t, prisma.user, 'findUnique', (async () => {
    if (unavailable) throw new Error('mock database unavailable');
    return current ? { ...current } : null;
  }) as never);
  const session = { user: { id, email: `${id}@example.test`, role: initialRole },
    issuedAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + 60 };
  const controller = new AbortController();
  t.after(() => controller.abort());
  return {
    session, controller,
    request: () => new Request('http://localhost/api/realtime/stream', { signal: controller.signal,
      headers: { Authorization: `Bearer ${createSignedSession(session.user)}` } }),
    role: (role: string) => { current = { role, deletedAt: null }; },
    remove: () => { current = null; },
    delete: () => { if (current) current.deletedAt = new Date(); },
    fail: () => { unavailable = true; },
  };
}

async function collectClosedStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const decoder = new TextDecoder();
        let value = '';
        while (true) { const next = await reader.read(); if (next.done) return value; value += decoder.decode(next.value); }
      })(),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('stream did not revoke access')), 2000); }),
    ]);
  } finally { clearTimeout(timeout); await reader.cancel().catch(() => undefined); }
}

test('sse stream sets the correct streaming headers', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get('content-type') ?? '',
    /text\/event-stream/,
  );
  assert.match(response.headers.get('cache-control') ?? '', /no-cache/);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');

  controller.abort();
});

test('sse stream is rate limited on connection attempts', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'realtime', 'stream', 'route.ts'),
    'utf8',
  );

  assert.match(route, /enforceApiRateLimit/);
  assert.match(route, /namespace: 'realtime_stream'/);
  assert.match(route, /actorId: session\?\.user\.id/);
  assert.ok(
    route.indexOf('const rateLimitResponse') <
      route.indexOf('const context = await resolveRealtimeSubscriberContext'),
  );
});

test('sse stream emits a ready event then replays visible events', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  const firstRead = await reader.read();
  const firstChunk = decoder.decode(firstRead.value);

  assert.match(firstChunk, /event: ready/);

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'l1', sellerId: 's1', status: 'published' },
    visibility: { includePublic: true },
  });

  // Drain until the published event lands in the stream.
  let buffered = '';
  const deadline = Date.now() + 2000;

  while (Date.now() < deadline && !buffered.includes('ad_created')) {
    const read = await reader.read();

    if (read.done) {
      break;
    }

    buffered += decoder.decode(read.value);
  }

  assert.match(buffered, /ad_created/);

  controller.abort();
  await reader.cancel().catch(() => undefined);
});

test('sse stream filters events the subscriber may not see', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/realtime/stream', {
    signal: controller.signal,
  });

  const response = await GET(request);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  await reader.read(); // ready event

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'private', sellerId: 's2', status: 'published' },
    visibility: { userIds: ['someone-else'] },
  });

  publishRealtimeEvent({
    type: 'ad_created',
    payload: { listingId: 'public', sellerId: 's3', status: 'published' },
    visibility: { includePublic: true },
  });

  let buffered = '';
  const deadline = Date.now() + 2000;

  while (Date.now() < deadline && !buffered.includes('public')) {
    const read = await reader.read();

    if (read.done) {
      break;
    }

    buffered += decoder.decode(read.value);
  }

  assert.match(buffered, /public/);
  assert.doesNotMatch(buffered, /private/);

  controller.abort();
  await reader.cancel().catch(() => undefined);
});

test('an open administrator stream closes before delivering an event after the role is revoked', async t => {
  const account = mockAccount(t, 'sse-revoked-admin');
  const response = await GET(account.request());
  const reader = response.body!.getReader();
  await reader.read();
  account.role('user');
  publishRealtimeEvent({ type: 'moderation_updated',
    payload: { entity: 'listing', entityId: 'private-after-admin-revocation', status: 'paused' },
    visibility: { includeAdmins: true } });
  const received = await collectClosedStream(reader);
  assert.doesNotMatch(received, /private-after-admin-revocation/);
});

test('deleted accounts cannot receive new personal events through an already open stream', async t => {
  const account = mockAccount(t, 'sse-deleted-customer', 'user');
  const response = await GET(account.request());
  const reader = response.body!.getReader();
  await reader.read();
  account.delete();
  publishRealtimeEvent({ type: 'ad_created',
    payload: { listingId: 'private-after-account-deletion', sellerId: account.session.user.id, status: 'draft' },
    visibility: { userIds: [account.session.user.id] } });
  assert.doesNotMatch(await collectClosedStream(reader), /private-after-account-deletion/);
});

test('authorization lookup failures close existing streams without exposing queued private events', async t => {
  const account = mockAccount(t, 'sse-unavailable-admin');
  t.mock.method(console, 'warn', () => {});
  const response = await GET(account.request());
  const reader = response.body!.getReader();
  await reader.read();
  account.fail();
  publishRealtimeEvent({ type: 'moderation_updated',
    payload: { entity: 'listing', entityId: 'private-during-lookup-failure', status: 'paused' },
    visibility: { includeAdmins: true } });
  assert.doesNotMatch(await collectClosedStream(reader), /private-during-lookup-failure/);
});

test('initial lookup failures remain retryable while expired or removed accounts are rejected', async t => {
  const account = mockAccount(t, 'sse-initial-failure');
  assert.equal(await resolveRealtimeSubscriberContext({ ...account.session, expiresAt: 0 }), null);
  account.remove();
  assert.equal((await GET(account.request())).status, 401);
  t.mock.method(console, 'warn', () => {});
  account.fail();
  const unavailable = await GET(account.request());
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).error, 'realtime_unavailable');
});

test('a configured owner still needs an active account for realtime private events', async t => {
  const account = mockAccount(t, 'sse-owner', 'user');
  process.env.SMARTSTORE_ADMIN_EMAILS = account.session.user.email;
  assert.equal((await resolveRealtimeSubscriberContext(account.session))?.isAdmin, true);
  account.delete();
  assert.equal(await resolveRealtimeSubscriberContext(account.session), null);
});
