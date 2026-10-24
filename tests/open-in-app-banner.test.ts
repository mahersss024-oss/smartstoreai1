import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('open in app banner is mobile-only and persistent', () => {
  const component = readFileSync(
    join(process.cwd(), 'components', 'open-in-app-banner.tsx'),
    'utf8',
  );
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  assert.match(component, /isInsideNativeApp/);
  assert.match(component, /detectMobilePlatform/);
  assert.doesNotMatch(component, /dismissedKey/);
  assert.doesNotMatch(component, /localStorage/);
  assert.doesNotMatch(component, /aria-label="إغلاق شريط فتح التطبيق"/);
  assert.doesNotMatch(component, /\/hamad-market-logo\.webp/);
  assert.match(component, /تجربة أفضل عبر التطبيق/);
  assert.match(component, /aria-label="فتح سوق حمد في التطبيق"/);
  assert.match(component, /\/api\/auth\/mobile\/open/);
  assert.doesNotMatch(component, /className="[^"]*(?:fixed|sticky)[^"]*"/);
  assert.match(layout, /<OpenInAppBanner \/>/);
  assert.doesNotMatch(layout, /PwaInstallPrompt/);
});

test('mobile open endpoint creates safe app links without exposing long sessions', () => {
  const route = readFileSync(
    join(process.cwd(), 'app', 'api', 'auth', 'mobile', 'open', 'route.ts'),
    'utf8',
  );
  const exchangeRoute = readFileSync(
    join(process.cwd(), 'app', 'api', 'auth', 'mobile', 'exchange', 'route.ts'),
    'utf8',
  );

  assert.match(route, /createMobileAuthTicket/);
  assert.match(route, /com\.souqhamad\.app/);
  assert.match(route, /getMobileAppStoreUrl/);
  assert.match(route, /fallbackUrl = storeUrl \?\? webUrl/);
  assert.doesNotMatch(route, /play\.google\.com\/store\/apps\/details/);
  assert.match(route, /function normalizeNextPath/);
  assert.match(route, /value\.startsWith\('\/\/'\)/);
  assert.match(route, /noStoreHeaders/);
  assert.match(exchangeRoute, /normalizeNextPath/);
  assert.match(exchangeRoute, /url\.searchParams\.get\('next'\)/);
});
