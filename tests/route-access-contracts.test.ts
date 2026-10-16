import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { createSessionCookie } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath, routeContract, staffDeniedError } from '@/scripts/testing/route-contracts';

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

const endpoints = buildInventory().items.filter(item => item.kind === 'endpoint' &&
  ['session', 'staff'].includes(routeContract(item) ?? ''));

test('all protected route methods reject missing, forged and expired sessions before performing work', async t => {
  const previousStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  process.env.AUTH_SECRET = 'isolated-route-contract-test-secret';
  const payload = Buffer.from(JSON.stringify({
    user: { id: 'expired-contract', email: 'expired@example.test', role: 'admin' },
    issuedAt: 1, expiresAt: 2,
  })).toString('base64url');
  const expired = `${payload}.${createHmac('sha256', process.env.AUTH_SECRET).update(payload).digest('base64url')}`;
  try {
    for (const endpoint of endpoints) {
      await t.test(endpoint.id, async () => {
        const handlers = await import(pathToFileURL(resolve(endpoint.file)).href) as Record<string, Handler>;
        const params = Object.fromEntries([...endpoint.path!.matchAll(/\[([^\]]+)\]/g)]
          .map(match => [match[1], `contract-missing-${match[1]}`]));
        for (const cookie of ['', 'smartstore_session=forged-admin', `smartstore_session=${expired}`]) {
          const response = await handlers[endpoint.method!](new Request(`http://localhost${concretePath(endpoint.path!)}`, {
            method: endpoint.method,
            headers: cookie ? { Cookie: cookie } : {},
          }), { params: Promise.resolve(params) });
          assert.equal(response.status, 401, `${endpoint.id}: ${cookie ? 'invalid session' : 'guest'}`);
          assert.equal((await response.json()).error, 'auth_required');
        }
        if (routeContract(endpoint) === 'staff') {
          const cookie = createSessionCookie({ id: 'route-contract-customer', email: 'customer@example.test', role: 'user' }).split(';')[0];
          const response = await handlers[endpoint.method!](new Request(`http://localhost${concretePath(endpoint.path!)}`, {
            method: endpoint.method, headers: { Cookie: cookie },
          }), { params: Promise.resolve(params) });
          assert.equal(response.status, 403, `${endpoint.id}: ordinary customer cannot act as staff`);
          assert.equal((await response.json()).error, staffDeniedError(endpoint.path!));
        }
      });
    }
  } finally {
    if (previousStore === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previousStore;
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  }
});
