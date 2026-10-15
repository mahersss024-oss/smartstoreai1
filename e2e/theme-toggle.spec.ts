import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';

test('theme colors and icon settle at the first frame without interrupting motion', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    localStorage.setItem('theme', 'light');
  });
  await page.route('**/api/marketplace/listings?**', route => route.fulfill({ json: {
    listings: Array.from({ length: 24 }, (_, index) => ({
      id: `theme-frame-${index}`, title: `Desk ${index}`, category: 'furniture', city: 'Riyadh',
      price: 100, status: 'published', createdAt: '2026-10-15T00:00:00Z',
      images: [{ status: 'approved', thumbnailUrl: '/hamad-market-logo.webp' }],
    })), pagination: { page: 1, hasMore: false },
  } }));
  await page.goto('/');
  await expect(page.locator('.marketplace-listing-card')).toHaveCount(24);
  const toggle = page.locator('.marketplace-panel button').filter({ has: page.locator('.lucide-sun, .lucide-moon') }).first();
  const results = [];
  for (const dark of [true, false]) {
    await page.evaluate(() => {
      const toggle = [...document.querySelectorAll('button')].find(button => button.querySelector('.lucide-sun, .lucide-moon'))!;
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;pointer-events:none;transform:translateX(0px);transition:transform 300ms linear,width 300ms linear';
      document.body.appendChild(probe);
      void getComputedStyle(probe).transform;
      const targets = [
        document.body, document.querySelector('.marketplace-listing-card')!,
        document.querySelector('.marketplace-home-controls')!,
        ...document.querySelectorAll('.marketplace-home-controls button'),
      ];
      let started = 0;
      toggle.addEventListener('pointerdown', () => { started = performance.now(); }, { once: true, capture: true });
      const frames: { ms: number; colors: string[]; colorTransitions: number; motionRunning: boolean; sizeRunning: boolean; icon: string }[] = [];
      const promise = new Promise<typeof frames>(resolve => {
        toggle.addEventListener('click', () => {
          if (!started) started = performance.now();
          probe.style.transform = 'translateX(60px)';
          probe.style.width = '60px';
          const record = () => {
            const transitions = document.getAnimations().filter(animation => animation instanceof CSSTransition) as CSSTransition[];
            frames.push({
              ms: performance.now() - started,
              colors: targets.map(element => {
                const style = getComputedStyle(element);
                return `${style.backgroundColor}|${style.borderTopColor}|${style.color}`;
              }),
              colorTransitions: transitions.filter(animation => {
                const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
                // The tapped button may leave its normal hover state after the commit.
                return !(target instanceof Element && toggle.contains(target)) &&
                  /color|fill|stroke|shadow|gradient/.test(animation.transitionProperty);
              }).length,
              motionRunning: transitions.some(animation => animation.effect instanceof KeyframeEffect && animation.effect.target === probe && animation.transitionProperty === 'transform'),
              sizeRunning: transitions.some(animation => animation.effect instanceof KeyframeEffect && animation.effect.target === probe && animation.transitionProperty === 'width'),
              icon: toggle.querySelector('.lucide-sun, .lucide-moon')?.classList.contains('lucide-moon') ? 'dark' : 'light',
            });
            if (performance.now() - started < 350) requestAnimationFrame(record);
            else { probe.remove(); resolve(frames); }
          };
          requestAnimationFrame(record);
        }, { once: true, capture: true });
      });
      Object.assign(window, { themeFrameResult: promise });
    });
    if (testInfo.project.use.isMobile) await toggle.tap();
    else await toggle.click();
    const frames = await page.evaluate(() => (window as unknown as {
      themeFrameResult: Promise<{ ms: number; colors: string[]; colorTransitions: number; motionRunning: boolean; sizeRunning: boolean; icon: string }[]>;
    }).themeFrameResult);
    results.push({ dark, firstFrameMs: frames[0].ms, frames });
    expect(frames[0].ms).toBeLessThanOrEqual(200);
    expect(frames[0].icon).toBe(dark ? 'dark' : 'light');
    expect(frames.some(frame => frame.motionRunning)).toBe(true);
    expect(frames.some(frame => frame.sizeRunning)).toBe(true);
    for (const frame of frames) {
      expect(frame.colorTransitions, `color transitions at ${frame.ms}ms`).toBe(0);
      expect(frame.colors, `intermediate colors at ${frame.ms}ms`).toEqual(frames.at(-1)!.colors);
    }
    await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching');
    await page.screenshot({ path: testInfo.outputPath(dark ? 'atomic-dark.png' : 'atomic-light.png') });
  }
  console.log(JSON.stringify({ project: testInfo.project.name, themeFirstFrames: results.map(({ dark, firstFrameMs }) => ({ dark, firstFrameMs })) }));
  await testInfo.attach('theme-frame-metrics', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('theme toggles immediately even while preference persistence is deferred', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
    const callbacks = new Map<number, IdleRequestCallback>();
    let id = 0;
    window.requestIdleCallback = callback => { callbacks.set(++id, callback); return id; };
    window.cancelIdleCallback = callbackId => { callbacks.delete(callbackId); };
    Object.assign(window, {
      flushThemePersistence: () => {
        const pending = [...callbacks.values()].reverse();
        callbacks.clear();
        for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 50 });
      },
    });
  });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^الوضع (الداكن|الفاتح)$/ });
  await expect(toggle).toHaveAttribute('aria-label', 'الوضع الداكن');
  for (const dark of [true, false, true, false, true]) {
    await toggle.click();
    await expect(page.locator('html')).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
    await expect(toggle).toHaveAttribute('aria-label', dark ? 'الوضع الفاتح' : 'الوضع الداكن', { timeout: 1_000 });
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  }
  await toggle.evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-switching');
  await toggle.press('Enter');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await toggle.press('Space');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.evaluate(() => (window as unknown as { flushThemePersistence: () => void }).flushThemePersistence());
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  expect((await page.context().cookies()).find(cookie => cookie.name === 'theme')?.value).toBe('dark');
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'الوضع الفاتح');
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'light' }));
  });
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'الوضع الداكن');
});

test('theme remains usable when the browser refuses preference writes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    localStorage.setItem('theme', 'light');
  });
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^الوضع (الداكن|الفاتح)$/ });
  await expect(toggle).toBeVisible();
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Preference writes blocked', 'SecurityError'); };
  });
  await toggle.click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'الوضع الفاتح');
  await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === 'theme')?.value).toBe('dark');
  await toggle.click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'الوضع الداكن');
  await expect.poll(async () => (await page.context().cookies()).find(cookie => cookie.name === 'theme')?.value).toBe('light');
  expect(errors).toEqual([]);
});

test('account appearance switch and home icon share the applied theme across navigation', async ({ page, baseURL }, testInfo) => {
  const cookie = createSessionCookie({ id: 'theme-customer', email: 'theme-customer@example.test', name: 'Theme customer' });
  await page.context().addCookies([{
    name: 'smartstore_session', value: decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('=')),
    url: baseURL!, httpOnly: true, sameSite: 'Lax',
  }]);
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  await page.goto('/account');
  const toggle = page.getByRole('button', { name: /^الوضع (الداكن|الفاتح)$/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  const homeToggle = page.getByRole('button', { name: /^الوضع (الداكن|الفاتح)$/ });
  await expect(homeToggle).toHaveAttribute('aria-label', 'الوضع الفاتح');
  await page.screenshot({ path: testInfo.outputPath('theme-dark.png') });
  await homeToggle.click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(homeToggle).toHaveAttribute('aria-label', 'الوضع الداكن');
  await page.screenshot({ path: testInfo.outputPath('theme-light.png') });
});
