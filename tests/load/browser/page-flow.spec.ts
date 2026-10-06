import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

type PageMetric = {
  route: string;
  status: number | null;
  requests: number;
  duplicateRequests: number;
  imageRequests: number;
  apiRequests: number;
  transferredBytes: number;
  domContentLoadedMs: number;
  loadMs: number;
  fcpMs: number | null;
  lcpMs: number | null;
  cls: number | null;
};

const routes = ['/', '/account', '/conversations', '/favorites', '/notifications'];

function isProductionUrl(value: string) {
  return /souqhamad\.com\/?$/i.test(value);
}

test.beforeAll(() => {
  const baseUrl = process.env.K6_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? '';
  if (isProductionUrl(baseUrl) && process.env.ALLOW_PRODUCTION_LOAD_TEST !== 'true') {
    throw new Error('Production browser checks require ALLOW_PRODUCTION_LOAD_TEST=true.');
  }
});

test('page flow browser metrics', async ({ page }, testInfo) => {
  const metrics: PageMetric[] = [];

  for (const route of routes) {
    const seen = new Map<string, number>();
    let requestCount = 0;
    let imageRequests = 0;
    let apiRequests = 0;
    let transferredBytes = 0;

    page.removeAllListeners('request');
    page.removeAllListeners('response');

    page.on('request', (request) => {
      requestCount += 1;
      const requestUrl = request.url();
      seen.set(requestUrl, (seen.get(requestUrl) ?? 0) + 1);
      if (request.resourceType() === 'image') imageRequests += 1;
      if (requestUrl.includes('/api/')) apiRequests += 1;
    });

    page.on('response', async (response) => {
      const header = response.headers()['content-length'];
      const bytes = header ? Number.parseInt(header, 10) : 0;
      if (Number.isFinite(bytes)) transferredBytes += bytes;
    });

    const response = await page.goto(route, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const timing = await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find((entry) => entry.name === 'first-contentful-paint');
      const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
      const clsEntries = performance.getEntriesByType('layout-shift') as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>;
      return {
        domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
        loadMs: navigation?.loadEventEnd ?? 0,
        fcpMs: fcp?.startTime ?? null,
        lcpMs: lcpEntries.at(-1)?.startTime ?? null,
        cls: clsEntries
          .filter((entry) => !entry.hadRecentInput)
          .reduce((total, entry) => total + (entry.value ?? 0), 0),
      };
    });

    metrics.push({
      route,
      status: response?.status() ?? null,
      requests: requestCount,
      duplicateRequests: [...seen.values()].filter((count) => count > 1).length,
      imageRequests,
      apiRequests,
      transferredBytes,
      ...timing,
    });

    expect(response?.status()).toBeLessThan(500);
  }

  const outputPath = resolve(testInfo.config.rootDir, '..', 'reports', 'browser-page-flow.json');
  mkdirSync(resolve(testInfo.config.rootDir, '..', 'reports'), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(metrics, null, 2));
});
