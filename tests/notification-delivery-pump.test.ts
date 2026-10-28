import assert from 'node:assert/strict';
import test from 'node:test';
import { startNotificationDeliveryPump } from '../scripts/notification-delivery-pump.mjs';
import { POST } from '@/app/api/internal/notifications/drain/route';
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

test('notification maintenance rejects public and malformed callers before database access', async () => {
  const response = await POST(new Request('http://localhost/api/internal/notifications/drain', { method: 'POST' }));
  assert.equal(response.status, 401); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  assert.throws(() => startNotificationDeliveryPump({ port: '3000/path', secret: 'isolated-supervisor-fixture-secret', enabled: true }), /invalid_local_notification_port/);
});
