import { expect, type Page, test } from '@playwright/test';

import { createSessionCookie } from '@/lib/auth/session';

function sessionCookieValue() {
  const cookie = createSessionCookie({
    id: 'e2e-customer',
    email: 'e2e-customer@smartstore.local',
    name: 'E2E Customer',
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

test('visitor can reach the marketplace and choose an auth provider', async ({
  page,
}) => {
  const response = await page.goto('/');

  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).toContainText(/SmartStore AI/i);

  const login = page.getByTestId('auth-provider-trigger');
  await login.click();

  if (
    !(await page
      .getByTestId('auth-provider-menu')
      .isVisible()
      .catch(() => false))
  ) {
    await login.focus();
    await page.keyboard.press('Enter');
  }

  await expect(page.getByTestId('auth-provider-menu')).toBeVisible();
  await expect(page.getByTestId('auth-provider-menu')).toContainText(/Google/i);
  await expect(page.getByTestId('auth-provider-menu')).toContainText(/Apple/i);
});

test('signed-in customer can open the core journey pages without auth flash or server errors', async ({
  page,
  baseURL,
}) => {
  await addSignedInSession(baseURL, page);

  for (const path of ['/', '/account', '/conversations', '/favorites', '/commissions']) {
    const response = await page.goto(path);

    expect(response?.status(), path).toBeLessThan(500);
    await expect(page.locator('body'), path).not.toContainText(
      /Application error|Internal Server Error|Unhandled Runtime Error/i,
    );
    await expect(page.locator('body'), path).toContainText(/SmartStore AI/i);
    await expect(
      page.getByRole('button', { name: /Google|Apple/i }),
      path,
    ).toHaveCount(0);
  }
});
