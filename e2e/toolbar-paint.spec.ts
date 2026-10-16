import { expect, test } from '@playwright/test';
import sharp from 'sharp';

for (const androidWrapper of [false, true]) {
test.describe(androidWrapper ? 'android wrapper marker' : 'browser', () => {
  if (androidWrapper) test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 SouqHamadCapacitor' });
for (const dark of [false, true]) {
  test(`toolbar reveal keeps cards occluded throughout motion: ${dark ? 'dark' : 'light'}`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.addInitScript(value => {
      sessionStorage.setItem('smartstore_welcome_seen', '1');
      localStorage.setItem('theme', value ? 'dark' : 'light');
    }, dark);
    await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
      listings: Array.from({ length: 24 }, (_, index) => ({
        id: `paint-${index}`, sellerId: 'paint-seller', category: 'other',
        title: `Paint fixture ${index}`, price: 100, city: 'Riyadh', status: 'published',
        image: '/hamad-market-logo.webp', imageUrls: ['/hamad-market-logo.webp'],
        createdAt: '2026-10-13T08:00:00.000Z',
      })), pagination: { page: 1, limit: 24, hasMore: false, nextPage: null },
    } }));
    await page.goto('/');
    await expect(page.getByText('Paint fixture 23', { exact: true })).toBeAttached();
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
    // Isolate the toolbar transition from unrelated decorative animations.
    await page.addStyleTag({ content: `
      *, *::before, *::after { animation: none !important; }
      .marketplace-listing-card, .marketplace-listing-card * {
        background: rgb(255, 0, 255) !important; color: rgb(255, 0, 255) !important;
        border-color: rgb(255, 0, 255) !important; box-shadow: none !important;
      }
      .marketplace-listing-card img { visibility: hidden !important; }
    ` });
    const panel = page.locator('[data-floating-tools]');
    const list = page.locator('#suggested-listings .marketplace-listings-scroll');
    await list.evaluate(element => element.scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForTimeout(1300);
    await list.evaluate(element => element.scrollTo({ top: 616, behavior: 'instant' }));
    await page.waitForTimeout(200);
    const before = await list.evaluate(element => ({
      top: element.getBoundingClientRect().top, scroll: element.scrollTop,
      card: element.querySelector('.marketplace-listing-card')!.getBoundingClientRect().top,
    }));
    const cdp = await page.context().newCDPSession(page);
    const paints: Array<{ layerId: string; clip: unknown }> = [];
    cdp.on('LayerTree.layerPainted', event => paints.push(event));
    await cdp.send('LayerTree.enable');
    await page.waitForTimeout(200);
    paints.length = 0;
    await panel.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    const frames = [];
    for (let index = 0; index < 9; index++) {
      const geometry = await panel.evaluate(element => {
        const panel = element.getBoundingClientRect();
        const section = document.getElementById('suggested-listings')!.getBoundingClientRect();
        const categories = element.querySelector('[data-marketplace-categories]')!.getBoundingClientRect();
        const viewport = element.parentElement!;
        const edge = viewport.classList.contains('marketplace-tools-viewport')
          ? viewport.getBoundingClientRect().top
          : section.top + parseFloat(getComputedStyle(element).top);
        return {
          left: panel.left + 8, top: Math.max(edge + 1, panel.top + 1),
          right: panel.right - 8, bottom: panel.bottom - 8,
          categoriesTop: categories.top, sectionTop: section.top,
          clip: getComputedStyle(element).clipPath,
          viewportClip: getComputedStyle(viewport).clipPath,
          viewportTop: viewport.getBoundingClientRect().top,
          transitions: getComputedStyle(element).transitionProperty,
        };
      });
      const screenshot = await page.screenshot();
      await info.attach(`reveal-${index}`, { body: screenshot, contentType: 'image/png' });
      const { data, info: pixels } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const scale = pixels.width / page.viewportSize()!.width;
      let exposed = 0;
      for (let y = Math.ceil(geometry.top * scale); y < Math.min(pixels.height, Math.floor(geometry.bottom * scale)); y++) {
        for (let x = Math.ceil(geometry.left * scale); x < Math.floor(geometry.right * scale); x++) {
          const offset = (y * pixels.width + x) * pixels.channels;
          if (data[offset] > 245 && data[offset + 1] < 10 && data[offset + 2] > 245) exposed++;
        }
      }
      frames.push({ ...geometry, exposed });
      if (exposed) await info.attach('exposed-card-geometry', { body: JSON.stringify({ index, geometry, exposed }), contentType: 'application/json' });
      expect(exposed, `cards must remain behind the toolbar at frame ${index}`).toBe(0);
      expect(geometry.categoriesTop).toBeGreaterThanOrEqual(geometry.sectionTop - 1);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1100);
    await info.attach('paint-diagnostics', { body: JSON.stringify({ paintEvents: paints.length, frames }, null, 2), contentType: 'application/json' });
    console.log(JSON.stringify({ toolbarPaint: { project: info.project.name, dark, paintEvents: paints.length, frames: frames.length } }));
    await cdp.detach();
    expect(frames.every(frame => frame.clip === 'none')).toBe(true);
    expect(frames.every(frame => frame.viewportClip !== 'none')).toBe(true);
    expect(new Set(frames.map(frame => frame.viewportTop)).size).toBe(1);
    expect(new Set(frames.map(frame => frame.viewportClip)).size).toBe(1);
    const after = await list.evaluate(element => ({
      top: element.getBoundingClientRect().top, scroll: element.scrollTop,
      card: element.querySelector('.marketplace-listing-card')!.getBoundingClientRect().top,
    }));
    expect(after).toEqual(before);
  });
}
});
}
