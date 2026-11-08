import { expect, test, type Page } from '@playwright/test';
import { customer, listing, now, prepare, report } from './helpers/admin-presentation-fixture';

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

type ModerationFlow = 'listing' | 'conversation' | 'delete-listing-report' | 'delete-conversation-report';
const moderationFlows: ModerationFlow[] = ['listing', 'conversation', 'delete-listing-report', 'delete-conversation-report'];
const uncertainResult = 'تعذر تأكيد نتيجة الإجراء. حدّث القائمة للتحقق قبل المحاولة مجددًا.';

function queueForFlow(flow: ModerationFlow, id: string, title: string, missing = false) {
  const conversation = {
    id, reporterId: customer.id, targetUserId: 'reported-customer',
    reason: 'conversation_report', status: flow.startsWith('delete') ? 'reviewed' : 'open',
    createdAt: now, conversation: { id: `conversation-${id}`, status: 'active', listing: { id: listing.id, title }, messages: [] },
  };
  return {
    listings: !missing && flow === 'listing' ? [{ ...listing, id, title, status: 'pending' }] : [],
    reports: !missing && flow === 'delete-listing-report'
      ? [{ ...report, id, status: 'reviewed', listing: { ...listing, title } }] : [],
    userReports: !missing && (flow === 'conversation' || flow === 'delete-conversation-report') ? [conversation] : [],
  };
}

async function startModerationFlow(page: Page, flow: ModerationFlow) {
  if (flow === 'listing') {
    await page.getByRole('button', { name: 'اعتماد', exact: true }).click();
  } else if (flow === 'conversation') {
    await page.getByRole('button', { name: 'توثيق المراجعة', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'حذف البلاغ', exact: true }).click();
    await page.getByRole('dialog', { name: 'تأكيد حذف البلاغ', exact: true })
      .getByRole('button', { name: 'تنفيذ الإجراء', exact: true }).click();
  }
}

function flowActionButton(page: Page, flow: ModerationFlow) {
  return page.getByRole('button', { name: flow === 'listing' ? 'اعتماد' : flow === 'conversation' ? 'توثيق المراجعة' : 'حذف البلاغ', exact: true });
}

for (const flow of moderationFlows) {
  test(`${flow} reports uncertain network results and releases its busy state`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await controlledRealtime(page);
    const started = deferred(), release = deferred();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let writes = 0;
    await page.route('**/api/admin/moderation**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') {
        writes++;
        started.resolve();
        await release.promise;
        return route.abort('failed').catch(() => {});
      }
      if (url.pathname === '/api/admin/moderation' && !url.searchParams.has('view'))
        return route.fulfill({ json: queueForFlow(flow, 'network-target', 'إجراء تحت الاختبار') });
      return route.fallback();
    });
    try {
      await page.goto('/admin/moderation');
      await expect(page.getByRole('heading', { name: 'إجراء تحت الاختبار', exact: true })).toBeVisible();
      await startModerationFlow(page, flow);
      await started.promise;
      await expect(flowActionButton(page, flow)).toBeDisabled();
      release.resolve();
      await expect(page.getByRole('alert').getByText(uncertainResult, { exact: true })).toBeVisible();
      await expect(flowActionButton(page, flow)).toBeEnabled();
      expect(writes).toBe(1);
      expect(errors).toEqual([]);
    } finally { release.resolve(); }
  });

  test(`${flow} ignores an old completion after focus changes and preserves the newer pending action`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await controlledRealtime(page);
    const firstStarted = deferred(), firstRelease = deferred(), firstSettled = deferred();
    const secondStarted = deferred(), secondRelease = deferred();
    const reads: string[] = [];
    let writes = 0;
    await page.route('**/api/admin/moderation**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') {
        const first = ++writes === 1;
        (first ? firstStarted : secondStarted).resolve();
        await (first ? firstRelease : secondRelease).promise;
        await route.fulfill({ json: { status: 'reviewed' } }).catch(() => {});
        if (first) firstSettled.resolve();
        return;
      }
      if (url.pathname === '/api/admin/moderation' && !url.searchParams.has('view')) {
        const focus = url.searchParams.get('reportId') ?? 'target-B';
        reads.push(focus);
        return route.fulfill({ json: queueForFlow(flow, focus, focus === 'target-A' ? 'السجل السابق' : 'السجل الحالي') });
      }
      return route.fallback();
    });
    try {
      await page.goto(`/admin/moderation?reportId=target-A&sourceType=${flow === 'delete-listing-report' ? 'Report' : 'UserReport'}`);
      await expect(page.getByRole('heading', { name: 'السجل السابق', exact: true })).toBeVisible();
      await startModerationFlow(page, flow);
      await firstStarted.promise;
      await page.getByRole('link', { name: 'عرض كل البلاغات', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'السجل الحالي', exact: true })).toBeVisible();
      await startModerationFlow(page, flow);
      await secondStarted.promise;
      const firstFocusReads = reads.filter(id => id === 'target-A').length;
      const firstResponse = page.waitForResponse(response => response.request().method() !== 'GET' && response.url().includes('/target-A'));
      firstRelease.resolve();
      await firstSettled.promise;
      await (await firstResponse).finished();
      // Let the browser process the returned old response before observing the current action.
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await expect(page.getByRole('heading', { name: 'السجل الحالي', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'السجل السابق', exact: true })).toHaveCount(0);
      await expect(flowActionButton(page, flow)).toBeDisabled();
      expect(reads.filter(id => id === 'target-A')).toHaveLength(firstFocusReads);
      secondRelease.resolve();
      await expect(flowActionButton(page, flow)).toBeEnabled();
      expect(writes).toBe(2);
    } finally { firstRelease.resolve(); secondRelease.resolve(); }
  });

  test(`${flow} refreshes a confirmed missing target rather than leaving an actionable stale record`, async ({ page, baseURL }) => {
    await prepare(page, baseURL!);
    await controlledRealtime(page);
    let missing = false;
    await page.route('**/api/admin/moderation**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') {
        missing = true;
        return route.fulfill({ status: 404, json: { error: 'not_found' } });
      }
      if (url.pathname === '/api/admin/moderation' && !url.searchParams.has('view'))
        return route.fulfill({ json: queueForFlow(flow, 'missing-target', 'السجل المحذوف', missing) });
      return route.fallback();
    });
    await page.goto('/admin/moderation');
    await expect(page.getByRole('heading', { name: 'السجل المحذوف', exact: true })).toBeVisible();
    await startModerationFlow(page, flow);
    await expect(page.getByRole('heading', { name: 'السجل المحذوف', exact: true })).toHaveCount(0);
    await expect(page.locator('.viewport-notice[role="alert"]')).toContainText('لم يعد متاحًا');
  });
}

test('an already-resolved conversation report refreshes its closed state with a truthful conflict message', async ({ page, baseURL }) => {
  await prepare(page, baseURL!);
  await controlledRealtime(page);
  let resolved = false, reads = 0;
  await page.route('**/api/admin/moderation**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'PATCH') {
      resolved = true;
      return route.fulfill({ status: 409, json: { error: 'report_already_resolved' } });
    }
    if (url.pathname === '/api/admin/moderation' && !url.searchParams.has('view')) {
      reads++;
      const queue = queueForFlow('conversation', 'closed-conversation-report', 'بلاغ مغلق بالتزامن');
      if (resolved) queue.userReports[0].status = 'reviewed';
      return route.fulfill({ json: queue });
    }
    return route.fallback();
  });
  await page.goto('/admin/moderation');
  await startModerationFlow(page, 'conversation');
  await expect(page.getByRole('alert').getByText('عولج بلاغ المحادثة مسبقًا. لم يُنفذ إجراء جديد.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'توثيق المراجعة', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'حذف البلاغ', exact: true })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('تعذر معالجة بلاغ المحادثة، وبقي البلاغ مفتوحًا.', { exact: true })).toHaveCount(0);
});
