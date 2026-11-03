import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const productionHealthUrl = 'https://souqhamad.com/api/health';
export const productionHealthBodyLimit = 64 * 1024;
const defaultTimeoutMs = 10_000;

class HealthCheckFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * One public, read-only health request. No endpoint, credentials, retry, or body
 * override is accepted. The injected transport and clock are for offline tests.
 * @param {{fetcher?: typeof fetch, now?: () => number, timeoutMs?: number}} [options]
 */
export async function checkProductionHealth(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? Math.min(options.timeoutMs, defaultTimeoutMs) : defaultTimeoutMs;
  const controller = new AbortController();
  let reader;
  let httpStatus;
  let timer;
  const cancelBody = () => { if (reader) void reader.cancel().catch(() => {}); };
  let code = 'healthy';
  try {
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new HealthCheckFailure('timeout'));
        controller.abort();
        cancelBody();
      }, timeoutMs);
    });
    const request = (async () => {
      const response = await fetcher(productionHealthUrl, {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json' }, signal: controller.signal,
      });
      httpStatus = response.status;
      if (response.status !== 200 || response.redirected || (response.url && response.url !== productionHealthUrl)) {
        void response.body?.cancel().catch(() => {});
        throw new HealthCheckFailure(response.status >= 300 && response.status < 400 || response.redirected ||
          response.url && response.url !== productionHealthUrl ? 'redirect_refused' : 'http_status');
      }
      const length = response.headers.get('content-length');
      if (length && /^\d+$/.test(length) && Number(length) > productionHealthBodyLimit) {
        void response.body?.cancel().catch(() => {});
        throw new HealthCheckFailure('body_too_large');
      }
      if (!response.body) throw new HealthCheckFailure('invalid_json');
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > productionHealthBodyLimit) {
          cancelBody();
          throw new HealthCheckFailure('body_too_large');
        }
        chunks.push(chunk.value);
      }
      const contents = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { contents.set(chunk, offset); offset += chunk.byteLength; }
      let body;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents)); }
      catch { throw new HealthCheckFailure('invalid_json'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.status !== 'ok' ||
        body.store !== 'database' || body.checks?.database !== 'ok') {
        throw new HealthCheckFailure('invalid_health');
      }
    })();
    await Promise.race([request, deadline]);
  } catch (error) {
    code = error instanceof HealthCheckFailure ? error.code : 'request_failed';
  } finally {
    clearTimeout(timer);
    cancelBody();
  }
  return {
    schemaVersion: 1,
    checkedAt: new Date(startedAt).toISOString(),
    endpoint: productionHealthUrl,
    success: code === 'healthy',
    code,
    ...(Number.isInteger(httpStatus) ? { httpStatus } : {}),
    durationMs: Math.max(0, Math.round(now() - startedAt)),
  };
}

async function main() {
  const result = await checkProductionHealth();
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const report = resolve(root, 'coverage/production-health-check.json');
  mkdirSync(dirname(report), { recursive: true });
  writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `# Production health\n\nChecked: ${result.checkedAt}\n\nResult: ${result.code}\n\nHTTP: ${result.httpStatus ?? 'unavailable'}\n\nDuration: ${result.durationMs} ms\n\nThis single public health check verifies server/database availability, not customer journeys or external providers.\n`);
  if (!result.success) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Production health monitor could not complete or save its bounded report.'); process.exitCode = 1; });
}
