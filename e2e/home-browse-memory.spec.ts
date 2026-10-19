import { expect, test, type Page } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

type RestoreMeasurement = { requested: number; actual: number; frames: number[] };
type RestoreTestWindow = Window & {
  measureBrowseRestore: boolean;
  browseRestoreMeasurements: RestoreMeasurement[];
  browseDepartureScrollTop: number | null;
};

async function measureRestoration(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as RestoreTestWindow;
    state.measureBrowseRestore = false;
    state.browseRestoreMeasurements = [];
    state.browseDepartureScrollTop = null;
    document.addEventListener('pointerdown', event => {
      const card = event.target instanceof Element ? event.target.closest('.marketplace-listing-card') : null;
      const list = card?.closest('.marketplace-listings-scroll');
      if (list) state.browseDepartureScrollTop = list.scrollTop;
    }, true);
    const record = (element: Element, requested: number) => {
      if (!state.measureBrowseRestore || !element.classList.contains('marketplace-listings-scroll')) return;
      const measurement = { requested, actual: element.scrollTop, frames: [] as number[] };
      state.browseRestoreMeasurements.push(measurement);
      const sample = () => {
        if (!element.isConnected) return;
        measurement.frames.push(element.scrollTop);
        if (measurement.frames.length < 6) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    };
    const property = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    Object.defineProperty(Element.prototype, 'scrollTop', { ...property, set(value: number) {
      property.set!.call(this, value);
      record(this, value);
    } });
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (options?: ScrollToOptions | number, y?: number) {
      Reflect.apply(scrollTo, this, typeof options === 'number' ? [options, y ?? 0] : [options]);
      record(this, typeof options === 'number' ? y ?? 0 : options?.top ?? this.scrollTop);
    };
  });
}

async function expectInstantRestoration(page: Page, scrollTop: number) {
  await expect.poll(() => page.evaluate(() => (window as unknown as RestoreTestWindow)
    .browseRestoreMeasurements.some(item => item.frames.length === 6))).toBe(true);
  const measurements = await page.evaluate(() => (window as unknown as RestoreTestWindow).browseRestoreMeasurements);
  const restored = measurements.find(item => Math.abs(item.requested - scrollTop) <= 1);
  expect(restored, 'the saved position must be applied synchronously').toBeDefined();
  expect(restored!.actual).toBeCloseTo(scrollTop, 0);
  for (const position of restored!.frames) expect(position).toBeCloseTo(scrollTop, 0);
}

async function prepare(page: Page, baseURL: string, listingId: string) {
  const cookie = createSessionCookie({ id: 'e2e-customer', email: 'e2e-customer@smartstore.local', name: 'عميل الاختبار' });
  await page.context().addCookies([{ name: 'smartstore_session',
    value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')), url: baseURL }]);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  const state = { requests: [] as URLSearchParams[], offline: false, revision: 0 };
  await page.route('**/api/realtime/stream**', route => route.fulfill({
    contentType: 'text/event-stream', body: 'event: heartbeat\ndata: {}\n\n',
  }));
  await page.route('**/api/marketplace/listings?**', route => {
    const params = new URL(route.request().url()).searchParams;
    state.requests.push(params);
    if (state.offline) return route.fulfill({ status: 503, json: { error: 'offline_fixture' } });
    const currentPage = Number(params.get('page') ?? 1);
    const start = (currentPage - 1) * 24;
    return route.fulfill({ json: {
      listings: Array.from({ length: 24 }, (_, offset) => {
        const index = start + offset;
        return { id: index === 30 ? listingId : `browse-${index}`, sellerId: 'e2e-report-seller',
          title: `${params.get('q') || 'سلعة'} ${index}${state.revision ? ' محدث' : ''}`,
          category: 'furniture', city: 'الرياض', price: 100, status: 'published', image: '/hamad-market-logo.webp' };
      }), pagination: { page: currentPage, hasMore: currentPage < 3 },
    } });
  });
  return state;
}

async function navigate(page: Page, href: string, label: string) {
  const link = page.locator(`a[href="${href}"]:visible`).first();
  if (await link.count()) await link.click();
  else await page.getByRole('button', { name: label, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${href === '/' ? '\\/' : href}$`));
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
}

function searchResponse(page: Page, query: string, pageNumber = '1', filtered = false) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/marketplace/listings' && url.searchParams.get('q') === query &&
      url.searchParams.get('page') === pageNumber && (!filtered ||
        url.searchParams.get('city') === 'الرياض' && url.searchParams.get('category') === 'furniture');
  });
}

for (const capture of ['native', 'unsupported'] as const) {
  test(`saved search returns directly to the previous card without a scroll animation when capture is ${capture}`, async ({ page, baseURL }, info) => {
    test.setTimeout(60_000);
    const id = `e2e-report-${info.project.name}`;
    await prepare(page, baseURL!, id);
    await measureRestoration(page);
    if (capture === 'unsupported') await page.addInitScript(() => {
      Object.defineProperty(document, 'startViewTransition', { configurable: true, value: undefined });
    });
    await page.goto('/');
    const search = page.getByPlaceholder('\u0627\u0628\u062d\u062b \u0641\u064a \u0643\u0644 \u0627\u0644\u0633\u0648\u0642', { exact: true });
    const searched = searchResponse(page, 'desk');
    await search.fill('desk');
    await searched;
    await search.press('Tab');
    const list = page.locator('#suggested-listings .marketplace-listings-scroll');
    await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
    const card = page.locator('.marketplace-listing-card').filter({ hasText: 'desk 30' });
    await card.scrollIntoViewIfNeeded();
    await card.click();
    const before = await page.evaluate(() => (window as unknown as RestoreTestWindow).browseDepartureScrollTop);
    expect(before).not.toBeNull();
    expect(before!).toBeGreaterThan(500);
    await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
    await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');
    await page.evaluate(() => { (window as unknown as RestoreTestWindow).measureBrowseRestore = true; });
    await page.goBack();
    await expect(search).toHaveValue('desk');
    await expectInstantRestoration(page, before!);
    await expect(list).toHaveCSS('scroll-behavior', 'smooth');

    await navigate(page, '/account', '\u062d\u0633\u0627\u0628\u064a');
    await page.evaluate(() => { (window as unknown as RestoreTestWindow).browseRestoreMeasurements = []; });
    await navigate(page, '/', '\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629');
    await expect(search).toHaveValue('desk');
    await expectInstantRestoration(page, before!);
    await page.screenshot({ path: info.outputPath(`instant-restoration-${capture}.png`) });
  });
}

test('home restores the real search, city, categories, loaded pages and scroll across listing and tab navigation', async ({ page, baseURL }, info) => {
  test.setTimeout(60_000);
  const id = `e2e-report-${info.project.name}`;
  const state = await prepare(page, baseURL!, id);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const search = page.getByPlaceholder('ابحث في كل السوق', { exact: true });
  const searched = searchResponse(page, 'مكتب');
  await search.fill('مكتب');
  await searched;
  await page.getByRole('button', { name: 'تصفية البحث', exact: true }).click();
  await page.locator('.marketplace-tools-region button').click();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  await page.getByRole('button', { name: 'البيت والأثاث', exact: true }).click();
  const filtered = searchResponse(page, 'مكتب', '1', true);
  await page.getByRole('button', { name: 'الأثاث', exact: true }).click();
  await filtered;
  const list = page.locator('#suggested-listings .marketplace-listings-scroll');
  await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  const card = page.locator('.marketplace-listing-card').filter({ hasText: 'مكتب 30' });
  await card.scrollIntoViewIfNeeded();
  const before = await list.evaluate(element => element.scrollTop);
  expect(before).toBeGreaterThan(500);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/listings/${id}$`));
  await expect(page.getByRole('heading', { name: 'تفاصيل الإعلان', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-page-transition');

  state.revision = 1;
  const previousRequests = state.requests.length;
  const revalidated = searchResponse(page, 'مكتب', '2', true);
  await page.goBack();
  await expect(search).toHaveValue('مكتب');
  await revalidated;
  await expect(card).toContainText('محدث');
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  await expect(page.locator('.marketplace-tools-region button')).toContainText('الرياض');
  await expect(page.getByRole('button', { name: 'الأثاث', exact: true })).toHaveClass(/bg-primary/);
  expect(state.requests.slice(previousRequests).every(params => params.get('q') === 'مكتب' &&
    params.get('city') === 'الرياض' && params.get('category') === 'furniture')).toBe(true);
  await page.screenshot({ path: info.outputPath('restored-browse.png') });

  await navigate(page, '/account', 'حسابي');
  await navigate(page, '/', 'الرئيسية');
  await expect(search).toHaveValue('مكتب');
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  await expect(card).toContainText('محدث');
  await expect(page.getByRole('button', { name: 'مسح الفلاتر', exact: true })).toBeAttached();

  await list.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: 'مسح الفلاتر', exact: true }).click();
  await navigate(page, '/account', 'حسابي');
  await navigate(page, '/', 'الرئيسية');
  await expect(search).toHaveValue('مكتب');
  await expect(page.locator('.marketplace-tools-region button')).toContainText('المنطقة');
  await expect(page.getByRole('button', { name: 'الكل', exact: true })).toHaveClass(/bg-primary/);
  await expect(page.getByRole('button', { name: 'الأثاث', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('typing immediately before leaving retains the latest input rather than the older debounced search', async ({ page, baseURL }, info) => {
  await prepare(page, baseURL!, `e2e-report-${info.project.name}`);
  await page.goto('/');
  const search = page.getByPlaceholder('ابحث في كل السوق', { exact: true });
  const searched = searchResponse(page, 'مكتب');
  await search.fill('مكتب');
  await searched;
  await search.fill('هاتف');
  await navigate(page, '/account', 'حسابي');
  const restored = searchResponse(page, 'هاتف');
  await navigate(page, '/', 'الرئيسية');
  await restored;
  await expect(search).toHaveValue('هاتف');
  await expect(page.locator('.marketplace-listing-card').first()).toContainText('هاتف');
  await page.getByRole('button', { name: 'مسح البحث', exact: true }).click();
  await navigate(page, '/account', 'حسابي');
  await navigate(page, '/', 'الرئيسية');
  await expect(search).toHaveValue('');
  await expect(page.getByRole('button', { name: 'مسح البحث', exact: true })).toHaveCount(0);
});

test('a failed background reload keeps the previous verified search and loaded cards', async ({ page, baseURL }, info) => {
  const state = await prepare(page, baseURL!, `e2e-report-${info.project.name}`);
  await page.goto('/');
  const search = page.getByPlaceholder('ابحث في كل السوق', { exact: true });
  const searched = searchResponse(page, 'مكتب');
  await search.fill('مكتب');
  await searched;
  await expect(page.locator('.marketplace-listing-card').first()).toContainText('مكتب');
  const count = await page.locator('.marketplace-listing-card').count();
  await navigate(page, '/account', 'حسابي');
  state.offline = true;
  const failed = searchResponse(page, 'مكتب');
  await navigate(page, '/', 'الرئيسية');
  expect((await failed).status()).toBe(503);
  await expect(search).toHaveValue('مكتب');
  await expect(page.locator('.marketplace-listing-card')).toHaveCount(count);
  await expect(page.locator('.marketplace-listing-card').first()).toContainText('مكتب');
});

test('home memory is tab-local and a document reload starts a fresh browsing runtime', async ({ page, baseURL }, info) => {
  await prepare(page, baseURL!, `e2e-report-${info.project.name}`);
  await page.goto('/');
  const searched = searchResponse(page, 'مكتب');
  await page.getByPlaceholder('ابحث في كل السوق', { exact: true }).fill('مكتب');
  await searched;
  const other = await page.context().newPage();
  await prepare(other, baseURL!, `e2e-report-${info.project.name}`);
  await other.goto('/');
  await expect(other.getByPlaceholder('ابحث في كل السوق', { exact: true })).toHaveValue('');
  await other.close();
  await navigate(page, '/account', 'حسابي');
  await navigate(page, '/', 'الرئيسية');
  await expect(page.getByPlaceholder('ابحث في كل السوق', { exact: true })).toHaveValue('مكتب');
  await page.reload();
  await expect(page.getByPlaceholder('ابحث في كل السوق', { exact: true })).toHaveValue('');
});
