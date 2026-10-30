import { expect, test } from '@playwright/test';
import { createSessionCookie } from '@/lib/auth/session';
import { prepare } from './helpers/admin-presentation-fixture';

test.beforeEach(async ({ baseURL, page }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

test('admin entry is independent, explicit, and preserves the requested admin destination', async ({ page }, info) => {
  let authStarts = 0;
  await page.route('**/api/auth/google/start**', route => {
    authStarts++;
    const url = new URL(route.request().url());
    expect(url.searchParams.get('return_to')).toBe('/admin/listings');
    return route.fulfill({ status: 302, headers: { location: '/admin?auth-fixture=1' } });
  });
  const response = await page.goto('/admin/listings');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(page.locator('[data-admin-entry]')).toBeVisible();
  expect((await page.locator('[data-admin-entry]').boundingBox())?.y).toBe(0);
  const login = page.getByRole('link', { name: 'تسجيل الدخول باستخدام Google' });
  await expect(login).toHaveAttribute('href', '/api/auth/google/start?return_to=%2Fadmin%2Flistings');
  await expect(page.locator('.admin-content, .app-download-gateway, .marketplace-bottom-nav, .open-in-app-banner')).toHaveCount(0);
  expect(authStarts).toBe(0);
  await page.screenshot({ path: info.outputPath('admin-entry.png'), fullPage: true });
  await login.click();
  await expect.poll(() => authStarts).toBe(1);
  await expect(page).toHaveURL(url => url.pathname === '/admin');
});

test('admin authentication keeps the existing agreement and return-to contract', async ({ page }) => {
  const response = await page.request.get('/api/auth/google/start?return_to=%2Fadmin%2Fusers', { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const location = new URL(response.headers().location);
  expect(location.pathname).toBe('/commission-agreement');
  expect(location.searchParams.get('return_to')).toBe('/admin/users');
  expect(location.searchParams.get('provider')).toBe('google');
});

test('real logout clears the cookie, hides protected content and returns to admin', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  // Exercise the real local session and logout handlers, rather than mocking sign-out.
  await page.unroute('**/api/auth/session');
  await page.goto('/admin');
  await expect(page.locator('.admin-workspace')).toBeVisible();
  const menu = page.getByRole('button', { name: 'فتح قائمة الإدارة', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('link', { name: 'الإعلانات', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/admin/listings');
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page).toHaveURL(url => url.pathname === '/admin');
  await expect(page.getByRole('link', { name: 'تسجيل الدخول باستخدام Google' })).toBeVisible();
  expect((await page.request.get('/api/auth/session')).ok()).toBe(true);
  expect((await (await page.request.get('/api/auth/session')).json()).authenticated).toBe(false);
  expect((await page.context().cookies()).filter(cookie => cookie.name === 'smartstore_session')).toEqual([]);
  await page.goBack();
  await expect(page.locator('[data-admin-entry]')).toBeVisible();
  await expect(page.locator('.admin-content')).toHaveCount(0);
  await page.goto('/');
  await expect(page.locator('.app-download-gateway')).toBeVisible();
  await expect(page.locator('[data-admin-entry], .admin-workspace')).toHaveCount(0);
});

test('a customer cannot open the administration and can sign out from its entry', async ({ page, baseURL }) => {
  const [name, value] = createSessionCookie({ id: 'entry-customer', email: 'entry-customer@example.test', role: 'user' }).split(';')[0].split('=');
  await page.context().addCookies([{ name, value, url: baseURL! }]);
  await page.goto('/admin');
  await expect(page.getByText('هذا الحساب لا يملك صلاحية الإدارة.')).toBeVisible();
  await expect(page.locator('.admin-content, .admin-sidebar')).toHaveCount(0);
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page.getByRole('link', { name: 'تسجيل الدخول باستخدام Google' })).toBeVisible();
  const denied = await page.request.get('/api/admin/overview');
  expect(denied.status()).toBe(401);
});

test('failed logout stays in administration and offers an honest retry', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.route('**/api/auth/logout', route => route.fulfill({ status: 503 }));
  await page.goto('/admin');
  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'تعذر تسجيل الخروج. حاول مرة أخرى.' })).toBeVisible();
  await expect(page.locator('.admin-workspace')).toBeVisible();
  await expect(page).toHaveURL(url => url.pathname === '/admin');
});

test('session revocation on focus removes administrative data', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await page.goto('/admin');
  await expect(page.locator('.admin-content')).toBeVisible();
  await page.route('**/api/auth/session', route => route.fulfill({ json: { authenticated: false, user: null } }));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-admin-entry]')).toBeVisible();
  await expect(page.locator('.admin-content')).toHaveCount(0);
});
