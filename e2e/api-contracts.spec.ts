import { expect, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath, routeContract, staffDeniedError } from '@/scripts/testing/route-contracts';

const endpoints = buildInventory().items.filter(item => item.kind === 'endpoint');

// Request-only contracts run without a browser and never target production.
test.beforeEach(async ({ baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
});

for (const file of [...new Set(endpoints.map(endpoint => endpoint.file))]) {
  const methods = endpoints.filter(endpoint => endpoint.file === file);
  test(`HTTP method routing: ${methods[0].path}`, async ({ request }) => {
    const path = concretePath(methods[0].path!);
    const options = await request.fetch(path, { method: 'OPTIONS' });
    expect(options.status()).toBe(204);
    const allowed = options.headers().allow?.split(',').map(method => method.trim());
    for (const endpoint of methods) expect(allowed).toContain(endpoint.method);
    expect(allowed).toContain('OPTIONS');
    const unsupportedMethod = ['PUT', 'PATCH', 'DELETE', 'POST', 'GET'].find(method =>
      !methods.some(endpoint => endpoint.method === method));
    if (unsupportedMethod) {
      const unsupported = await request.fetch(path, { method: unsupportedMethod, maxRedirects: 0 });
      expect(unsupported.status()).toBe(405);
    }
  });
}

test('deployed protected handlers reject guests and customer access to staff routes', async ({ request }) => {
  test.setTimeout(90_000);
  const cookie = createSessionCookie({ id: 'http-route-customer', email: 'http-customer@example.test', role: 'user' }).split(';')[0];
  for (const endpoint of endpoints.filter(endpoint => ['session', 'staff'].includes(routeContract(endpoint) ?? ''))) {
    await test.step(endpoint.id, async () => {
      const response = await request.fetch(concretePath(endpoint.path!), { method: endpoint.method });
      expect(response.status(), endpoint.id).toBe(401);
      expect((await response.json()).error).toBe('auth_required');
      if (routeContract(endpoint) === 'staff') {
        const denied = await request.fetch(concretePath(endpoint.path!), {
          method: endpoint.method, headers: { Cookie: cookie },
        });
        expect(denied.status(), endpoint.id).toBe(403);
        expect((await denied.json()).error).toBe(staffDeniedError(endpoint.path!));
      }
    });
  }
});
