import { expect, type Page, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

type VitalsSnapshot = {
  cls: number;
  fcp: number;
  inp: number;
  inpEvent: string;
  lcp: number;
  lcpElement: string;
  longTasks: number;
  totalBlockingTime: number;
  domContentLoaded: number;
  loadEvent: number;
  ttfb: number;
  transferSize: number;
  encodedBodySize: number;
  resourceCount: number;
  imageCount: number;
  scriptCount: number;
  stylesheetCount: number;
  domNodes: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
};

type LargestContentfulPaintEntry = PerformanceEntry & {
  element?: Element | null;
};

type PaintTimingEntry = PerformanceEntry & {
  name: 'first-paint' | 'first-contentful-paint';
};

type EventTimingEntry = PerformanceEntry & {
  interactionId?: number;
  target?: Element | null;
};

type PerformanceMemory = {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
};

const viewports = [
  { name: 'mobile-small', width: 320, height: 568 },
  { name: 'mobile', width: 360, height: 800 },
  { name: 'mobile-common', width: 375, height: 812 },
  { name: 'mobile-large', width: 390, height: 844 },
  { name: 'mobile-xl', width: 430, height: 932 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'tablet-large', width: 1024, height: 1366 },
] as const;

const auditedPages = [
  { name: 'home', path: '/', requireAdmin: false },
  { name: 'admin-home', path: '/admin', requireAdmin: true },
  { name: 'admin-audit-log', path: '/admin/audit-log', requireAdmin: true },
] as const;

const imagePath = '/hamad-market-logo.webp?v=performance-audit';

function sessionCookieValue() {
  const cookie = createSessionCookie({
    id: 'e2e-admin',
    email: 'e2e-admin@smartstore.local',
    name: 'E2E Admin',
    role: 'admin',
  });

  return cookie.split(';')[0]?.split('=').slice(1).join('=') ?? '';
}

async function addAdminSession(baseURL: string | undefined, page: Page) {
  await page.context().addCookies([
    {
      name: 'smartstore_session',
      value: decodeURIComponent(sessionCookieValue()),
      url: baseURL ?? 'http://127.0.0.1:3102',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function mockStableData(page: Page) {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        commissionAgreement: null,
        commissionAgreementAccepted: true,
        user: {
          id: 'e2e-admin',
          email: 'e2e-admin@smartstore.local',
          name: 'E2E Admin',
          role: 'admin',
        },
      }),
    });
  });

  await page.route('**/api/admin/overview', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        totalUsers: 42,
        activeUsers: 17,
        publishedListings: 28,
        openReports: 3,
      }),
    });
  });

  await page.route('**/api/admin/audit-log**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        records: [
          {
            id: 'audit-1',
            action: 'approve_listing',
            targetType: 'listing',
            targetId: 'listing-1',
            metadata: { status: 'published' },
            createdAt: '2026-10-13T08:00:00.000Z',
            admin: {
              id: 'e2e-admin',
              email: 'e2e-admin@smartstore.local',
              name: 'E2E Admin',
            },
          },
        ],
        pagination: { page: 1, limit: 25, hasMore: false, total: 1 },
      }),
    });
  });

  await page.route('**/api/marketplace/listings**', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }

    await route.fulfill({
      headers: {
        'cache-control': 'public, max-age=30, stale-while-revalidate=60',
      },
      contentType: 'application/json',
      body: JSON.stringify({
        listings: Array.from({ length: 8 }, (_, index) => ({
          id: `listing-${index + 1}`,
          sellerId: 'seller-1',
          category: 'electronics',
          title: `إعلان اختبار الأداء ${index + 1}`,
          description: 'وصف قصير ثابت لاختبار ثبات البطاقات.',
          price: 100 + index,
          city: 'الرياض',
          image: imagePath,
          imageUrls: [imagePath],
          status: 'published',
          views: index,
          messageCount: index % 2,
          favoriteCount: index % 3,
          createdAt: '2026-10-13T08:00:00.000Z',
          images: [
            {
              thumbnailUrl: imagePath,
              displayUrl: imagePath,
              originalUrl: imagePath,
              status: 'ready',
            },
          ],
        })),
        pagination: { page: 1, limit: 24, hasMore: false, nextPage: null },
      }),
    });
  });
}

async function installVitalsObserver(page: Page) {
  await page.addInitScript(() => {
    window.__smartstorePerf = {
      cls: 0,
      fcp: 0,
      inp: 0,
      inpEvent: '',
      lcp: 0,
      lcpElement: '',
      longTasks: 0,
      totalBlockingTime: 0,
      domContentLoaded: 0,
      loadEvent: 0,
      ttfb: 0,
      transferSize: 0,
      encodedBodySize: 0,
      resourceCount: 0,
      imageCount: 0,
      scriptCount: 0,
      stylesheetCount: 0,
      domNodes: 0,
    };

    const describeElement = (element: Element | null | undefined) => {
      if (!element) return '';
      const id = element.id ? `#${element.id}` : '';
      const className =
        typeof element.className === 'string'
          ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : '';
      return `${element.tagName.toLowerCase()}${id}${className}`;
    };

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as LayoutShiftEntry[]) {
          if (!entry.hadRecentInput) {
            window.__smartstorePerf.cls += entry.value ?? 0;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PaintTimingEntry[]) {
          if (entry.name === 'first-contentful-paint') {
            window.__smartstorePerf.fcp = entry.startTime;
          }
        }
      }).observe({ type: 'paint', buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as LargestContentfulPaintEntry;
        if (last) {
          window.__smartstorePerf.lcp = last.startTime;
          window.__smartstorePerf.lcpElement = describeElement(last.element);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        window.__smartstorePerf.longTasks += entries.length;
        window.__smartstorePerf.totalBlockingTime += entries.reduce(
          (total, entry) => total + Math.max(0, entry.duration - 50),
          0,
        );
      }).observe({ type: 'longtask', buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as EventTimingEntry[]) {
          if (!entry.interactionId) {
            continue;
          }

          if (entry.duration > window.__smartstorePerf.inp) {
            window.__smartstorePerf.inp = entry.duration;
            window.__smartstorePerf.inpEvent = `${entry.name}:${describeElement(
              entry.target,
            )}`;
          }
        }
      }).observe({
        type: 'event',
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit & { durationThreshold: number });
    } catch {}
  });
}

async function readVitals(page: Page): Promise<VitalsSnapshot> {
  return page.evaluate(() => {
    const [navigation] = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    const resources = performance.getEntriesByType(
      'resource',
    ) as PerformanceResourceTiming[];
    const memory = (performance as Performance & { memory?: PerformanceMemory })
      .memory;

    window.__smartstorePerf.domContentLoaded = navigation
      ? navigation.domContentLoadedEventEnd - navigation.startTime
      : 0;
    window.__smartstorePerf.loadEvent = navigation
      ? navigation.loadEventEnd - navigation.startTime
      : 0;
    window.__smartstorePerf.ttfb = navigation
      ? navigation.responseStart - navigation.requestStart
      : 0;
    window.__smartstorePerf.transferSize = resources.reduce(
      (total, entry) => total + entry.transferSize,
      navigation?.transferSize ?? 0,
    );
    window.__smartstorePerf.encodedBodySize = resources.reduce(
      (total, entry) => total + entry.encodedBodySize,
      navigation?.encodedBodySize ?? 0,
    );
    window.__smartstorePerf.resourceCount = resources.length;
    window.__smartstorePerf.imageCount = resources.filter((entry) =>
      entry.initiatorType === 'img',
    ).length;
    window.__smartstorePerf.scriptCount = resources.filter((entry) =>
      entry.initiatorType === 'script',
    ).length;
    window.__smartstorePerf.stylesheetCount = resources.filter((entry) =>
      entry.initiatorType === 'css' || entry.initiatorType === 'link',
    ).length;
    window.__smartstorePerf.domNodes =
      document.getElementsByTagName('*').length;

    return {
      ...window.__smartstorePerf,
      usedJSHeapSize: memory?.usedJSHeapSize ?? 0,
      totalJSHeapSize: memory?.totalJSHeapSize ?? 0,
      jsHeapSizeLimit: memory?.jsHeapSizeLimit ?? 0,
    };
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement;
    return Math.ceil(documentElement.scrollWidth - documentElement.clientWidth);
  });

  expect(overflow).toBeLessThanOrEqual(1);
}

async function auditCurrentPage(page: Page, path: string) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);

  await assertNoHorizontalOverflow(page);

  const vitals = await readVitals(page);
  console.log(JSON.stringify({ page: path, browserMetrics: vitals }));

  expect(vitals.ttfb || 0, `${path} TTFB`).toBeLessThanOrEqual(800);
  expect(vitals.fcp || 0, `${path} FCP`).toBeLessThanOrEqual(1_800);
  expect(vitals.cls, `${path} CLS (${vitals.lcpElement})`).toBeLessThanOrEqual(
    0.1,
  );
  expect(vitals.lcp || 0, `${path} LCP (${vitals.lcpElement})`).toBeLessThanOrEqual(
    2_500,
  );
  expect(vitals.inp || 0, `${path} INP (${vitals.inpEvent})`).toBeLessThanOrEqual(
    200,
  );
  expect(vitals.totalBlockingTime, `${path} TBT`).toBeLessThanOrEqual(300);
  expect(vitals.longTasks, `${path} long tasks`).toBeLessThanOrEqual(12);
  expect(vitals.domNodes, `${path} DOM nodes`).toBeLessThanOrEqual(1_500);
  expect(vitals.resourceCount, `${path} resource count`).toBeLessThanOrEqual(
    120,
  );
  expect(vitals.transferSize, `${path} transfer size`).toBeLessThanOrEqual(
    2_500_000,
  );

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
  await page.waitForTimeout(150);
  await assertNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
}

test.describe('mobile and tablet production performance stability audit', () => {
  test('key pages keep stable layout, responsive images, and clean network flow', async ({
    page,
    baseURL,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'desktop-chromium',
      'The audit sets exact mobile/tablet viewports internally.',
    );
    test.setTimeout(120_000);
    await addAdminSession(baseURL, page);
    await mockStableData(page);

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('requestfailed', (request) => {
      if (request.url().includes('/api/realtime/stream')) {
        return;
      }

      failedRequests.push(`${request.method()} ${request.url()}`);
    });
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.includes('/api/realtime/stream')) {
        failedRequests.push(`${status} ${url}`);
      }
    });

    await installVitalsObserver(page);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      for (const auditedPage of auditedPages) {
        const response = await page.goto(auditedPage.path, {
          waitUntil: 'domcontentloaded',
        });

        expect(
          response?.status(),
          `${auditedPage.name} ${viewport.name}`,
        ).toBeLessThan(400);

        await auditCurrentPage(
          page,
          `${auditedPage.name} ${viewport.width}x${viewport.height}`,
        );
      }
    }

    expect(failedRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});

declare global {
  interface Window {
    __smartstorePerf: VitalsSnapshot;
  }
}
