import { expect, test } from '@playwright/test';
import { buildInventory } from '@/scripts/testing/inventory';
import { concretePath } from '@/scripts/testing/route-contracts';
import { prepare, listing, customer, pagination, now, ownerFixtureEmail } from './helpers/admin-presentation-fixture';
import { observePageVitals, readPageVitals } from './helpers/page-vitals';

// Trace screencasting adds presentation latency to the timing being measured.
// Keep post-measurement screenshots and metric attachments without recording frames during input.
// This suite measures rendered pages with intercepted client data, rather than
// service-worker caching or delivery of analytics to the shared test server.
test.use({ trace: 'off', serviceWorkers: 'block' });

const pages = buildInventory().items.filter(item =>
  item.kind === 'page' && (item.path === '/admin' || item.path?.startsWith('/admin/')));
const layouts = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
];

for (const entry of pages) {
  for (const viewport of layouts) {
    test(`page vitals ${entry.path} ${viewport.width}`, async ({ page, baseURL }, info) => {
      test.setTimeout(45_000);
      expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
      const role = entry.path!.startsWith('/admin') ? 'owner' : 'user';
      await prepare(page, baseURL!, role);
      await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
      const analyticsVisits: string[] = [];
      await page.route('**/api/analytics/visit', route => {
        expect(route.request().method()).toBe('POST');
        const payload = route.request().postDataJSON() as { path: string };
        analyticsVisits.push(payload.path);
        // Repeated page matrices share a server/IP. Keep telemetry outside this
        // rendering fixture; the real endpoint's limits are tested separately.
        return route.fulfill({ json: { ok: true } });
      });
      await page.route('**/api/auth/session', route => route.fulfill({ json: {
        authenticated: true, commissionAgreementAccepted: true, commissionAgreement: null,
        user: { id: 'presentation-admin', name: 'Performance account', email: role === 'owner' ? ownerFixtureEmail : 'performance@example.test', role },
      } }));
      await page.route('**/api/realtime/stream**', route => route.fulfill({
        contentType: 'text/event-stream', body: 'retry: 60000\nevent: heartbeat\ndata: {}\n\n',
      }));
      const conversation = {
        id: 'performance-conversation', listingId: listing.id, listing,
        sellerId: customer.id, buyerId: 'presentation-admin', status: 'open', updatedAt: now,
        seller: customer, buyer: { id: 'presentation-admin', name: 'Performance account' },
        messages: [{ id: 'performance-message', conversationId: 'performance-conversation',
          senderId: customer.id, body: 'Performance fixture message', status: 'sent', reasons: [], createdAt: now }],
      };
      await page.route('**/api/marketplace/**', async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET') return route.fallback();
        const json = path.endsWith('/me/conversations') ? { conversations: [conversation], pagination }
          : path.endsWith('/performance-conversation') ? { conversation, blockStatus: null }
          : path.endsWith('/me/listings') || path === '/api/marketplace/listings' ? { listings: [listing], pagination }
          : path.endsWith('/me/favorites') ? { favorites: [{ id: 'performance-favorite', listingId: listing.id, createdAt: now, listing }], pagination }
          : path.endsWith('/me/follows') ? { following: [], followers: [], similarListingFollows: [], followingCount: 0, followerCount: 0, similarListingFollowCount: 0 }
          : path.endsWith('/me/commissions') ? { commissions: [], pagination }
          : path.endsWith('/commission-payment-methods') ? { paymentMethods: [] }
          : path.endsWith('/favorite') ? { isFavorite: false }
          : path.endsWith('/reports') ? { reported: false, alreadyReported: false }
          : path.endsWith('/similar-follow') || path.endsWith('/follow') ? { following: false, isFollowing: false, followerCount: 0 }
          : path.endsWith('/ratings') ? { ratings: [], averageRating: 0, ratingCount: 0 }
          : null;
        if (json) return route.fulfill({ json });
        return route.fallback();
      });
      await page.route('**/api/notifications**', route => route.request().method() === 'GET'
        ? route.fulfill({ json: { notifications: [], unreadCount: 0 } }) : route.fallback());
      const errors: string[] = [];
      const failedApis: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/api/')) {
          failedApis.push(`${response.status()} ${response.url()}`);
        }
      });
      await observePageVitals(page);
      await page.setViewportSize(viewport);
      const path = concretePath(entry.path!, {
        listingId: 'e2e-report-desktop-chromium', sellerId: 'e2e-report-seller',
        conversationId: conversation.id,
      });
      const response = await page.goto(path, { waitUntil: 'load' });
      await expect(page).toHaveURL(url => url.pathname === path);
      await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
      await page.evaluate(() => document.fonts.ready);
      // Pages can keep background/prefetch requests open. Readiness is the app's
      // rendered state and visible image decoding, not a silent network.
      await expect.poll(() => page.evaluate(() => [...document.images]
        .filter(image => image.loading !== 'lazy' && image.getBoundingClientRect().width > 0)
        .every(image => image.complete))).toBe(true);
      await page.evaluate(() => Promise.all([...document.images]
        .filter(image => image.complete && image.naturalWidth > 0)
        .map(image => image.decode())));
      await page.waitForTimeout(1000);
      const text = await page.locator('body').innerText();
      expect(text.trim().length).toBeGreaterThan(10);
      await expect(page.locator('body')).not.toContainText('Application error:');
      // Focus navigation exercises trusted key interactions without invoking writes.
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
      }
      await page.waitForTimeout(250);
      await expect.poll(() => analyticsVisits).toContain(path);
      const vitals = await readPageVitals(page);
      const result = { route: entry.path, path, viewport, role, status: response?.status(),
        finalUrl: page.url(), fixtureMode: 'local production build; mocked client data; seeded SSR listing/seller',
        vitals, errors, failedApis };
      console.log(JSON.stringify({ allPageVitals: result }));
      await info.attach('page-vitals', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath('page.png'), fullPage: false });
      expect.soft(response?.status()).toBe(200);
      expect.soft(errors).toEqual([]);
      expect.soft(failedApis).toEqual([]);
      expect.soft(vitals.lcp, 'LCP must be measured, not treated as zero').not.toBeNull();
      expect.soft(vitals.lcp, 'LCP <= 2500 ms').toBeLessThanOrEqual(2500);
      expect.soft(vitals.cls, 'CLS <= 0.1').toBeLessThanOrEqual(0.1);
      expect.soft(vitals.trustedKeydowns, 'trusted interactions were exercised').toBeGreaterThan(0);
      expect.soft(vitals.supported).toContain('event');
      if (vitals.interactionMax !== null) {
        expect.soft(vitals.interactionMax, 'sampled interaction latency <= 200 ms').toBeLessThanOrEqual(200);
      } else {
        expect.soft(vitals.interactionBelowReportingThreshold, 'no sample must not be reported as zero INP').toBe(true);
      }
      expect.soft(vitals.horizontalOverflow).toBeLessThanOrEqual(1);
    });
  }
}
