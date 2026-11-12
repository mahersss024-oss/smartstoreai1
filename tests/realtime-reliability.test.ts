import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { GET } from '@/app/api/realtime/stream/route';
import { publishRealtimeEvent, getRealtimeEventsSince } from '@/lib/realtime/event-bus';
import { acquireRealtimeConnection, realtimeConnectionLifetimeMs } from '@/lib/realtime/stream-limits';
import { RedisRealtimeRelay } from '@/lib/realtime/redis-relay';
import { isRealtimeEventVisibleToSubscriber, type RealtimeEventEnvelope } from '@/lib/realtime/events';

function environment(t: TestContext, values: Record<string, string>) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
}
function isolated(t: TestContext) {
  environment(t, { SMARTSTORE_REALTIME_BACKEND: 'memory', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '', SMARTSTORE_SSE_MAX_LIFETIME_MS: '' });
}
function request(ip: string, lastId?: number, signal?: AbortSignal) {
  return new Request('http://localhost/api/realtime/stream', { signal,
    headers: { 'x-forwarded-for': ip, ...(lastId ? { 'last-event-id': String(lastId) } : {}) } });
}
async function turn() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
const privateEvent = (): RealtimeEventEnvelope => ({ id: 1, type: 'ad_created', occurredAt: new Date().toISOString(),
  payload: { listingId: 'private-listing', sellerId: 'owner', status: 'draft' },
  visibility: { includePublic: false, includeAdmins: false, userIds: ['owner'] } });

test('connection admission enforces client and process caps and releases cancellation slots', async t => {
  isolated(t);
  environment(t, { SMARTSTORE_SSE_MAX_CONNECTIONS: '2', SMARTSTORE_SSE_MAX_CONNECTIONS_PER_CLIENT: '1' });
  const first = await GET(request('capacity-a'));
  t.after(() => first.body?.cancel());
  assert.equal(first.status, 200);
  const duplicate = await GET(request('capacity-a'));
  assert.equal(duplicate.status, 429);
  assert.equal((await duplicate.json()).error, 'realtime_capacity_exceeded');
  const second = await GET(request('capacity-b'));
  t.after(() => second.body?.cancel());
  assert.equal(second.status, 200);
  assert.equal((await GET(request('capacity-c'))).status, 429);
  await first.body!.cancel();
  const replacement = await GET(request('capacity-a'));
  assert.equal(replacement.status, 200);
  await replacement.body!.cancel();
});

test('admission release is idempotent and request lifetime stays below the App Runner cap', t => {
  isolated(t);
  environment(t, { SMARTSTORE_SSE_MAX_CONNECTIONS: '1', SMARTSTORE_SSE_MAX_CONNECTIONS_PER_CLIENT: '1' });
  const release = acquireRealtimeConnection('direct');
  assert.ok(release);
  assert.equal(acquireRealtimeConnection('other'), null);
  release(); release();
  const next = acquireRealtimeConnection('other');
  assert.ok(next); next();
  for (const [value, expected] of [['', 110000], ['300000', 110000], ['1', 15000], ['60000', 60000], ['invalid', 110000]] as const) {
    process.env.SMARTSTORE_SSE_MAX_LIFETIME_MS = value;
    assert.equal(realtimeConnectionLifetimeMs(), expected);
  }
  delete process.env.SMARTSTORE_SSE_MAX_LIFETIME_MS;
});

test('a large retained replay drains in order through bounded pull queues instead of reconnecting forever', async t => {
  isolated(t);
  const anchor = publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: 'replay-anchor' } });
  const expected: number[] = [];
  for (let index = 0; index < 1500; index++) {
    expected.push(publishRealtimeEvent({ type: 'ad_created',
      payload: { listingId: `large-replay-${index}`, sellerId: 'replay-owner', status: 'x'.repeat(400) },
      visibility: { includePublic: true } }).id);
  }
  const response = await GET(request('large-replay', anchor.id));
  const reader = response.body!.getReader();
  const received: number[] = [];
  const decoder = new TextDecoder();
  const timeout = setTimeout(() => { void reader.cancel(); }, 4000);
  try {
    while (received.length < expected.length) {
      const next = await reader.read();
      assert.equal(next.done, false, 'replay closed before its retained history was delivered');
      const text = decoder.decode(next.value);
      for (const match of text.matchAll(/^id: (\d+)$/gm)) received.push(Number(match[1]));
    }
    assert.deepEqual(received, expected);
  } finally { clearTimeout(timeout); await reader.cancel(); }
});

test('slow clients have bounded queued bytes and release their admission slot on overflow', async t => {
  isolated(t);
  environment(t, { SMARTSTORE_SSE_MAX_CONNECTIONS: '1' });
  const anchor = publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: 'slow-anchor' } });
  const response = await GET(request('slow-client', anchor.id));
  for (let index = 0; index < 400; index++) publishRealtimeEvent({ type: 'ad_created',
    payload: { listingId: `slow-${index}`, sellerId: 'owner', status: 'x'.repeat(1024) },
    visibility: { includePublic: true } });
  const reader = response.body!.getReader();
  let bytes = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; }
  assert.ok(bytes <= 64 * 1024);
  const replacement = await GET(request('replacement', 99999999));
  assert.equal(replacement.status, 200);
  await replacement.body!.cancel();
});

test('lifetime expiry closes streams and releases admission even without client cancellation', async t => {
  isolated(t);
  environment(t, { SMARTSTORE_SSE_MAX_CONNECTIONS: '1', SMARTSTORE_SSE_MAX_LIFETIME_MS: '110000' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const response = await GET(request('lifetime', 99999999));
  const reader = response.body!.getReader();
  await reader.read();
  t.mock.timers.tick(110000);
  assert.equal((await reader.read()).done, true);
  const replacement = await GET(request('lifetime-next', 99999999));
  assert.equal(replacement.status, 200);
  await replacement.body!.cancel();
});

test('Redis relay fans out between replicas without echo, preserves visibility and deduplicates lost acknowledgements', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'warn', () => {});
  const rows: Array<[string, string[]]> = [];
  let sequence = 0, lostResponse = true;
  const config = () => ({ url: 'https://redis.example.test', token: 'isolated', stream: 'test:stream' });
  const command = async (args: Array<string | number>) => {
    if (args[0] === 'EVAL') {
      rows.push([`${++sequence}-0`, ['envelope', String(args[4])]]);
      if (lostResponse) { lostResponse = false; throw new Error('response lost after commit'); }
      return rows.at(-1)![0];
    }
    const after = Number(String(args[5]).split('-')[0]);
    const next = rows.filter(row => Number(row[0].split('-')[0]) > after).slice(0, 32);
    return next.length ? [[config().stream, next]] : null;
  };
  const local: RealtimeEventEnvelope[] = [], remote: RealtimeEventEnvelope[] = [];
  const publisher = new RedisRealtimeRelay(event => local.push(event), command, config);
  const receiver = new RedisRealtimeRelay(event => remote.push(event), command, config);
  t.after(() => { publisher.stop(); receiver.stop(); });
  publisher.start(); receiver.start();
  await turn();
  publisher.publish(privateEvent());
  await turn();
  t.mock.timers.tick(1000); await turn();
  assert.equal(local.length, 0, 'publishing replica must not receive its own echo');
  assert.equal(remote.length, 1);
  assert.equal(isRealtimeEventVisibleToSubscriber(remote[0], { userId: 'owner', isAdmin: false }), true);
  assert.equal(isRealtimeEventVisibleToSubscriber(remote[0], { userId: 'stranger', isAdmin: false }), false);
  t.mock.timers.tick(1000); await turn();
  t.mock.timers.tick(1000); await turn();
  assert.equal(rows.length, 2, 'publisher retried a lost acknowledgement');
  assert.equal(remote.length, 1, 'duplicate shared entries use the same idempotency token');
  for (const event of [
    { ...privateEvent(), visibility: { includePublic: 'true', includeAdmins: false, userIds: [] } },
    { ...privateEvent(), id: 0 }, { ...privateEvent(), id: -1 },
    { ...privateEvent(), id: Number.MAX_SAFE_INTEGER + 1 }, { ...privateEvent(), occurredAt: 'invalid' },
  ]) rows.push([`${++sequence}-0`, ['envelope', JSON.stringify({ origin: 'bad', token: `bad-${sequence}`, event })]]);
  t.mock.timers.tick(1000); await turn();
  assert.equal(remote.length, 1, 'invalid visibility, IDs and timestamps are never relayed');
});

test('relay is immediate and performs no network work when unconfigured; unavailable publication retries are finite', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'warn', () => {});
  let calls = 0;
  const unavailable = async () => { calls++; throw new Error('offline'); };
  const disabled = new RedisRealtimeRelay(() => {}, unavailable, () => null);
  disabled.start(); disabled.publish(privateEvent()); await turn();
  assert.equal(calls, 0);
  const publisher = new RedisRealtimeRelay(() => {}, unavailable,
    () => ({ url: 'https://redis.example.test', token: 'isolated', stream: 'test' }));
  publisher.publish(privateEvent()); await turn();
  t.mock.timers.tick(2000); await turn();
  t.mock.timers.tick(2000); await turn();
  t.mock.timers.tick(20000); await turn();
  assert.equal(calls, 3);
  publisher.stop(); disabled.stop();
});

test('retained events obey a byte budget in addition to their item limit', t => {
  isolated(t);
  const anchor = publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: 'retained-budget' } });
  let lastId = anchor.id;
  for (let index = 0; index < 1100; index++) lastId = publishRealtimeEvent({ type: 'ad_created',
    payload: { listingId: `budget-${index}`, sellerId: 'owner', status: 'x'.repeat(5000) },
    visibility: { includePublic: true } }).id;
  const retained = getRealtimeEventsSince(anchor.id, { userId: null, isAdmin: false });
  assert.ok(retained.length > 0 && retained.length < 1100);
  assert.equal(retained.at(-1)!.id, lastId);
  assert.ok(retained.reduce((bytes, event) => bytes + Buffer.byteLength(JSON.stringify(event)), 0) <= 4 * 1024 * 1024);
});

test('default Redis REST transport sends structured commands and retries malformed successful responses', async t => {
  environment(t, { SMARTSTORE_REALTIME_BACKEND: '', UPSTASH_REDIS_REST_URL: 'https://redis.example.test/',
    UPSTASH_REDIS_REST_TOKEN: 'isolated-secret', SMARTSTORE_REALTIME_REDIS_STREAM: 'isolated:realtime' });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(console, 'warn', () => {});
  const commands: unknown[][] = [];
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(input, 'https://redis.example.test');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer isolated-secret');
    assert.equal(init?.redirect, 'error');
    const command = JSON.parse(String(init?.body)) as unknown[];
    commands.push(command);
    return Response.json(commands.length === 1 ? { invalid: 'not a Redis response' } : { result: '1-0' });
  });
  const relay = new RedisRealtimeRelay(() => {});
  relay.publish(privateEvent());
  await turn();
  t.mock.timers.tick(2000); await turn();
  assert.equal(commands.length, 2);
  assert.equal(commands[0][0], 'EVAL');
  assert.equal(commands[0][3], 'isolated:realtime');
  assert.equal(commands[0][4], commands[1][4], 'lost/invalid replies retain the same deduplication envelope');
  relay.stop();
});

test('one oversized hint cannot poison later replay or force an endless reconnect', async t => {
  isolated(t);
  t.mock.method(console, 'warn', () => {});
  const anchor = publishRealtimeEvent({ type: 'maintenance_cleanup', payload: { scope: 'oversized-anchor' } });
  const oversized = publishRealtimeEvent({ type: 'ad_created',
    payload: { listingId: 'oversized', sellerId: 'owner', status: 'x'.repeat(70000) }, visibility: { includePublic: true } });
  const valid = publishRealtimeEvent({ type: 'ad_created',
    payload: { listingId: 'valid-after-oversized', sellerId: 'owner', status: 'published' }, visibility: { includePublic: true } });
  const retained = getRealtimeEventsSince(anchor.id, { userId: null, isAdmin: false });
  assert.ok(!retained.some(event => event.id === oversized.id));
  const response = await GET(request('oversized-hint', anchor.id));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  await reader.read();
  const next = await reader.read();
  assert.equal(next.done, false);
  assert.match(decoder.decode(next.value), new RegExp(`id: ${valid.id}\\n`));
  await reader.cancel();
});
