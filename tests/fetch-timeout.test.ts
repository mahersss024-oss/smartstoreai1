import assert from 'node:assert/strict';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';

import { fetchWithTimeout } from '@/lib/api/fetch-timeout';

async function withHttpServer<T>(handler: RequestListener, run: (url: string) => Promise<T>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('fetchWithTimeout aborts stalled headers even with an external signal', { timeout: 5_000 }, async () => {
  await withHttpServer(() => {}, async url => {
    const external = new AbortController();
    await assert.rejects(
      fetchWithTimeout(url, { signal: external.signal }, 500),
      { name: 'TimeoutError' },
    );
    assert.equal(external.signal.aborted, false);
  });
});

test('fetchWithTimeout respects external cancellation while waiting for headers', { timeout: 5_000 }, async () => {
  let requestReceived!: () => void;
  const received = new Promise<void>(resolve => { requestReceived = resolve; });
  await withHttpServer(() => requestReceived(), async url => {
    const external = new AbortController();
    const pending = fetchWithTimeout(url, { signal: external.signal }, 10_000);
    await received;
    external.abort(new DOMException('Client aborted.', 'AbortError'));
    await assert.rejects(pending, /Client aborted/);
  });
});

test('fetchWithTimeout bounds a stalled response body after headers arrive', { timeout: 5_000 }, async () => {
  await withHttpServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"pending":');
  }, async url => {
    const response = await fetchWithTimeout(url, {}, 500);
    assert.equal(response.status, 200);
    await assert.rejects(response.json(), { name: 'TimeoutError' });
  });
});

test('fetchWithTimeout preserves external cancellation after headers arrive', { timeout: 5_000 }, async () => {
  await withHttpServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"pending":');
  }, async url => {
    const external = new AbortController();
    const response = await fetchWithTimeout(url, { signal: external.signal }, 10_000);
    const body = response.json();
    external.abort(new DOMException('Client aborted.', 'AbortError'));
    await assert.rejects(body, { name: 'AbortError' });
  });
});

test('fetchWithTimeout preserves cancellation inherited from a Request', { timeout: 5_000 }, async () => {
  await withHttpServer((_request, response) => {
    response.writeHead(200);
    response.write('partial');
  }, async url => {
    const external = new AbortController();
    const response = await fetchWithTimeout(new Request(url, { signal: external.signal }));
    const body = response.text();
    external.abort();
    await assert.rejects(body, { name: 'AbortError' });
  });
});

test('fetchWithTimeout keeps a native streaming Response, metadata and clone behavior', { timeout: 5_000 }, async () => {
  await withHttpServer((_request, response) => {
    response.writeHead(202, 'Queued', { 'Content-Type': 'application/json', 'X-Contract': 'preserved' });
    response.end('{"ok":true}');
  }, async url => {
    const response = await fetchWithTimeout(url, {}, 2_000);
    const clone = response.clone();
    assert.ok(response instanceof Response);
    assert.equal(response.status, 202);
    assert.equal(response.statusText, 'Queued');
    assert.equal(response.url, `${url}/`);
    assert.equal(response.headers.get('X-Contract'), 'preserved');
    assert.equal(response.bodyUsed, false);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(response.bodyUsed, true);
    assert.deepEqual(await clone.json(), { ok: true });
  });
});

test('fetchWithTimeout allows cancelling a streaming response body', { timeout: 5_000 }, async () => {
  let connectionClosed!: () => void;
  const closed = new Promise<void>(resolve => { connectionClosed = resolve; });
  await withHttpServer((_request, response) => {
    response.on('close', connectionClosed);
    response.writeHead(200);
    response.write('partial');
  }, async url => {
    const response = await fetchWithTimeout(url, {}, 10_000);
    await response.body?.cancel();
    await closed;
    assert.equal(response.bodyUsed, true);
  });
});
