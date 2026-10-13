import { expect, type Page, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

type VitalsSnapshot = {
  cls: number;
  lcp: number;
  lcpElement: string;
  longTasks: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
};

type LargestContentfulPaintEntry = PerformanceEntry & {
  element?: Element | null;
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
      lcp: 0,
      lcpElement: '',
      longTasks: 0,
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
        window.__smartstorePerf.longTasks += list.getEntries().length;
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
}

async function readVitals(page: Page): Promise<VitalsSnapshot> {
  return page.evaluate(() => window.__smartstorePerf);
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

  await assertNoHorizontalOverflow(page);

  const vitals = await readVitals(page);
  expect(vitals.cls, `${path} CLS (${vitals.lcpElement})`).toBeLessThanOrEqual(
    0.1,
  );
  expect(vitals.lcp || 0, `${path} LCP (${vitals.lcpElement})`).toBeLessThanOrEqual(
    2_500,
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
