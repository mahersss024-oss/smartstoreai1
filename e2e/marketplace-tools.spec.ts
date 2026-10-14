import { expect, test, type Locator, type Page } from '@playwright/test';

async function openMarketplace(page: Page, total = 24) {
  await page.route('**/api/marketplace/listings**', async (route) => {
    const currentPage = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
    const start = (currentPage - 1) * 24;
    await route.fulfill({
      json: {
        listings: Array.from({ length: Math.min(24, Math.max(0, total - start)) }, (_, offset) => {
          const index = start + offset;
          return {
          id: `toolbar-listing-${index}`,
          sellerId: 'toolbar-seller',
          category: 'الجوالات',
          title: `Product ${index}`,
          description: 'Marketplace toolbar interaction fixture.',
          price: 100,
          city: '\u0627\u0644\u0631\u064a\u0627\u0636',
          image: '/hamad-market-logo.webp',
          imageUrls: ['/hamad-market-logo.webp'],
          status: 'published',
          views: 0,
          messageCount: 0,
          favoriteCount: 0,
          createdAt: '2026-10-13T08:00:00.000Z',
          };
        }),
        pagination: {
          page: currentPage,
          limit: 24,
          hasMore: start + 24 < total,
          nextPage: start + 24 < total ? currentPage + 1 : null,
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByText('Product 23', { exact: true })).toBeAttached();
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
  await page.waitForTimeout(1800);
  return page.locator('#suggested-listings .marketplace-home-controls');
}

async function scrollTo(page: Page, top: number) {
  await page.locator('#suggested-listings .marketplace-listings-scroll').evaluate(
    (element, scrollTop) => {
      element.scrollTo({ top: scrollTop, behavior: 'instant' });
    },
    top,
  );
  await page.waitForTimeout(100);
}

async function expectHidden(panel: Locator, hidden: boolean) {
  if (hidden) {
    await expect(panel).toHaveAttribute('style', /calc\(-100%/);
  } else {
    await expect(panel).toHaveAttribute('style', /translate3d\(0(?:px)?, 0(?:px)?, 0(?:px)?\)/);
  }
}

async function expectCategoriesVisible(page: Page) {
  const categories = page.locator('[data-marketplace-categories]');
  await expect(categories.getByRole('button', { name: 'الكل', exact: true })).toBeInViewport();
  await expect.poll(async () => {
    const categoryBox = await categories.boundingBox();
    const sectionBox = await page.locator('#suggested-listings').boundingBox();
    return categoryBox && sectionBox ? categoryBox.y - sectionBox.y : -100;
  }).toBeGreaterThanOrEqual(-1);
}

test('tools ignore brief reversals and wait at the top without a stale reveal', async ({ page }) => {
  const panel = await openMarketplace(page);
  await scrollTo(page, 100);
  await scrollTo(page, 80);
  await scrollTo(page, 140);
  await expectHidden(panel, false);
  await scrollTo(page, 600);
  await expectHidden(panel, true);
  await page.waitForTimeout(1800);
  await expectCategoriesVisible(page);
  await scrollTo(page, 560);
  await scrollTo(page, 580);
  await scrollTo(page, 460);
  await expectHidden(panel, true);

  await scrollTo(page, 0);
  await page.waitForTimeout(1500);
  await expectHidden(panel, true);
  await scrollTo(page, 100);
  await page.waitForTimeout(3100);
  await expectHidden(panel, true);
  await scrollTo(page, 0);
  await page.waitForTimeout(2500);
  await expectHidden(panel, true);
  await page.waitForTimeout(700);
  await expectHidden(panel, false);
});

test('blank toolbar space supports mouse and touch drag while controls remain usable', async ({ page, isMobile }) => {
  const panel = await openMarketplace(page);
  const session = isMobile ? await page.context().newCDPSession(page) : null;

  async function dragTools(distance: number) {
    await page.waitForTimeout(1200);
    const point = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.bottom - 2; y >= Math.max(0, rect.top) + 2; y -= 2) {
        for (let x = rect.left + 4; x < rect.right - 4; x += 8) {
          const hit = document.elementFromPoint(x, y);
          if (hit && element.contains(hit) && !hit.closest(
            'button, a, input, textarea, select, label, [role="button"], [role="option"], [contenteditable]',
          )) return { x, y };
        }
      }
      throw new Error('No empty toolbar space is available for dragging');
    });
    if (session) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart', touchPoints: [{ ...point, id: 1 }],
      });
      for (let step = 1; step <= 10; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: point.x, y: point.y + distance * step / 10, id: 1 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x, point.y + distance, { steps: 10 });
      await page.mouse.up();
    }
  }

  await dragTools(-180);
  await expectHidden(panel, true);
  await dragTools(240);
  await expectHidden(panel, false);
  await page.waitForTimeout(1200);
  if (session) {
    const row = panel.locator('[data-marketplace-categories] > div').first();
    const rect = (await row.boundingBox())!;
    const startX = rect.x + rect.width * 0.25;
    const y = rect.y + rect.height / 2;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart', touchPoints: [{ x: startX, y, id: 1 }],
    });
    for (let step = 1; step <= 10; step++) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: startX + rect.width * 0.5 * step / 10, y, id: 1 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => row.evaluate(element => Math.abs(element.scrollLeft))).toBeGreaterThan(20);
    await expectHidden(panel, false);
  }
  const search = panel.locator('input').first();
  await search.fill('Product');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('Product');
  await expectHidden(panel, false);
  await panel.locator('button').filter({ hasText: /^\u0627\u0644\u0643\u0644$/ }).click();
  await expectHidden(panel, false);
  await session?.detach();
});

test('tools fit without horizontal scrolling and preserve search, region and clear filters', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const panel = await openMarketplace(page);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics = await panel.evaluate((element) => {
      const fields = element.querySelector('.marketplace-tools-fields')!;
      const rect = fields.getBoundingClientRect();
      const boxes = Array.from(fields.children).map(child => child.getBoundingClientRect());
      return {
        height: element.getBoundingClientRect().height,
        overflow: fields.scrollWidth - fields.clientWidth,
        controlsFit: boxes.every(box => box.left >= rect.left - 1 && box.right <= rect.right + 1),
        createButtonsFit: Array.from(element.querySelector('.marketplace-primary-cta')!.parentElement!.children).every(button => button.scrollWidth <= button.clientWidth + 1),
        searchBeforeCategories: fields.getBoundingClientRect().bottom <= element.querySelector('[data-marketplace-categories]')!.getBoundingClientRect().top,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.controlsFit).toBe(true);
    expect(metrics.createButtonsFit).toBe(true);
    expect(metrics.searchBeforeCategories).toBe(true);
    expect(metrics.height).toBeLessThanOrEqual(width < 375 ? 180 : 170);
    await expect(panel.locator('[data-marketplace-tools-handle]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`toolbar-${width}.png`) });
  }

  await panel.getByRole('button', { name: 'المنطقة', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'الرياض', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: /^تصفية البحث/ }).click();
  await panel.getByRole('button', { name: 'مسح الفلاتر', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'المنطقة', exact: true })).toBeVisible();
  await expect(panel.getByText('اختر تصنيفًا أو منطقة لتصفية الإعلانات المعروضة.')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'مسح الفلاتر', exact: true })).toHaveCount(0);

  const search = panel.getByRole('searchbox');
  const request = page.waitForRequest(req => new URL(req.url()).searchParams.get('q') === 'Product');
  await search.fill('Product');
  await request;
  await panel.getByRole('button', { name: 'مسح البحث', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(panel.getByRole('button', { name: 'موقعي', exact: true })).toBeEnabled();
});

test('floating categories do not interrupt loading the final partial listings page', async ({ page }) => {
  const panel = await openMarketplace(page, 30);
  const list = page.locator('#suggested-listings .marketplace-listings-scroll');
  await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  await expect(page.getByText('Product 29', { exact: true })).toBeAttached();
  await expect(page.getByText('Product 0', { exact: true })).toBeAttached();
  await expect(page.locator('#suggested-listings .marketplace-listing-card')).toHaveCount(30);
  await expectHidden(panel, true);
  await page.waitForTimeout(1200);
  await expectCategoriesVisible(page);
});
