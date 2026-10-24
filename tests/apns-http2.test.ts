import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http2, { type ClientHttp2Session, type OutgoingHttpHeaders } from 'node:http2';
import test, { type TestContext } from 'node:test';

import { postApnsHttp2 } from '@/lib/push/apns-http2';

class FakeStream extends EventEmitter {
  closed = false;
  destroyed = false;
  body = '';
  end(body: string) { this.body = body; return this; }
  close() { this.closed = true; this.emit('close'); }
  destroy() { this.destroyed = true; }
}

class FakeSession extends EventEmitter {
  alpnProtocol: string = 'h2';
  closed = false;
  destroyed = false;
  headers?: OutgoingHttpHeaders;
  stream = new FakeStream();
  request(headers: OutgoingHttpHeaders) { this.headers = headers; return this.stream; }
  close() { this.closed = true; this.emit('close'); }
  destroy() { this.destroyed = true; }
}

function fakeConnection(t: TestContext, respond?: (session: FakeSession) => void, connected = true) {
  const session = new FakeSession();
  const connect = t.mock.method(http2, 'connect', (host: string, options: Record<string, unknown>) => {
    assert.equal(host, 'https://api.push.apple.com');
    assert.equal(options.minVersion, 'TLSv1.2');
    assert.deepEqual(options.ALPNProtocols, ['h2']);
    queueMicrotask(() => { if (connected) session.emit('connect'); respond?.(session); });
    return session as unknown as ClientHttp2Session;
  });
  return { session, connect };
}

const input = () => ({
  host: 'https://api.push.apple.com', token: 'device-token/encoded', authorization: 'bearer fixture-jwt',
  topic: 'com.souqhamad.app', payload: { aps: { alert: { title: 'رسالة', body: 'أهلًا' } } }, timeoutMs: 1000,
});

function assertClosed(session: FakeSession) {
  assert.equal(session.closed, true);
  assert.equal(session.destroyed, true);
  assert.equal(session.stream.closed, true);
  assert.equal(session.stream.destroyed, true);
  // A shutdown can generate a late error; handlers must remain attached.
  assert.doesNotThrow(() => { session.emit('error', new Error('late TLS error')); session.stream.emit('error', new Error('late stream error')); });
}

test('APNs uses authenticated HTTP/2 POST with TLS and closes all owned resources after success', async t => {
  const { session } = fakeConnection(t, value => { value.stream.emit('response', { ':status': 200 }); value.stream.emit('end'); });
  assert.deepEqual(await postApnsHttp2(input()), { status: 200, reason: undefined });
  assert.equal(session.headers?.[':method'], 'POST');
  assert.equal(session.headers?.[':path'], '/3/device/device-token%2Fencoded');
  assert.equal(session.headers?.authorization, 'bearer fixture-jwt');
  assert.equal(session.headers?.['apns-topic'], 'com.souqhamad.app');
  assert.equal(session.headers?.['apns-push-type'], 'alert');
  assert.equal(session.headers?.['apns-priority'], '10');
  assert.equal(session.headers?.['apns-expiration'], '0');
  assert.equal(session.headers?.['content-length'], Buffer.byteLength(session.stream.body));
  assert.deepEqual(JSON.parse(session.stream.body), input().payload);
  assertClosed(session);
});

test('APNs parses a bounded JSON reason split across HTTP/2 chunks', async t => {
  const { session } = fakeConnection(t, value => {
    value.stream.emit('response', { ':status': 410 });
    value.stream.emit('data', Buffer.from('{"rea'));
    value.stream.emit('data', Buffer.from('son":"Unregistered"}'));
    value.stream.emit('end');
  });
  assert.deepEqual(await postApnsHttp2(input()), { status: 410, reason: 'Unregistered' });
  assertClosed(session);
});

test('APNs tolerates non-JSON and malformed reason bodies without inventing token expiry', async t => {
  for (const body of ['invalid json', 'null', '{"reason":12}', '{"reason":"arbitrary secret body with spaces"}']) {
    await t.test(body, async child => {
      const { session } = fakeConnection(child, value => {
        value.stream.emit('response', { ':status': 400 }); value.stream.emit('data', Buffer.from(body)); value.stream.emit('end');
      });
      assert.deepEqual(await postApnsHttp2(input()), { status: 400, reason: undefined });
      assertClosed(session);
    });
  }
});

test('APNs absolute deadline covers connecting and a body stalled after headers', async t => {
  for (const headersReceived of [false, true]) {
    await t.test(headersReceived ? 'stalled body' : 'stalled connection', async child => {
      const { session } = fakeConnection(child, headersReceived ? value => value.stream.emit('response', { ':status': 200 }) : undefined, headersReceived);
      await assert.rejects(postApnsHttp2({ ...input(), timeoutMs: 10 }), /apns_http2_timeout/);
      assertClosed(session);
    });
  }
});

test('APNs caller cancellation tears down a request; an already-aborted call never connects', async t => {
  const { session, connect } = fakeConnection(t);
  const controller = new AbortController();
  const pending = postApnsHttp2({ ...input(), signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /apns_http2_aborted/);
  assertClosed(session);
  await assert.rejects(postApnsHttp2({ ...input(), signal: controller.signal }), /apns_http2_aborted/);
  assert.equal(connect.mock.callCount(), 1);
});

test('APNs handles HTTP/2 failures and never leaves the stream/session open', async t => {
  const cases: Array<[string, (session: FakeSession) => void, string]> = [
    ['session error', value => value.emit('error', new Error('fixture')), 'session_error'],
    ['stream error', value => value.stream.emit('error', new Error('fixture')), 'stream_error'],
    ['stream aborted', value => value.stream.emit('aborted'), 'stream_aborted'],
    ['stream closes before end', value => value.stream.emit('close'), 'response_incomplete'],
    ['session closes early', value => value.emit('close'), 'connection_closed'],
    ['GOAWAY', value => value.emit('goaway'), 'goaway'],
    ['wrong ALPN', value => { value.alpnProtocol = 'http/1.1'; value.emit('connect'); }, 'negotiation_failed'],
    ['missing status', value => value.stream.emit('end'), 'missing_status'],
    ['invalid status', value => value.stream.emit('response', { ':status': '200' }), 'invalid_status'],
    ['oversized body', value => { value.stream.emit('response', { ':status': 400 }); value.stream.emit('data', Buffer.alloc(16 * 1024 + 1)); }, 'response_too_large'],
  ];
  for (const [name, respond, reason] of cases) {
    await t.test(name, async child => {
      const { session } = fakeConnection(child, respond);
      await assert.rejects(postApnsHttp2(input()), new RegExp(`apns_http2_${reason}`));
      assertClosed(session);
    });
  }
});

test('APNs rejects non-APNs hosts without connecting and handles synchronous setup failures', async t => {
  const { session, connect } = fakeConnection(t);
  await assert.rejects(postApnsHttp2({ ...input(), host: 'https://example.test' }), /invalid_host/);
  assert.equal(connect.mock.callCount(), 0);
  t.mock.method(session, 'request', () => { throw new Error('fixture request failure'); });
  await assert.rejects(postApnsHttp2(input()), /apns_http2_request_failed/);
  assert.equal(session.closed, true);
  assert.equal(session.destroyed, true);
});
