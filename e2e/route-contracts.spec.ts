import { expect, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath, routeContract, staffDeniedError } from '@/scripts/testing/route-contracts';

const inventory = buildInventory();
const endpoints = inventory.items.filter(item => item.kind === 'endpoint');
const pages = inventory.items.filter(item => item.kind === 'page');

test.beforeEach(async ({ baseURL, page }) => {
  // This suite exercises real routes and must never target the live marketplace.
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
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

for (const entry of pages) {
  for (const role of ['guest', 'customer'] as const) {
    test(`page renders without client crashes: ${role} ${entry.path}`, async ({ page, baseURL }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const guestAdmin = role === 'guest' && entry.path!.startsWith('/admin');
      let authStarts = 0;
      if (guestAdmin) {
        // Verify the real auth redirect without contacting a live identity provider.
        await page.route('**/api/auth/google/start**', route => {
          authStarts++;
          return route.fulfill({ status: 302, headers: { location: '/account?contract-auth-required=1' } });
        });
      }
      if (role === 'customer') {
        const value = createSessionCookie({ id: 'page-route-customer', email: 'page-customer@example.test', role: 'user' })
          .split(';')[0].split('=').slice(1).join('=');
        await page.context().addCookies([{ name: 'smartstore_session', value: decodeURIComponent(value), url: baseURL! }]);
      }
      const path = concretePath(entry.path!, {
        listingId: `e2e-report-${info.project.name}`,
        sellerId: 'e2e-report-seller',
      });
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('body')).toBeVisible();
      await expect.poll(() => page.locator('body').innerText()).not.toBe('');
      await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
      const expectedPath = guestAdmin || (role === 'guest' && entry.path === '/account/seller-profile')
        ? '/account'
        : role === 'guest' && entry.path === '/conversations/[conversationId]'
          ? '/commission-agreement'
          : path;
      await expect(page).toHaveURL(url => url.pathname === expectedPath);
      if (guestAdmin) await expect.poll(() => authStarts).toBe(1);
      await page.waitForTimeout(300);
      expect(errors).toEqual([]);
      await expect(page.locator('body')).not.toContainText('Application error:');
      // This is a rendering/access check, not evidence that these controls were clicked.
      const controls = await page.locator('button, a, input, select, textarea, [role="button"], [role="switch"]').evaluateAll(elements =>
        elements.map(element => ({
          tag: element.tagName,
          text: element.textContent?.trim().slice(0, 160),
          label: element.getAttribute('aria-label'),
          href: element.getAttribute('href'),
          disabled: element.hasAttribute('disabled'),
        })));
      await info.attach('discovered-controls-not-click-coverage', { body: JSON.stringify({ path, finalUrl: page.url(), role, controls }, null, 2), contentType: 'application/json' });
    });
  }
}
