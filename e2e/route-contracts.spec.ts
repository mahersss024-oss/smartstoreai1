import { expect, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath } from '@/scripts/testing/route-contracts';

const inventory = buildInventory();
const pages = inventory.items.filter(item =>
  item.kind === 'page' && (item.path === '/admin' || item.path?.startsWith('/admin/')));

test.beforeEach(async ({ baseURL, page }) => {
  // This suite exercises real routes and must never target the live marketplace.
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

for (const entry of pages) {
  for (const role of ['guest', 'customer'] as const) {
    test(`page renders without client crashes: ${role} ${entry.path}`, async ({ page, baseURL }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const ownerOnlyPage = entry.path === '/admin/maintenance';
      const guestAdmin = role === 'guest' && entry.path!.startsWith('/admin') && !ownerOnlyPage;
      let authStarts = 0;
      if (guestAdmin) {
        // Verify the real auth redirect without contacting a live identity provider.
        await page.route('**/api/auth/google/start**', route => {
          authStarts++;
          return route.fulfill({ status: 302, headers: { location: '/privacy?contract-auth-required=1' } });
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
      if (ownerOnlyPage && role === 'guest') {
        // The server layout redirects before hydration. Verify that contract
        // directly; a browser route mock cannot replace a later redirect hop.
        const denied = await page.request.get(path, { maxRedirects: 0 });
        expect(denied.status()).toBe(307);
        const authUrl = new URL(denied.headers().location, baseURL!);
        expect(authUrl.pathname).toBe('/api/auth/google/start');
        expect(authUrl.searchParams.get('return_to')).toBe(path);
      }
      const response = await page.goto(path);
      const ownerDenied = ownerOnlyPage && role === 'customer';
      expect(response?.status()).toBe(ownerDenied ? 404 : 200);
      await expect(page.locator('body')).toBeVisible();
      await expect.poll(() => page.locator('body').innerText()).not.toBe('');
      // A server notFound response intentionally has no hydrated app shell.
      if (!ownerDenied) await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
      if (ownerDenied) await expect(page.locator('.admin-page')).toHaveCount(0);
      const expectedPath = ownerOnlyPage && role === 'guest'
        ? '/commission-agreement'
        : guestAdmin
        ? '/privacy'
        : role === 'guest' && entry.path === '/conversations/[conversationId]'
          ? '/commission-agreement'
          : path;
      await expect(page).toHaveURL(url => url.pathname === expectedPath);
      if (guestAdmin) await expect.poll(() => authStarts).toBe(1);
      if (ownerOnlyPage && role === 'guest') {
        const agreementUrl = new URL(page.url());
        expect(agreementUrl.searchParams.get('provider')).toBe('google');
        expect(agreementUrl.searchParams.get('return_to')).toBe(path);
      }
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
