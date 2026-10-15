import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('pending visible images use alternatives without timing out offscreen lazy images', async ({ page }) => {
  test.setTimeout(45_000);
  const image = await readFile('public/hamad-market-logo.webp');
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/marketplace/listings?**', route => route.fulfill({ json: {
    listings: Array.from({ length: 24 }, (_, index) => ({
      id: `pending-${index}`, title: `Pending desk ${index}`, category: 'furniture', city: 'Riyadh',
      price: 100, status: 'published', createdAt: '2026-10-15T00:00:00Z',
      images: [{ status: 'approved', thumbnailUrl: `/pending/${index}-thumbnail.webp`,
        displayUrl: `/pending/${index}-display.webp`, originalUrl: `/pending/${index}-original.webp` }],
    })), pagination: { page: 1, hasMore: false },
  } }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const urls: string[] = [];
  await page.route('**/pending/**', async route => {
    const url = route.request().url();
    urls.push(url);
    if (url.endsWith('/0-thumbnail.webp') || url.endsWith('/23-thumbnail.webp')) await held;
    if (url.endsWith('/1-thumbnail.webp')) {
      await route.fulfill({ status: 404 });
    } else {
      await route.fulfill({ contentType: 'image/webp', body: image });
    }
  });
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const cards = page.locator('.marketplace-listings-scroll .marketplace-listing-card');
    await expect(cards).toHaveCount(24);
    await expect(cards.nth(1).locator('img')).toHaveAttribute('src', '/pending/1-display.webp');
    const firstBox = await cards.first().boundingBox();
    await expect(cards.first().locator('img')).toHaveAttribute('src', '/pending/0-display.webp', { timeout: 20_000 });
    await expect.poll(() => cards.first().locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    const nextBox = await cards.first().boundingBox();
    expect(nextBox!.height).toBeCloseTo(firstBox!.height, 2);
    await expect(cards.last().locator('img')).toHaveAttribute('src', '/pending/23-thumbnail.webp');
    expect(urls.some(url => url.includes('imageRetry='))).toBe(false);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('first listing image loads promptly without changing card geometry or loading originals', async ({ page }, testInfo) => {
  const image = await readFile('public/hamad-market-logo.webp');
  const requestedImages: string[] = [];
  let listingRequests = 0;
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    localStorage.setItem('theme', 'light');
    const metrics = { cls: 0, lcp: 0 };
    Object.assign(window, { listingImageMetrics: metrics });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!shift.hadRecentInput) metrics.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => {
      metrics.lcp = list.getEntries().at(-1)?.startTime ?? 0;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.route('**/api/marketplace/listings?**', async route => {
    listingRequests++;
    await new Promise(resolve => setTimeout(resolve, 200));
    await route.fulfill({ json: {
      listings: Array.from({ length: 24 }, (_, index) => ({
        id: `image-timing-${index}`, title: `Desk ${index}`, category: 'furniture',
        city: 'Riyadh', price: 100, status: 'published',
        createdAt: '2026-10-15T00:00:00Z',
        images: [{ status: 'approved',
          thumbnailUrl: `/image-timing/${index}-thumbnail.webp`,
          displayUrl: `/image-timing/${index}-display.webp`,
          originalUrl: `/image-timing/${index}-original.webp`,
        }],
      })), pagination: { page: 1, hasMore: false },
    } });
  });
  await page.route('**/image-timing/**', async route => {
    requestedImages.push(route.request().url());
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({ contentType: 'image/webp', body: image });
  });
  await page.goto('/');
  const cards = page.locator('.marketplace-listings-scroll .marketplace-listing-card');
  await expect(cards).toHaveCount(24);
  const first = cards.first().locator('img');
  await expect(first).toHaveAttribute('loading', 'eager');
  await expect(first).toHaveAttribute('fetchpriority', 'high');
  await expect(first).toHaveAttribute('width', '116');
  await expect(first).toHaveAttribute('height', '116');
  await expect(first).toHaveAttribute('src', '/image-timing/0-thumbnail.webp');
  await expect.poll(() => first.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(cards.nth(4).locator('img')).toHaveAttribute('loading', 'lazy');
  await expect(cards.nth(1).locator('img')).toHaveAttribute('loading', 'eager');
  await expect(cards.nth(1).locator('img')).toHaveAttribute('fetchpriority', 'auto');
  await expect(page.locator('link[rel="preload"][as="image"][href="/image-timing/0-thumbnail.webp"]')).toHaveCount(1);
  await expect(page.locator('link[rel="preconnect"][href="https://images.souqhamad.com"]')).toHaveCount(1);
  // Let the paint observers deliver their final entries, without scrolling or clicking.
  await page.waitForTimeout(500);
  const metrics = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const data = resources.find(entry => entry.name.includes('/api/marketplace/listings?'));
    const image = resources.find(entry => entry.name.endsWith('/image-timing/0-thumbnail.webp'));
    return {
      ...(window as unknown as { listingImageMetrics: { cls: number; lcp: number } }).listingImageMetrics,
      documentTtfb: navigation ? navigation.responseStart - navigation.requestStart : null,
      domContentLoaded: navigation?.domContentLoadedEventEnd,
      dataStart: data?.startTime, dataEnd: data?.responseEnd,
      imageStart: image?.startTime, imageEnd: image?.responseEnd,
      imageDiscoveryDelay: data && image ? image.startTime - data.responseEnd : null,
      highPriorityImages: document.querySelectorAll('.marketplace-listing-card img[fetchpriority="high"]').length,
    };
  });
  console.log(JSON.stringify({ project: testInfo.project.name, listingImageLoading: metrics }));
  await testInfo.attach('image-loading-metrics', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
  await page.waitForLoadState('networkidle');
  const beforeToggle = { listings: listingRequests, images: requestedImages.length };
  const originalImage = await first.elementHandle();
  const imageSize = await first.boundingBox();
  const toggle = page.getByRole('button', { name: /^الوضع (الداكن|الفاتح)$/ });
  for (const dark of [true, false]) {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', dark ? 'الوضع الفاتح' : 'الوضع الداكن');
    await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(dark);
    await page.waitForLoadState('networkidle');
    expect(await originalImage!.evaluate(element => element.isConnected)).toBe(true);
    await expect(first).toHaveAttribute('src', '/image-timing/0-thumbnail.webp');
    const nextSize = await first.boundingBox();
    expect(nextSize?.width).toBe(imageSize?.width);
    expect(nextSize?.height).toBe(imageSize?.height);
    expect(listingRequests).toBe(beforeToggle.listings);
    expect(requestedImages).toHaveLength(beforeToggle.images);
  }
  console.log(JSON.stringify({ project: testInfo.project.name, themeNetwork: {
    before: beforeToggle, after: { listings: listingRequests, images: requestedImages.length },
  } }));
  expect(metrics.cls).toBeLessThanOrEqual(0.1);
  expect(metrics.highPriorityImages).toBe(1);
  expect(metrics.lcp).toBeGreaterThan(0);
  expect(metrics.lcp).toBeLessThanOrEqual(2_500);
  expect(requestedImages.filter(url => url.endsWith('/0-thumbnail.webp'))).toHaveLength(1);
  expect(requestedImages.every(url => url.endsWith('-thumbnail.webp'))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('first-listing.png') });
});
