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
        if (animation instanceof CSSAnimation && animation.animationName.startsWith('page-')) animation.play();
      }
    };
    if (typeof document.startViewTransition !== 'function') return;
    const native = document.startViewTransition.bind(document);
    document.startViewTransition = options => {
      const transition = native(options);
      void transition.ready.then(() => {
        const animations = document.getAnimations().filter((animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation && animation.animationName.startsWith('page-'));
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
  const desktop = await page.evaluate(() => matchMedia('(min-width: 64rem) and (pointer: fine)').matches);
  const motion = desktop ? 'page-fade' : 'page-slide';
  const duration = desktop ? 180 : 280;
  expect(latest.direction).toBe(direction);
  expect(latest.names).toContain(direction === 'forward' ? `${motion}-in-left` : `${motion}-in-right`);
  expect(latest.names).toContain(direction === 'forward' ? `${motion}-out-right` : `${motion}-out-left`);
  expect(latest.durations).toEqual([duration, duration]);
  expect(latest.oldX * (direction === 'forward' ? 1 : -1)).toBeGreaterThan(0);
  expect(latest.newX * (direction === 'forward' ? 1 : -1)).toBeLessThan(0);
}

test('listing pages use viewport-appropriate motion with a stationary bottom bar and unchanged history behavior', async ({ page, baseURL }, info) => {
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
  await frame(page, 2, 'back');
  await release(page);
  await page.evaluate(() => history.pushState({ retained: 'untouched' }, '', `${location.pathname}?view=saved`));
  await expect(page).toHaveURL(/\/favorites\?view=saved$/);
  expect(await page.evaluate(() => (window as unknown as TransitionTestWindow).routeFrames.length)).toBe(2);
  expect(await page.evaluate(() => history.state.retained)).toBe('untouched');
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
});

test('bottom tabs follow their actual horizontal positions for every pair and browser back/forward', async ({ page, baseURL }, info) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, `e2e-report-${info.project.name}`, baseURL!);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const navigation = page.locator('.marketplace-bottom-nav');
  await expect(navigation).toBeVisible();
  const initialBounds = await navigation.boundingBox();
  const tabs = [
    { label: '\u0625\u0639\u0644\u0627\u0646\u0627\u062a\u064a', path: '/account/listings' },
    { label: '\u0645\u062d\u0627\u062f\u062b\u0627\u062a\u064a', path: '/conversations' },
    { label: '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629', path: '/' },
    { label: '\u0627\u0644\u0645\u0641\u0636\u0644\u0629', path: '/favorites' },
    { label: '\u062d\u0633\u0627\u0628\u064a', path: '/account' },
  ];
  const button = (index: number) => navigation.getByRole('button', { name: tabs[index].label, exact: true });
  // Each directed pair occurs once, starting and ending at the centered home tab.
  const route = [2, 0, 1, 0, 2, 1, 2, 3, 0, 3, 1, 3, 2, 4, 0, 4, 1, 4, 3, 4, 2];
  const pairs = new Set<string>();
  for (let step = 1; step < route.length; step++) {
    const from = route[step - 1];
    const to = route[step];
    const previous = (await button(from).boundingBox())!;
    const target = (await button(to).boundingBox())!;
    const direction = target.x < previous.x ? 'forward' : 'back';
    pairs.add(`${from}:${to}`);
    await button(to).click();
    await expect(page).toHaveURL(url => url.pathname === tabs[to].path);
    await frame(page, step, direction);
    expect(await navigation.boundingBox()).toEqual(initialBounds);
    if (step === 1 || step === 7) await page.screenshot({ path: info.outputPath(`tab-${direction}.png`) });
    await release(page);
    await expect(button(to)).toHaveAttribute('aria-current', 'page');
  }
  expect(pairs.size).toBe(20);
  await page.goBack();
  await frame(page, 21, 'forward');
  await release(page);
  await expect(page).toHaveURL(url => url.pathname === '/account');
  await page.goForward();
  await frame(page, 22, 'back');
  await release(page);
  await expect(page).toHaveURL(url => url.pathname === '/');
  await button(2).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => (window as unknown as TransitionTestWindow).routeFrames.length)).toBe(22);
  expect(errors).toEqual([]);
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
