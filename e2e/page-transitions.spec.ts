import { expect, test, type Page } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

type AnimationFrame = { direction: string; names: string[]; durations: number[]; oldX: number; newX: number };
type TransitionTestWindow = Window & {
  routeFrames: AnimationFrame[];
  holdRouteAnimation: boolean;
  releaseRouteAnimation: () => void;
};

async function prepare(page: Page, listingId: string, baseURL: string) {
  const cookie = createSessionCookie({ id: 'e2e-customer', email: 'e2e-customer@smartstore.local', name: 'عميل الاختبار' });
  await page.context().addCookies([{ name: 'smartstore_session', value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')), url: baseURL }]);
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    const state = window as unknown as TransitionTestWindow;
    state.routeFrames = [];
    state.holdRouteAnimation = true;
    state.releaseRouteAnimation = () => {
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSAnimation && animation.animationName.startsWith('page-slide-')) animation.play();
      }
    };
    if (typeof document.startViewTransition !== 'function') return;
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = options => {
      const transition = native(options);
      void transition.ready.then(() => {
        const animations = document.getAnimations().filter((animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation && animation.animationName.startsWith('page-slide-'));
        if (state.holdRouteAnimation) {
          for (const animation of animations) { animation.pause(); animation.currentTime = 45; }
        }
        const x = (which: string) => new DOMMatrixReadOnly(
          getComputedStyle(document.documentElement, `::view-transition-${which}(page-content)`).transform,
        ).m41;
        state.routeFrames.push({ direction: document.documentElement.dataset.pageTransition ?? '',
          names: animations.map(animation => animation.animationName),
          durations: animations.map(animation => Number(animation.effect!.getTiming().duration)), oldX: x('old'), newX: x('new') });
      }).catch(() => {});
      return transition;
    };
  });
  await page.route('**/api/realtime/stream**', route => route.fulfill({ contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n' }));
  await page.route('**/api/marketplace/listings?**', route => route.fulfill({ json: {
    listings: Array.from({ length: 18 }, (_, index) => ({ id: index === 6 ? listingId : `navigation-filler-${index}`,
      title: index === 6 ? 'مكتب الاختبار' : `مكتب ${index}`, category: 'other', price: 100, city: 'الرياض',
      status: 'published', image: '/hamad-market-logo.webp', sellerId: 'e2e-report-seller' })),
    pagination: { page: 1, limit: 24, hasMore: false },
  } }));
}

async function release(page: Page) {
  await page.evaluate(() => (window as unknown as TransitionTestWindow).releaseRouteAnimation());
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
}

async function frame(page: Page, count: number, direction: string) {
  await expect.poll(() => page.evaluate(() => (window as unknown as TransitionTestWindow).routeFrames.length)).toBe(count);
  const latest = await page.evaluate(() => (window as unknown as TransitionTestWindow).routeFrames.at(-1)!);
  expect(latest.direction).toBe(direction);
  expect(latest.names).toContain(direction === 'forward' ? 'page-slide-in-left' : 'page-slide-in-right');
  expect(latest.names).toContain(direction === 'forward' ? 'page-slide-out-right' : 'page-slide-out-left');
  expect(latest.durations).toEqual([280, 280]);
  expect(latest.oldX * (direction === 'forward' ? 1 : -1)).toBeGreaterThan(0);
  expect(latest.newX * (direction === 'forward' ? 1 : -1)).toBeLessThan(0);
}

test('listing pages slide in both directions with a stationary bottom bar and unchanged history behavior', async ({ page, baseURL }, info) => {
  const id = `e2e-report-${info.project.name}`;
  await prepare(page, id, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const search = page.getByPlaceholder('ابحث في كل السوق', { exact: true });
  const searched = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'مكتب');
  await search.fill('مكتب');
  await search.press('Tab');
  await searched;
  const card = page.locator('.marketplace-listing-card').filter({ hasText: 'مكتب الاختبار' });
  await card.scrollIntoViewIfNeeded();
  const scroller = page.locator('#suggested-listings .marketplace-listings-scroll');
  const scrollBefore = await scroller.evaluate(element => element.scrollTop);
  await expect(search).toHaveValue('مكتب');
  const nav = page.locator('.marketplace-bottom-nav');
  const mobile = info.project.name.includes('mobile');
  if (mobile) await expect(nav).toBeVisible();
  const navBefore = mobile ? await nav.boundingBox() : null;
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
  await frame(page, 1, 'forward');
  if (mobile) {
    expect(await nav.boundingBox()).toEqual(navBefore);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement,
      '::view-transition-group(bottom-navigation)').animationName)).toBe('none');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('listing-slide-midpoint.png'), fullPage: true });
  await release(page);
  await expect(page.getByRole('heading', { name: 'تفاصيل الإعلان', exact: true })).toBeVisible();

  await page.goBack();
  await frame(page, 2, 'back');
  if (mobile) expect(await nav.boundingBox()).toEqual(navBefore);
  await page.screenshot({ path: info.outputPath('listing-back-midpoint.png'), fullPage: true });
  await release(page);
  await expect(search).toHaveValue('مكتب');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(scrollBefore, 0);

  await page.goForward();
  await frame(page, 3, 'forward');
  await release(page);
  await page.locator(`a[href="/"]`).first().click();
  await frame(page, 4, 'back');
  await release(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(search).toHaveValue('مكتب');
  expect(errors).toEqual([]);
});

test('tab buttons and ordinary links share the fixed transition, without animating query-only updates', async ({ page, baseURL }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page, `e2e-report-${info.project.name}`, baseURL!);
  await page.goto('/');
  if (info.project.name.includes('mobile')) await page.getByRole('button', { name: 'حسابي', exact: true }).click();
  else await page.locator('a[href="/account"]:visible').first().click();
  await frame(page, 1, 'forward');
  await release(page);
  await page.locator('a[href="/favorites"]:visible').first().click();
  await frame(page, 2, 'forward');
  await release(page);
  await page.evaluate(() => history.pushState({ retained: 'untouched' }, '', `${location.pathname}?view=saved`));
  await expect(page).toHaveURL(/\/favorites\?view=saved$/);
  expect(await page.evaluate(() => (window as unknown as TransitionTestWindow).routeFrames.length)).toBe(2);
  expect(await page.evaluate(() => history.state.retained)).toBe('untouched');
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
});

test('going back during an active slide releases the old capture and completes the latest navigation', async ({ page, baseURL }, info) => {
  await prepare(page, `e2e-report-${info.project.name}`, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('.marketplace-listing-card').filter({ hasText: 'مكتب الاختبار' }).click();
  await frame(page, 1, 'forward');
  await page.goBack();
  await frame(page, 2, 'back');
  await release(page);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByPlaceholder('ابحث في كل السوق', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('native Android page layout', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 SouqHamadCapacitor' });

  test('wrapped pages retain the native screen inset and horizontal clipping after navigation', async ({ page, baseURL }, info) => {
    await prepare(page, `e2e-report-${info.project.name}`, baseURL!);
    await page.goto('/account');
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
    await expect(page.locator('html')).toHaveAttribute('data-native-app', 'true');
    await page.evaluate(() => document.documentElement.style.setProperty('--native-status-bar-inset', '20px'));
    await page.locator('a[href="/commissions"]:visible').first().click();
    await frame(page, 1, 'forward');
    await release(page);
    await expect(page).toHaveURL(/\/commissions$/);
    const main = page.locator('.page-transition-content > main');
    await expect(main).toBeVisible();
    await expect(main).toHaveCSS('padding-top', '20px');
    await expect(main).toHaveCSS('overflow-x', 'hidden');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
});

for (const failure of ['unsupported', 'throws'] as const) {
  test(`navigation still works when browser page capture ${failure}`, async ({ page, baseURL }, info) => {
    const id = `e2e-report-${info.project.name}`;
    await prepare(page, id, baseURL!);
    await page.addInitScript(mode => {
      Object.defineProperty(document, 'startViewTransition', { configurable: true,
        value: mode === 'unsupported' ? undefined : () => { throw new Error('capture unavailable'); } });
    }, failure);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const searched = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'مكتب');
    await page.getByPlaceholder('ابحث في كل السوق', { exact: true }).fill('مكتب');
    await page.getByPlaceholder('ابحث في كل السوق', { exact: true }).press('Tab');
    await searched;
    const card = page.locator('.marketplace-listing-card').filter({ hasText: 'مكتب الاختبار' });
    await card.scrollIntoViewIfNeeded();
    const scroller = page.locator('#suggested-listings .marketplace-listings-scroll');
    const scrollBefore = await scroller.evaluate(element => element.scrollTop);
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
    await expect(page.getByRole('heading', { name: 'تفاصيل الإعلان', exact: true })).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
    await page.goBack();
    await expect(page.getByPlaceholder('ابحث في كل السوق', { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('ابحث في كل السوق', { exact: true })).toHaveValue('مكتب');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeCloseTo(scrollBefore, 0);
    expect(errors).toEqual([]);
  });
}
