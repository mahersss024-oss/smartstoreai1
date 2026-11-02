import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { POST as googleNative } from '@/app/api/auth/google/native/route';
import { POST as appleNative } from '@/app/api/auth/apple/native/route';
import { POST as appleChallenge } from '@/app/api/auth/apple/native/challenge/route';
import { POST as appleCallback } from '@/app/api/auth/apple/callback/route';
import { createCommissionAgreementToken } from '@/lib/auth/session';
import { enforceApiRateLimit } from '@/lib/api/rate-limit';

function environment(t: TestContext) {
  const values = { AUTH_SECRET: 'isolated-body-gate-secret-over32characters', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    APPLE_NATIVE_CLIENT_ID: '', APPLE_CLIENT_ID: '', APPLE_TEAM_ID: '', APPLE_KEY_ID: '', APPLE_PRIVATE_KEY: '' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}

function stalled(t: TestContext, headers: HeadersInit = {}) {
  let pulls = 0;
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ pull() { pulls++; } }, { highWaterMark: 0 });
  const request = new Request('https://example.test/api/auth/fixture', {
    method: 'POST', body: stream, duplex: 'half', signal: controller.signal, headers,
  } as RequestInit);
  t.after(() => { controller.abort(); if (!request.body?.locked) void request.body?.cancel().catch(() => {}); });
  return { request, pulls: () => pulls };
}

for (const [name, route, maxBytes] of [
  ['Google native', googleNative, 12 * 1024], ['Apple native', appleNative, 24 * 1024], ['Apple challenge', appleChallenge, 2048],
] as const) {
  test(`${name} refuses a missing agreement without pulling a stalled upload`, { timeout: 3000 }, async t => {
    environment(t);
    const body = stalled(t);
    const response = await route(body.request);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'commission_agreement_required');
    assert.equal(body.pulls(), 0);
    assert.equal(body.request.bodyUsed, false);
  });
  test(`${name} keeps declared oversized rejection immediate before other gates`, { timeout: 3000 }, async t => {
    environment(t);
    const body = stalled(t, { 'content-length': String(maxBytes + 1) });
    assert.equal((await route(body.request)).status, 413);
    assert.equal(body.pulls(), 0);
  });
}

for (const [name, route] of [['Apple native', appleNative], ['Apple challenge', appleChallenge]] as const) {
  test(`${name} refuses missing configuration without pulling a stalled upload`, { timeout: 3000 }, async t => {
    environment(t);
    const body = stalled(t, { 'x-souq-hamad-commission-agreement': createCommissionAgreementToken() });
    const response = await route(body.request);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'apple_native_unavailable');
    assert.equal(body.pulls(), 0);
  });
}

test('Apple web callback enforces its rate gate before reading form_post bytes', { timeout: 3000 }, async t => {
  environment(t);
  const headers = { 'x-real-ip': 'auth-body-gate-fixture', 'content-type': 'application/x-www-form-urlencoded' };
  for (let index = 0; index < 60; index++) {
    assert.equal(await enforceApiRateLimit(new Request('https://example.test', { headers }), {
      namespace: 'auth_apple_callback', maxRequests: 60, windowMs: 60_000,
    }), null);
  }
  const body = stalled(t, headers);
  assert.equal((await appleCallback(body.request)).status, 429);
  assert.equal(body.pulls(), 0);
});
