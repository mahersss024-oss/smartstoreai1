import { expect, test } from '@playwright/test';
import sharp from 'sharp';

for (const wrapper of [false, true]) {
  test.describe(wrapper ? 'wrapper marker' : 'browser', () => {
    if (wrapper) test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 SouqHamadCapacitor' });
    for (const dark of [false, true]) {
      test(`rapid scroll reversals preserve toolbar: ${dark ? 'dark' : 'light'}`, async ({ page, isMobile }, info) => {
        test.setTimeout(90_000);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(value => {
          sessionStorage.setItem('smartstore_welcome_seen', '1');
          localStorage.setItem('theme', value ? 'dark' : 'light');
        }, dark);
        await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
          listings: Array.from({ length: 80 }, (_, index) => ({
            id: `rapid-${index}`, sellerId: 'rapid-seller', category: 'other',
            title: `Rapid fixture ${index}`, price: 100, city: 'Riyadh', status: 'published',
            image: '/hamad-market-logo.webp', imageUrls: ['/hamad-market-logo.webp'],
            createdAt: '2026-10-13T08:00:00.000Z',
          })), pagination: { page: 1, limit: 80, hasMore: false, nextPage: null },
        } }));
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-app-ready', '1');
        await expect(page.getByText('Rapid fixture 79', { exact: true })).toBeAttached();
        await page.addStyleTag({ content: `
          *, *::before, *::after { animation: none !important; }
          .marketplace-listing-card, .marketplace-listing-card * {
            background: rgb(255,0,255) !important; color: rgb(255,0,255) !important;
            border-color: rgb(255,0,255) !important; box-shadow: none !important;
          }
          .marketplace-listing-card img { visibility: hidden !important; }
        ` });
        const panel = page.locator('[data-floating-tools]');
        const list = page.locator('#suggested-listings .marketplace-listings-scroll');
        const hidden = panel.locator('.marketplace-tools-collapsible');
        await list.evaluate(element => element.scrollTo({ top: 1500, behavior: 'instant' }));
        await page.waitForTimeout(1400);
        await expect(hidden).toHaveAttribute('inert', '');
        const baseline = await list.evaluate(element => ({
          top: element.getBoundingClientRect().top,
          cardOffset: element.querySelector('.marketplace-listing-card')!.getBoundingClientRect().top + element.scrollTop,
        }));
        const viewportTop = await panel.evaluate(element => element.parentElement!.getBoundingClientRect().top);
        const samples = await list.evaluate(async element => {
          const samples = [];
          // Alternate large scroll jumps every frame, including reversals within the 120ms cooldown.
          for (let frame = 0; frame < 180; frame++) {
            element.scrollTop = Math.floor(frame / 10) % 2 ? 1500 : 4500;
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            const panel = document.querySelector<HTMLElement>('[data-floating-tools]')!;
            const viewport = panel.parentElement!;
            const categories = panel.querySelector('[data-marketplace-categories]')!.getBoundingClientRect();
            samples.push({
              viewportTop: viewport.getBoundingClientRect().top,
              clip: getComputedStyle(viewport).clipPath,
              panelClip: getComputedStyle(panel).clipPath,
              categoriesTop: categories.top, categoriesBottom: categories.bottom,
              listTop: element.getBoundingClientRect().top,
              cardOffset: element.querySelector('.marketplace-listing-card')!.getBoundingClientRect().top + element.scrollTop,
              scroll: element.scrollTop,
              hidden: panel.querySelector('.marketplace-tools-collapsible')!.hasAttribute('inert'),
            });
          }
          return samples;
        });
        expect(samples.some(sample => sample.hidden)).toBe(true);
        expect(samples.some(sample => !sample.hidden)).toBe(true);
        for (const sample of samples) {
          expect(sample.viewportTop).toBeCloseTo(viewportTop, 1);
          expect(sample.clip).not.toBe('none');
          expect(sample.panelClip).toBe('none');
          expect(sample.categoriesTop).toBeGreaterThanOrEqual(viewportTop - 1);
          expect(sample.categoriesBottom).toBeLessThan(page.viewportSize()!.height);
          expect(sample.listTop).toBeCloseTo(baseline.top, 1);
          expect(sample.cardOffset).toBeCloseTo(baseline.cardOffset, 1);
        }
        const cdp = await page.context().newCDPSession(page);
        let pixelFrames = 0;
        for (let burst = 0; burst < 8; burst++) {
          const before = await list.evaluate(element => element.scrollTop);
          const rect = await list.boundingBox();
          expect(rect).not.toBeNull();
          const x = rect!.x + rect!.width * 0.65;
          const y = rect!.y + rect!.height * 0.78;
          if (isMobile) {
            const direction = burst % 2 ? 1 : -1;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            for (let step = 1; step <= 5; step++) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + direction * step * 25, id: 1 }] });
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await page.mouse.move(x, y);
            await page.mouse.wheel(0, burst % 2 ? -1800 : 1800);
          }
          await expect.poll(() => list.evaluate(element => element.scrollTop)).not.toBe(before);
          // The fixed top edge must occlude cards even while a transition is interrupted.
          const rects = await panel.evaluate(element => {
            const panel = element.getBoundingClientRect();
            const viewport = element.parentElement!.getBoundingClientRect();
            return { left: panel.left + 12, right: panel.right - 12, top: viewport.top + 2 };
          });
          const screenshot = await page.screenshot();
          await info.attach(`rapid-${burst}`, { body: screenshot, contentType: 'image/png' });
          const { data, info: pixels } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const scale = pixels.width / page.viewportSize()!.width;
          let exposed = 0;
          for (let y = Math.ceil(rects.top * scale); y < Math.floor((rects.top + 5) * scale); y++) {
            for (let x = Math.ceil(rects.left * scale); x < Math.floor(rects.right * scale); x++) {
              const offset = (y * pixels.width + x) * pixels.channels;
              if (data[offset] > 245 && data[offset + 1] < 10 && data[offset + 2] > 245) exposed++;
            }
          }
          expect(exposed, `card pixels at fixed toolbar edge, burst ${burst}`).toBe(0);
          pixelFrames++;
        }
        await cdp.detach();
        // Confirm the toolbar still settles correctly after the stress sequence and at the list start.
        await list.evaluate(element => element.scrollTo({ top: 5000, behavior: 'instant' }));
        await page.waitForTimeout(1400);
        await expect(hidden).toHaveAttribute('inert', '');
        await list.evaluate(element => element.scrollTo({ top: 1000, behavior: 'instant' }));
        await page.waitForTimeout(1400);
        await expect(hidden).not.toHaveAttribute('inert');
        await list.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(1500);
        await expect(hidden).not.toHaveAttribute('inert');
        await expect(panel.locator('input').first()).toBeVisible();
        expect(errors).toEqual([]);
        await info.attach('rapid-scroll-samples', { body: JSON.stringify(samples), contentType: 'application/json' });
        console.log(JSON.stringify({ rapidScroll: { project: info.project.name, wrapper, dark, samples: samples.length, pixelFrames } }));
      });
    }
  });
}
