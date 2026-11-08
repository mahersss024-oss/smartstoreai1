import { expect, test, type Page } from '@playwright/test';
import { listing, prepare, report } from './helpers/admin-presentation-fixture';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function controlledRealtime(page: Page) {
  await page.addInitScript(() => {
    const streams = new Set<FakeEventSource>();
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      listeners = new Map<string, EventListener>();
      constructor() { streams.add(this); queueMicrotask(() => this.onopen?.()); }
      addEventListener(name: string, listener: EventListener) { this.listeners.set(name, listener); }
      close() { streams.delete(this); }
    }
    Object.assign(window, {
      EventSource: FakeEventSource,
      adminTestEmit: (id: number) => {
        for (const stream of streams) stream.listeners.get('smartstore')?.(new MessageEvent('smartstore', {
          data: JSON.stringify({ id, type: 'moderation_updated', payload: { entity: 'report' } }),
        }));
      },
    });
  });
}

test('a late moderation read cannot replace the newer queue after another realtime update', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await controlledRealtime(page);
  const started = deferred(), release = deferred(), settled = deferred();
  const original = { ...report, listing: { ...listing, title: 'البلاغ السابق' } };
  const latest = { ...report, id: 'latest-report', listing: { ...listing, title: 'البلاغ الأحدث' } };
  let version: 'initial' | 'slow' | 'latest' = 'initial';
  await page.route('**/api/admin/moderation?**', async route => {
    if (new URL(route.request().url()).searchParams.has('view')) return route.fallback();
    const captured = version;
    if (captured === 'slow') { started.resolve(); await release.promise; }
    await route.fulfill({ json: { listings: [], reports: [captured === 'latest' ? latest : original], userReports: [] } }).catch(() => {});
    if (captured === 'slow') settled.resolve();
  });
  try {
    await page.goto('/admin/moderation');
    await expect(page.getByRole('heading', { name: 'البلاغ السابق', exact: true })).toBeVisible();
    version = 'slow';
    await page.evaluate(() => (window as unknown as { adminTestEmit(id: number): void }).adminTestEmit(1));
    await started.promise;
    version = 'latest';
    await page.evaluate(() => (window as unknown as { adminTestEmit(id: number): void }).adminTestEmit(2));
    await expect(page.getByRole('heading', { name: 'البلاغ الأحدث', exact: true })).toBeVisible();
    release.resolve();
    await settled.promise;
    await expect(page.getByRole('heading', { name: 'البلاغ السابق', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'البلاغ الأحدث', exact: true })).toBeVisible();
  } finally { release.resolve(); }
});

for (const action of ['reject_listing', 'delete_listing'] as const) {
  for (const alreadyResolved of [false, true]) {
    test(`report ${action} uses one atomic request and handles an already-resolved decision: ${alreadyResolved}`, async ({ page, baseURL }) => {
      await prepare(page, baseURL!);
      await controlledRealtime(page);
      const writes: Array<{ path: string; body: unknown }> = [];
      let current = structuredClone(report);
      await page.route('**/api/admin/moderation**', async route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() === 'PATCH') {
          writes.push({ path: url.pathname, body: request.postDataJSON() });
          if (url.pathname !== `/api/admin/moderation/reports/${report.id}`) {
            return route.fulfill({ status: 400, json: { error: 'separate_listing_write_forbidden' } });
          }
          current = { ...current, status: alreadyResolved ? 'dismissed' : 'reviewed', listing: {
            ...current.listing, status: alreadyResolved ? 'published' : action === 'delete_listing' ? 'deleted' : 'rejected',
          } };
          return route.fulfill({ status: alreadyResolved ? 409 : 200, json: alreadyResolved
            ? { error: 'report_already_resolved' } : { status: 'reviewed', report: current } });
        }
        if (url.pathname === '/api/admin/moderation' && !url.searchParams.has('view')) {
          return route.fulfill({ json: { listings: [], reports: [current], userReports: [] } });
        }
        return route.fallback();
      });
      await page.goto('/admin/moderation');
      await page.getByRole('button', { name: action === 'delete_listing' ? 'حذف الإعلان' : 'إيقاف الإعلان', exact: true }).click();
      await page.getByRole('dialog', { name: 'تأكيد إجراء البلاغ', exact: true })
        .getByRole('button', { name: 'تنفيذ الإجراء', exact: true }).click();
      await expect.poll(() => writes.length).toBe(1);
      await expect(page.getByRole(alreadyResolved ? 'alert' : 'status').getByText(alreadyResolved
        ? 'عولج هذا البلاغ مسبقًا. لم يُنفذ الإجراء على الإعلان.'
        : 'تم تنفيذ إجراء البلاغ.', { exact: true })).toBeVisible();
      expect(writes).toEqual([{ path: `/api/admin/moderation/reports/${report.id}`, body: { action } }]);
      expect(current.listing.status).toBe(alreadyResolved ? 'published' : action === 'delete_listing' ? 'deleted' : 'rejected');
    });
  }
}
