import { expect, type Browser, type Page, test } from '@playwright/test';

import {
  commissionPolicyVersion,
  createCommissionAgreementCookie,
  createSessionCookie,
  listingPolicyVersion,
  platformAgreementVersion,
  privacyPolicyVersion,
  termsVersion,
} from '@/lib/auth/session';

type VitalsSnapshot = {
  cls: number;
  lcp: number;
  lcpElement: string;
};

type LayoutShiftEntry = PerformanceEntry & {
  hadRecentInput?: boolean;
  value?: number;
};

type LargestContentfulPaintEntry = PerformanceEntry & {
  element?: Element | null;
};

function sessionCookieHeader() {
  return createSessionCookie({
    id: 'e2e-new-registration',
    email: 'new-registration@smartstore.local',
    name: 'New Registration',
  });
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });

  expect(overflow).toBeLessThanOrEqual(1);
}

async function installVitalsObserver(page: Page) {
  await page.addInitScript(() => {
    window.__smartstoreLoginVitals = {
      cls: 0,
      lcp: 0,
      lcpElement: '',
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
            window.__smartstoreLoginVitals.cls += entry.value ?? 0;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1] as LargestContentfulPaintEntry;

        if (last) {
          window.__smartstoreLoginVitals.lcp = last.startTime;
          window.__smartstoreLoginVitals.lcpElement = describeElement(last.element);
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {}
  });
}

async function assertLoginVitals(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const vitals = await page.evaluate(() => window.__smartstoreLoginVitals);

  expect(vitals.cls, `${label} CLS (${vitals.lcpElement})`).toBeLessThanOrEqual(
    0.1,
  );
  expect(vitals.lcp || 0, `${label} LCP (${vitals.lcpElement})`).toBeLessThanOrEqual(
    2_500,
  );

  return vitals;
}

async function installRegistrationRoutes(page: Page) {
  await page.route('**/api/auth/google/start', async (route) => {
    const hasAgreement = route
      .request()
      .headers()
      .cookie?.includes('smartstore_commission_agreement=');

    await route.fulfill({
      status: hasAgreement ? 302 : 307,
      headers: {
        location: hasAgreement ? '/' : '/commission-agreement?provider=google',
        ...(hasAgreement ? { 'set-cookie': sessionCookieHeader() } : {}),
      },
    });
  });
  await page.route('**/api/auth/commission-agreement', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'set-cookie': createCommissionAgreementCookie(),
      },
      body: JSON.stringify({
        accepted: true,
        commissionRatePercent: 1,
        platformAgreementVersion,
        termsVersion,
        privacyPolicyVersion,
        listingPolicyVersion,
        commissionPolicyVersion,
      }),
    });
  });
}

async function runRegistrationAgreementFlow(page: Page) {
  await installVitalsObserver(page);
  await installRegistrationRoutes(page);

  await page.goto('/');
  const initialHomeVitals = await assertLoginVitals(page, 'initial home before login');
  await page.getByTestId('auth-provider-trigger').click();
  await page.locator('a[href="/api/auth/google/start"]').first().click();

  await expect(page).toHaveURL(/\/commission-agreement\?provider=google$/);
  await expect(page.locator('.marketplace-bottom-nav')).toHaveCount(0);
  await assertNoHorizontalOverflow(page);
  const agreementVitals = await assertLoginVitals(page, 'registration agreement');

  await page.locator('#platform-agreement-accepted').check();
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('body')).not.toContainText(
    /Application error|Internal Server Error|Unhandled Runtime Error/i,
  );
  await expect(page.locator('.marketplace-bottom-nav')).toBeVisible();
  await assertNoHorizontalOverflow(page);
  const finalHomeVitals = await assertLoginVitals(page, 'home after agreement');

  console.log(
    JSON.stringify({
      initialHomeVitals,
      agreementVitals,
      finalHomeVitals,
    }),
  );
}

test('new visitor accepts the registration agreement and returns to the home page on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await runRegistrationAgreementFlow(page);
});

test('native android wrapper keeps the registration agreement flow within web-vitals limits', async ({
  browser,
  baseURL,
}: {
  browser: Browser;
  baseURL: string | undefined;
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 SouqHamadCapacitor',
  });
  const page = await context.newPage();

  try {
    await runRegistrationAgreementFlow(page);
    await expect(page.locator('.open-in-app-banner')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

declare global {
  interface Window {
    __smartstoreLoginVitals: VitalsSnapshot;
  }
}
