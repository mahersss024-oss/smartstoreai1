import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { checkProductionHealth, productionHealthBodyLimit, productionHealthUrl } from '@/scripts/monitoring/check-production-health.mjs';

const healthy = { status: 'ok', store: 'database', checks: { database: 'ok' } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('production health makes one credential-free GET to only the canonical health URL', async () => {
  const requests: Array<{ input: unknown; init: RequestInit | undefined }> = [];
  let clock = Date.parse('2026-11-03T10:00:00.000Z');
  const result = await checkProductionHealth({
    now: () => clock,
    fetcher: async (input, init) => {
      requests.push({ input, init });
      clock += 12;
      return response({ ...healthy, checks: { database: 'ok', databaseErrorMessage: 'private-database-detail' } });
    },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'https://souqhamad.com/api/health');
  assert.equal(requests[0].init?.method, 'GET');
  assert.equal(requests[0].init?.redirect, 'manual');
  assert.equal(requests[0].init?.credentials, 'omit');
  assert.equal(requests[0].init?.cache, 'no-store');
  assert.deepEqual(requests[0].init?.headers, { Accept: 'application/json' });
  assert.ok(requests[0].init?.signal instanceof AbortSignal);
  assert.deepEqual(result, {
    schemaVersion: 1, checkedAt: '2026-11-03T10:00:00.000Z', endpoint: productionHealthUrl,
    success: true, code: 'healthy', httpStatus: 200, durationMs: 12,
  });
  assert.doesNotMatch(JSON.stringify(result), /private-database-detail|databaseErrorMessage/);
});

test('production health refuses redirects without requesting their destination or reading their body', async () => {
  for (const status of [301, 302, 307, 308]) {
    let calls = 0;
    let cancelled = false;
    const result = await checkProductionHealth({ fetcher: async (input, init) => {
      calls++;
      assert.equal(input, productionHealthUrl);
      assert.equal(init?.redirect, 'manual');
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
        status, headers: { location: 'https://must-not-contact.example/private' },
      });
    } });
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
    assert.equal(result.success, false);
    assert.equal(result.code, 'redirect_refused');
    assert.doesNotMatch(JSON.stringify(result), /must-not-contact|private/);
  }
});

test('production health accepts only HTTP 200 with all production database health fields', async () => {
  for (const status of [201, 202, 401, 403, 404, 429, 500, 503]) {
    const result = await checkProductionHealth({ fetcher: async () => response(healthy, status) });
    assert.equal(result.success, false);
    assert.equal(result.code, 'http_status');
    assert.equal(result.httpStatus, status);
  }
  for (const body of [null, [], {}, { ...healthy, status: 'degraded' }, { ...healthy, store: 'file' },
    { ...healthy, checks: { database: 'error', databaseErrorMessage: 'private-connection-string' } },
    { ...healthy, checks: null }, { status: 'ok', store: 'database' }]) {
    const result = await checkProductionHealth({ fetcher: async () => response(body) });
    assert.equal(result.success, false);
    assert.equal(result.code, 'invalid_health');
    assert.doesNotMatch(JSON.stringify(result), /private-connection-string/);
  }
});

test('production health deadline includes a stalled transport and aborts the one request', async () => {
  let signal: AbortSignal | null | undefined;
  const result = await checkProductionHealth({ timeoutMs: 25, fetcher: async (_input, init) => {
    signal = init?.signal;
    return await new Promise<Response>(() => {});
  } });
  assert.equal(result.success, false);
  assert.equal(result.code, 'timeout');
  assert.equal(signal?.aborted, true);
});

test('production health deadline remains active after headers while response content is stalled', async () => {
  let cancelled = false;
  const result = await checkProductionHealth({ timeoutMs: 25, fetcher: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"status":')); },
    cancel() { cancelled = true; },
  }), { status: 200 }) });
  assert.equal(result.httpStatus, 200);
  assert.equal(result.success, false);
  assert.equal(result.code, 'timeout');
  assert.equal(cancelled, true);
});

test('production health enforces declared and streamed byte limits without retaining error contents', async () => {
  let declaredCancelled = false;
  const declared = await checkProductionHealth({ fetcher: async () => new Response(new ReadableStream({
    cancel() { declaredCancelled = true; },
  }), { status: 200, headers: { 'content-length': String(productionHealthBodyLimit + 1) } }) });
  assert.equal(declared.code, 'body_too_large');
  assert.equal(declaredCancelled, true);
  let streamedCancelled = false;
  const streamed = await checkProductionHealth({ fetcher: async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(productionHealthBodyLimit));
      controller.enqueue(new TextEncoder().encode('private-excess-content'));
    },
    cancel() { streamedCancelled = true; },
  })) });
  assert.equal(streamed.code, 'body_too_large');
  assert.equal(streamedCancelled, true);
  assert.doesNotMatch(JSON.stringify(streamed), /private-excess-content/);
});

test('production health sanitizes malformed content, transport and body-read failures', async () => {
  for (const contents of ['<html>private-database-url</html>', '{broken', '']) {
    const result = await checkProductionHealth({ fetcher: async () => new Response(contents) });
    assert.equal(result.code, 'invalid_json');
    assert.doesNotMatch(JSON.stringify(result), /private-database-url|broken/);
  }
  for (const fetcher of [
    async () => { throw new Error('postgresql://private-user:private-password@private-host/database'); },
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('private-provider-details')); } })),
  ]) {
    const result = await checkProductionHealth({ fetcher });
    assert.equal(result.code, 'request_failed');
    assert.equal(result.success, false);
    assert.doesNotMatch(JSON.stringify(result), /private-|postgresql/);
  }
});

test('production health workflow is hourly/manual with read-only permissions, one check and short-lived bounded artifact', () => {
  const require = createRequire(resolve('package.json'));
  const yaml = createRequire(require.resolve('eslint'))('js-yaml') as { load: (source: string) => unknown };
  const source = readFileSync('.github/workflows/production-health.yml', 'utf8');
  const workflow = yaml.load(source) as {
    on: { workflow_dispatch: unknown; schedule: Array<{ cron: string }> };
    permissions: Record<string, string>;
    jobs: Record<string, { 'timeout-minutes': number; steps: Array<{ run?: string; uses?: string; if?: string; with?: Record<string, string | number> }> }>;
  };
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '23 * * * *' }]);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.doesNotMatch(source, /secrets\.|issues:|id-token:|curl |wget |bootstrap|notifications\/|push\/|\.env/);
  assert.deepEqual(Object.keys(workflow.jobs), ['health']);
  const job = workflow.jobs.health;
  assert.equal(job['timeout-minutes'], 2);
  assert.deepEqual(job.steps.filter(step => step.run).map(step => step.run), ['node scripts/monitoring/check-production-health.mjs']);
  const artifact = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(artifact);
  assert.equal(artifact.if, '${{ always() }}');
  assert.equal(artifact.with?.path, 'coverage/production-health-check.json');
  assert.equal(artifact.with?.['retention-days'], 3);
  assert.equal(artifact.with?.['if-no-files-found'], 'error');
});
