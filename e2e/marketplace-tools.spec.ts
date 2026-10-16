import { expect, test, type Locator, type Page } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

function measureCreateAction(element: Element) {
  const box = element.getBoundingClientRect();
  const range = document.createRange();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textRects: DOMRect[] = [];
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    textRects.push(...range.getClientRects());
  }
  const icon = element.querySelector('svg')!.getBoundingClientRect();
  const fits = (rect: DOMRect) =>
    rect.left >= box.left - 1 && rect.right <= box.right + 1 &&
    rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1;

  // Measure visible content, not the clipped decorative ::after on the CTA.
  return {
    text: element.textContent?.trim(),
    width: box.width,
    height: box.height,
    font: getComputedStyle(element).font,
    textFits: textRects.length > 0 && textRects.every(fits),
    iconFits: fits(icon),
    textRects: textRects.map(rect => rect.toJSON()),
  };
}

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

test('tools respond to small scrolls, ignore jitter and reveal promptly at the top', async ({ page }) => {
  const panel = await openMarketplace(page);
  await scrollTo(page, 6);
  await expectHidden(panel, false);
  await scrollTo(page, 16);
  await expectHidden(panel, true);
  await page.waitForTimeout(1150);
  await expectCategoriesVisible(page);
  await scrollTo(page, 15);
  await scrollTo(page, 16);
  await expectHidden(panel, true);
  await scrollTo(page, 8);
  await expectHidden(panel, false);
  await page.waitForTimeout(150);
  await scrollTo(page, 24);
  await expectHidden(panel, true);
  // Leaving the top cancels its delayed reveal instead of reopening stale tools.
  await page.locator('#suggested-listings .marketplace-listings-scroll').evaluate(element => {
    for (const top of [0, 40]) {
      element.scrollTo({ top, behavior: 'instant' });
      element.dispatchEvent(new Event('scroll'));
    }
  });
  await page.waitForTimeout(180);
  await expectHidden(panel, true);
  await scrollTo(page, 0);
  await expectHidden(panel, false);
});

test('hidden controls leave no painted or clickable strip and do not displace browsed cards', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const panel = await openMarketplace(page);
  const list = page.locator('#suggested-listings .marketplace-listings-scroll');
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    for (const dark of [false, true]) {
      await page.evaluate(value => document.documentElement.classList.toggle('dark', value), dark);
      await scrollTo(page, 600);
      await page.waitForTimeout(1150);
      await list.evaluate(async element => {
        const content = element.querySelector('.marketplace-listings-content')!;
        content.getBoundingClientRect();
        await Promise.all(content.getAnimations().map(animation => animation.finished));
      });
      // Record the settled list height before testing a direction reversal.
      await scrollTo(page, 616);
      await page.waitForTimeout(150);
      const before = await list.evaluate(element => ({
        top: element.getBoundingClientRect().top,
        scroll: element.scrollTop,
        card: element.querySelector('.marketplace-listing-card-enter')!.getBoundingClientRect().top,
      }));
      await scrollTo(page, 608);
      await expectHidden(panel, false);
      await page.waitForTimeout(1150);
      const shown = await list.evaluate(element => ({
        top: element.getBoundingClientRect().top,
        scroll: element.scrollTop,
        card: element.querySelector('.marketplace-listing-card-enter')!.getBoundingClientRect().top,
      }));
      expect(shown.top).toBe(before.top);
      expect(shown.scroll).toBe(608);
      expect(shown.card).toBeCloseTo(before.card + before.scroll - 608, 5);
      await scrollTo(page, 620);
      await expectHidden(panel, true);
      await page.waitForTimeout(1150);
      await expectCategoriesVisible(page);
      const after = await list.evaluate(element => ({
        top: element.getBoundingClientRect().top,
        scroll: element.scrollTop,
        card: element.querySelector('.marketplace-listing-card-enter')!.getBoundingClientRect().top,
      }));
      expect(after.top).toBe(before.top);
      expect(after.scroll).toBe(620);
      expect(after.card).toBeCloseTo(before.card + before.scroll - 620, 5);
      const geometry = await panel.evaluate(element => {
        const categories = element.querySelector('[data-marketplace-categories]')!.getBoundingClientRect();
        const y = categories.top - 2;
        const hits = [0.1, 0.5, 0.9].map(ratio => document.elementFromPoint(
          categories.left + categories.width * ratio, y,
        ));
        return {
          stripHitsTools: hits.some(hit => hit && element.contains(hit)),
          transition: getComputedStyle(element).transitionDuration,
          clip: getComputedStyle(element.parentElement!).clipPath,
          movingClip: getComputedStyle(element).clipPath,
        };
      });
      expect(geometry.stripHitsTools).toBe(false);
      expect(geometry.clip).not.toBe('none');
      expect(geometry.movingClip).toBe('none');
      expect(geometry.transition).toBe('1.05s');
      const guardedTransition = await panel.evaluate(element => {
        document.documentElement.setAttribute('data-theme-switching', '');
        const properties = getComputedStyle(element).transitionProperty;
        document.documentElement.removeAttribute('data-theme-switching');
        return properties;
      });
      expect(guardedTransition).toContain('transform');
      await page.screenshot({ path: testInfo.outputPath(`hidden-tools-${viewport.width}-${dark ? 'dark' : 'light'}.png`) });
    }
  }
});

test('first card clears categories without moving the floating scroll viewport', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const panel = await openMarketplace(page, 54);
  const list = page.locator('#suggested-listings .marketplace-listings-scroll');
  const firstCard = list.locator('.marketplace-listing-card-enter').first();
  const categories = panel.locator('[data-marketplace-categories]');
  await page.evaluate(() => {
    const target = window as typeof window & { __firstCardShifts: number };
    target.__firstCardShifts = 0;
    new PerformanceObserver(entries => {
      for (const entry of entries.getEntries()) {
        target.__firstCardShifts += (entry as PerformanceEntry & { value: number }).value;
      }
    }).observe({ type: 'layout-shift' });
  });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 768, height: 1024 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    const listTop = (await list.boundingBox())!.y;
    for (const key of ['ArrowDown', 'ArrowUp']) {
      await panel.focus();
      await page.waitForTimeout(250);
      const before = await page.evaluate(() =>
        (window as typeof window & { __firstCardShifts: number }).__firstCardShifts);
      await page.keyboard.press(key);
      await expectHidden(panel, key === 'ArrowUp');
      await page.waitForTimeout(1150);
      const card = (await firstCard.boundingBox())!;
      const category = (await categories.boundingBox())!;
      expect(Math.abs(card.y - category.y - category.height - 12)).toBeLessThan(2);
      expect(await list.evaluate(element => element.scrollTop)).toBe(0);
      expect((await list.boundingBox())!.y).toBe(listTop);
      await expect(firstCard).toBeInViewport({ ratio: 1 });
      const after = await page.evaluate(() =>
        (window as typeof window & { __firstCardShifts: number }).__firstCardShifts);
      expect(after - before, `toolbar layout shifts at ${viewport.width}px`).toBeLessThanOrEqual(0.001);
      await page.screenshot({ path: testInfo.outputPath(`first-card-${viewport.width}-${key}.png`) });
    }
  }
  await scrollTo(page, 600);
  const scrollBefore = await list.evaluate(element => element.scrollTop);
  const cardBefore = (await firstCard.boundingBox())!.y;
  const viewportBefore = (await list.boundingBox())!;
  const categoryBefore = (await categories.boundingBox())!;
  expect(viewportBefore.y).toBeLessThan(categoryBefore.y + categoryBefore.height);
  expect(cardBefore).toBeLessThan(viewportBefore.y);
  await panel.focus();
  await page.keyboard.press('ArrowDown');
  await expectHidden(panel, false);
  await page.waitForTimeout(1150);
  expect(await list.evaluate(element => element.scrollTop)).toBe(scrollBefore);
  expect((await firstCard.boundingBox())!.y).toBe(cardBefore);
  expect((await list.boundingBox())!.y).toBe(viewportBefore.y);
});

test('blank toolbar space supports mouse and touch drag while controls remain usable', async ({ page, isMobile }) => {
  const panel = await openMarketplace(page);
  const session = isMobile ? await page.context().newCDPSession(page) : null;

  async function dragTools(distance: number) {
    await page.waitForTimeout(1200);
    const point = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.bottom - 2; y >= Math.max(0, rect.top) + 2; y -= 2) {
        // Chromium can retarget touch contacts near the rounded outer border.
        for (let x = rect.left + 16; x < rect.right - 16; x += 8) {
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

test('button drags do not activate commands and excluded fields keep their interactions', async ({ page, isMobile }) => {
  const panel = await openMarketplace(page);
  const session = isMobile ? await page.context().newCDPSession(page) : null;
  async function gesture(control: Locator, distance: number) {
    const box = (await control.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (session) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
      for (let step = 1; step <= 12; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + distance * step / 12, id: 1 }],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x, point.y + distance, { steps: 12 });
      await page.mouse.up();
    }
  }
  const filter = panel.getByRole('button', { name: /^تصفية البحث/ });
  const closedFilterClass = (await filter.getAttribute('class'))!;
  await gesture(filter, -160);
  await expectHidden(panel, true);
  await page.waitForTimeout(1200);
  await gesture(panel.getByRole('button', { name: 'الكل', exact: true }), 200);
  await expectHidden(panel, false);
  await page.waitForTimeout(1200);
  await expect(filter).toHaveAttribute('class', closedFilterClass);
  await gesture(filter, 1);
  // A small movement is still a normal tap, not a toolbar gesture.
  await expect(filter).not.toHaveAttribute('class', closedFilterClass);
  await filter.click();
  await expect(filter).toHaveAttribute('class', closedFilterClass);
  await gesture(panel.getByRole('button', { name: 'المنطقة', exact: true }), -80);
  await expectHidden(panel, false);
  await panel.getByRole('button', { name: 'المنطقة', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  const search = panel.getByRole('searchbox');
  await search.fill('Product');
  await gesture(search, -80);
  await expectHidden(panel, false);
  await expect(search).toHaveValue('Product');
  await session?.detach();
});

test('tools fit without horizontal scrolling and preserve search, region and clear filters', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const panel = await openMarketplace(page);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const metrics = await panel.evaluate((element) => {
      const fields = element.querySelector('.marketplace-tools-fields')!;
      const rect = fields.getBoundingClientRect();
      const boxes = Array.from(fields.children).map(child => child.getBoundingClientRect());
      return {
        height: element.getBoundingClientRect().height,
        overflow: fields.scrollWidth - fields.clientWidth,
        controlsFit: boxes.every(box => box.left >= rect.left - 1 && box.right <= rect.right + 1),
        searchBeforeCategories: fields.getBoundingClientRect().bottom <= element.querySelector('[data-marketplace-categories]')!.getBoundingClientRect().top,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.controlsFit).toBe(true);
    const actions = panel.locator('.marketplace-primary-cta').locator('..').getByRole('button');
    for (const button of await actions.all()) {
      const content = await button.evaluate(measureCreateAction);
      const context = `${width}px ${JSON.stringify(content)}`;
      expect(content.textFits, context).toBe(true);
      expect(content.iconFits, context).toBe(true);
    }
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

test('create actions keep their labels and icons inside narrow buttons with larger text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const panel = await openMarketplace(page);
  await panel.locator('.marketplace-primary-cta').evaluate(element => {
    for (const button of element.parentElement!.children) {
      (button.querySelector('span') as HTMLElement).style.fontSize = '18px';
    }
  });
  const actions = panel.locator('.marketplace-primary-cta').locator('..').getByRole('button');
  for (const button of await actions.all()) {
    const metrics = await button.evaluate(measureCreateAction);
    expect(metrics.textFits, JSON.stringify(metrics)).toBe(true);
    expect(metrics.iconFits, JSON.stringify(metrics)).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('larger-create-labels.png') });
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

test('chat search preserves the market scroll, filters and pagination while keeping highlighted results', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const cookie = createSessionCookie({ id: 'chat-isolation-buyer', email: 'chat-isolation@smartstore.local' });
  await page.context().addCookies([{
    name: 'smartstore_session', value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')),
    url: baseURL!, httpOnly: true, sameSite: 'Lax',
  }]);
  const events = [
    { type: 'start', messageId: 'isolation-assistant' },
    { type: 'tool-input-available', toolCallId: 'isolation-search', toolName: 'searchMarketplaceListings', input: { query: 'phone' } },
    { type: 'tool-output-available', toolCallId: 'isolation-search', output: { status: 'searched', listings: [{
      id: 'assistant-only-result', sellerId: 'assistant-seller', category: 'الجوالات', title: 'Assistant match',
      description: 'Assistant fixture', price: 100, city: 'الرياض', image: '/hamad-market-logo.webp',
      imageUrls: ['/hamad-market-logo.webp'], status: 'published', views: 0, messageCount: 0,
      favoriteCount: 0, createdAt: '2026-10-13T08:00:00.000Z',
    }] } },
    { type: 'text-start', id: 'isolation-text' },
    { type: 'text-delta', id: 'isolation-text', delta: 'Assistant result ready' },
    { type: 'text-end', id: 'isolation-text' },
    { type: 'finish' },
  ];
  await page.route('**/api/chat', route => route.fulfill({
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
    body: events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
  }));
  const panel = await openMarketplace(page, 54);
  await panel.getByRole('button', { name: 'المنطقة', exact: true }).click();
  const cityResponse = page.waitForResponse(response =>
    response.url().includes('/api/marketplace/listings?') && new URL(response.url()).searchParams.get('city') === 'الرياض');
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  await cityResponse;
  await scrollTo(page, 600);
  const list = page.locator('#suggested-listings .marketplace-listings-scroll');
  const before = await list.evaluate(element => {
    element.setAttribute('data-retained-list', 'same-node');
    return element.scrollTop;
  });
  let requestsWhileChat = 0;
  const countMarketRequests = (request: { url(): string }) => {
    if (request.url().includes('/api/marketplace/listings?')) requestsWhileChat++;
  };
  await page.getByRole('button', { name: /فتح حمد/ }).click();
  await expect(page.locator('#suggested-listings')).toBeHidden();
  page.on('request', countMarketRequests);
  await page.getByPlaceholder(/اكتب طلبك/).fill('ابحث عن جوال');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('Assistant result ready', { exact: true })).toBeVisible();
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(1);
  const chat = page.getByTestId('assistant-panel');
  const rect = (await chat.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, 1800);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(500);
  expect(requestsWhileChat).toBe(0);
  page.off('request', countMarketRequests);
  await page.getByRole('button', { name: 'العودة للإعلانات', exact: true }).click();
  await expect(list).toHaveAttribute('data-retained-list', 'same-node');
  expect(await list.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
  await expect(panel.locator('.marketplace-tools-region button')).toContainText('الرياض');
  await expect(page.locator('.marketplace-listing-card:not(.smart-assistant-result-card)')).toHaveCount(24);
  await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  await expect(page.getByText('Product 47', { exact: true })).toBeAttached();
  await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }));
  await expect(page.getByText('Product 53', { exact: true })).toBeAttached();
  await expect(page.locator('.marketplace-listing-card:not(.smart-assistant-result-card)')).toHaveCount(54);
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(1);
  await page.setViewportSize({ width: 1280, height: 844 });
  await scrollTo(page, 600);
  const desktopScroll = await list.evaluate(element => element.scrollTop);
  const desktopChat = (await chat.boundingBox())!;
  await page.mouse.move(desktopChat.x + desktopChat.width / 2, desktopChat.y + desktopChat.height / 2);
  await page.mouse.wheel(0, 1800);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(300);
  expect(await list.evaluate(element => element.scrollTop)).toBeCloseTo(desktopScroll, 0);
});
