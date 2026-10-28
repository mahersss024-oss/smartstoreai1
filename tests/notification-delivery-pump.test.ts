import assert from 'node:assert/strict';
import test from 'node:test';
import { startNotificationDeliveryPump } from '../scripts/notification-delivery-pump.mjs';
import { POST } from '@/app/api/internal/notifications/drain/route';
import { createSignedSession } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { guestContracts, routeContract } from '@/scripts/testing/route-contracts';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('notification supervisor calls only loopback with server credentials and stops on shutdown', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const calls: Array<{ url: string; headers: Headers }> = [];
  const secret = 'isolated-supervisor-fixture-secret';
  const stop = startNotificationDeliveryPump({ port: 3105, secret, enabled: true,
    fetch: async (input, init) => { calls.push({ url: String(input), headers: new Headers(init?.headers) }); return new Response(null); },
  });
  t.mock.timers.tick(15000); await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:3105/api/internal/notifications/drain');
  assert.equal(calls[0].headers.get('authorization'), `Bearer ${secret}`);
  stop(); t.mock.timers.tick(30000); await flush(); assert.equal(calls.length, 1);
});

test('supervisor never overlaps slow requests and shutdown aborts pending delivery polling', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let calls = 0, aborted = false;
  const stop = startNotificationDeliveryPump({ port: '3000', secret: 'isolated-supervisor-fixture-secret', enabled: true,
    fetch: async (_input, init) => { calls++; return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('stopped')); });
    }); },
  });
  t.mock.timers.tick(15000); await flush(); t.mock.timers.tick(15000); await flush();
  assert.equal(calls, 1); stop(); await flush(); assert.equal(aborted, true);
});

test('notification maintenance inventory records its separate server credential contract', () => {
  const endpoint = buildInventory().items.find(item => item.id === 'POST /api/internal/notifications/drain');
  assert.ok(endpoint);
  assert.equal(routeContract(endpoint), 'guest', 'registry uses this group for public flows and alternate credentials');
  assert.match(guestContracts[endpoint.id], /Server Worker credential/);
  assert.match(guestContracts[endpoint.id], /customer sessions never authorize/);
});

test('notification maintenance accepts only its server credential, never customer or admin sessions', async t => {
  const previous = { secret: process.env.SMARTSTORE_IMAGE_WORKER_SECRET, store: process.env.SMARTSTORE_MARKETPLACE_STORE, auth: process.env.AUTH_SECRET };
  const secret = 'isolated-notification-route-worker-secret';
  process.env.SMARTSTORE_IMAGE_WORKER_SECRET = secret;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  process.env.AUTH_SECRET = 'isolated-notification-route-session-secret';
  t.after(() => {
    for (const [key, value] of Object.entries({ SMARTSTORE_IMAGE_WORKER_SECRET: previous.secret, SMARTSTORE_MARKETPLACE_STORE: previous.store, AUTH_SECRET: previous.auth })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const customer = createSignedSession({ id: 'notification-customer', email: 'customer@example.test', role: 'user' });
  const admin = createSignedSession({ id: 'notification-admin', email: 'admin@example.test', role: 'admin' });
  const headers: HeadersInit[] = [{}, { Authorization: 'Bearer forged-worker-secret' },
    { Authorization: `Bearer ${customer}` }, { Cookie: `smartstore_session=${admin}` }];
  for (const value of headers) {
    const response = await POST(new Request('http://localhost/api/internal/notifications/drain', { method: 'POST', headers: value }));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'worker_auth_required');
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  }
  const response = await POST(new Request('http://localhost/api/internal/notifications/drain', { method: 'POST', headers: { Authorization: `Bearer ${secret}` } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { inspected: 0, completed: 0, retried: 0 });
  assert.throws(() => startNotificationDeliveryPump({ port: '3000/path', secret, enabled: true }), /invalid_local_notification_port/);
});
