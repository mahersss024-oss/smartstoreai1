import { expect, type Page, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

function sessionCookieValue() {
  const cookie = createSessionCookie({
    id: 'e2e-mobile-chat',
    email: 'e2e-mobile-chat@smartstore.local',
    name: 'E2E Mobile Chat',
  });

  return cookie.split(';')[0]?.split('=').slice(1).join('=') ?? '';
}

async function addSignedInSession(baseURL: string | undefined, page: Page) {
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

test('mobile assistant input stays attached to the visual viewport keyboard edge', async ({
  page,
  baseURL,
}) => {
  const viewport = page.viewportSize();

  if (!viewport || viewport.width >= 1024) {
    test.skip(
      true,
      'mobile keyboard layout is only active on compact viewports',
    );
    return;
  }

  await addSignedInSession(baseURL, page);
  await page.addInitScript(() => {
    sessionStorage.setItem('smartstore_welcome_seen', '1');

    const target = new EventTarget();
    const frame = {
      height: window.innerHeight,
      offsetTop: 0,
      width: window.innerWidth,
    };
    const visualViewportMock = {
      get height() {
        return frame.height;
      },
      get offsetTop() {
        return frame.offsetTop;
      },
      get width() {
        return frame.width;
      },
      get offsetLeft() {
        return 0;
      },
      get pageTop() {
        return frame.offsetTop;
      },
      get pageLeft() {
        return 0;
      },
      get scale() {
        return 1;
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewportMock,
    });

    Object.defineProperty(window, '__setSmartstoreVisualViewportFrame', {
      configurable: true,
      value: (height: number, offsetTop = 0) => {
        frame.height = height;
        frame.offsetTop = offsetTop;
        target.dispatchEvent(new Event('resize'));
        target.dispatchEvent(new Event('scroll'));
      },
    });
  });

  await page.goto('/?chat=1');
  await expect(page.getByTestId('assistant-panel')).toBeVisible();

  const textarea = page.locator('textarea').first();
  await textarea.click();

  const keyboardViewportHeight = Math.max(360, viewport.height - 320);
  await page.evaluate((height) => {
    (
      window as unknown as Window & {
        __setSmartstoreVisualViewportFrame: (height: number, offsetTop?: number) => void;
      }
    ).__setSmartstoreVisualViewportFrame(height, 0);
  }, keyboardViewportHeight);

  await expect
    .poll(async () => {
      return page.getByTestId('assistant-panel').evaluate((element) => {
        return Math.round(element.getBoundingClientRect().height);
      });
    })
    .toBe(keyboardViewportHeight - 8);

  const panelViewportFit = await page.getByTestId('assistant-panel').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportBottom = (viewport?.height ?? window.innerHeight) + viewportTop;

    return {
      bottomDelta: Math.abs(rect.bottom - viewportBottom),
      height: rect.height,
      topDelta: Math.abs(rect.top - viewportTop),
    };
  });

  expect(panelViewportFit.topDelta).toBeLessThanOrEqual(10);
  expect(panelViewportFit.bottomDelta).toBeLessThanOrEqual(4);
  expect(panelViewportFit.height).toBeGreaterThan(240);

  const inputBottomDelta = await page
    .getByTestId('assistant-chat-input-container')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportBottom = (viewport?.height ?? window.innerHeight) +
        (viewport?.offsetTop ?? 0);

      return Math.abs(rect.bottom - viewportBottom);
    });

  expect(inputBottomDelta).toBeLessThanOrEqual(4);
});
