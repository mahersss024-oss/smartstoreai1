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

async function navigateByVisibleControl(page: Page, href: string, label: string) {
  const visibleLink = page.locator(`a[href="${href}"]:visible`).first();

  if ((await visibleLink.count()) > 0) {
    await visibleLink.click();
    return;
  }

  await page.getByRole('button', { name: label }).click();
}

async function openAssistantChatIfNeeded(page: Page) {
  const input = page.getByPlaceholder(/اكتب طلبك/);

  try {
    await expect(input).toBeVisible({ timeout: 5_000 });
    return input;
  } catch {
    // On compact mobile layouts the chat starts behind the floating Hamad button.
  }

  await page.getByRole('button', { name: /فتح حمد/ }).click({ timeout: 5_000 });
  await expect(input).toBeVisible();
  return input;
}

async function closeAssistantChatIfOpen(page: Page) {
  const backToListings = page.getByRole('button', { name: /العودة للإعلانات/ });

  if (await backToListings.isVisible().catch(() => false)) {
    await backToListings.click();
  }
}

const corePageText: Record<string, RegExp> = {
  '/':
    /\u062a\u0635\u0641\u064a\u0629 \u0627\u0644\u0628\u062d\u062b|\u0644\u0627 \u062a\u0648\u062c\u062f \u0625\u0639\u0644\u0627\u0646\u0627\u062a \u0645\u062a\u0627\u062d\u0629/i,
  '/account': /حسابي/i,
  '/conversations': /محادثات/i,
  '/favorites': /إعلانات محفوظة|المفضلة/i,
  '/commissions': /رسوم المنصة|العمولة|عمولاتي/i,
};

test('manual photo-free publication remains independent of assistant availability and preserves category choice', async ({ page, baseURL }) => {
  await addSignedInSession(baseURL, page);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/chat', route => route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } }));
  await page.route('**/api/marketplace/listing-category', route => route.fulfill({
    json: { status: 'suggested', category: 'mobile_phones', confidence: 0.95 },
  }));
  let created: Record<string, unknown> | undefined;
  let published = 0;
  let imageRequests = 0;
  // Intercept every write so this test never creates a real marketplace listing.
  await page.route('**/api/marketplace/listings', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    created = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { listing: {
      ...created, id: 'photo-free-fixture', status: 'draft', images: [],
    } } });
  });
  await page.route('**/api/marketplace/listings/photo-free-fixture**', async route => {
    if (route.request().url().endsWith('/images')) imageRequests++;
    else if (route.request().method() === 'PATCH') published++;
    await route.fulfill({ json: { listing: { ...created, id: 'photo-free-fixture', status: 'published', images: [] } } });
  });
  await page.goto('/');
  const chat = await openAssistantChatIfNeeded(page);
  await chat.fill('Test assistant availability');
  const unavailable = page.waitForResponse(response => response.url().endsWith('/api/chat'));
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  expect((await unavailable).status()).toBe(503);
  await closeAssistantChatIfOpen(page);
  await page.getByRole('button', { name: 'أنشئ إعلانك يدويًا', exact: true }).click();
  const form = page.locator('.marketplace-home-controls form');
  const title = form.locator('input[maxlength="140"]');
  await title.fill('iPhone 15');
  await form.locator('textarea').fill('Used phone for sale');
  const category = form.locator('select').first();
  await expect(category).toHaveValue('mobile_phones');
  await category.selectOption('furniture');
  await title.fill('Toyota Camry');
  await form.locator('textarea').focus();
  await expect(category).toHaveValue('furniture');
  await form.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: 'الرياض', exact: true }).click();
  await form.getByRole('button', { name: 'حفظ ونشر الإعلان', exact: true })
    .evaluate(element => (element as HTMLButtonElement).click());
  const agreement = page.locator('body > .viewport-overlay > [role="dialog"]');
  await agreement.getByRole('checkbox').check();
  await agreement.getByRole('button', { name: 'استمرار ونشر الإعلان', exact: true }).click();
  await expect.poll(() => published).toBe(1);
  expect(created?.category).toBe('furniture');
  expect(created?.autoCategory).toBe(false);
  expect(imageRequests).toBe(0);
});

test('visitor can reach the marketplace and choose an auth provider', async ({
  page,
}) => {
  const response = await page.goto('/');

  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator('body')).toContainText(corePageText['/']);

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
  await expect(page.getByTestId('auth-provider-menu')).toContainText('جوجل');
  await expect(page.getByTestId('auth-provider-menu')).toContainText('آبل');
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
    await expect(page.locator('body'), path).toContainText(corePageText[path]);
    await expect(
      page.getByRole('button', { name: /جوجل|آبل/i }),
      path,
    ).toHaveCount(0);
  }
});

test('home assistant keeps the current chat while navigating to account and back', async ({
  page,
  baseURL,
}) => {
  await addSignedInSession(baseURL, page);
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'e2e chat provider disabled' }),
    });
  });

  const customerMessage = 'اختبار بقاء المحادثة أثناء التنقل';

  await page.goto('/');
  await (await openAssistantChatIfNeeded(page)).fill(customerMessage);
  await page.getByRole('button', { name: 'إرسال' }).click();
  await expect(page.locator('body')).toContainText(customerMessage);

  await closeAssistantChatIfOpen(page);
  await navigateByVisibleControl(page, '/account', 'حسابي');
  await expect(page).toHaveURL(/\/account$/);
  await navigateByVisibleControl(page, '/', 'الرئيسية');
  await expect(page).toHaveURL(/\/$/);

  await openAssistantChatIfNeeded(page);
  await expect(page.locator('body')).toContainText(customerMessage);
});
