import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
if (process.argv[2] === '--help' && process.argv.length === 3) {
  console.log('Usage: node scripts/dev-tools/devtools-local.mjs [http://127.0.0.1:3197/]');
  console.log('Checks an existing loopback app with the pinned MCP and saves a prepared-context trace under .data/browser-diagnostics/.');
  return;
}
const target = new URL(process.argv[2] || 'http://127.0.0.1:3197/');
if (process.argv.length > 3 || target.protocol !== 'http:' || target.username || target.password ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Supply one HTTP loopback URL without credentials. Remote targets are not allowed.');
}
const toolRoot = resolve(repoRoot, '.data/environment-audit/tools/node_modules/chrome-devtools-mcp');
const pkg = JSON.parse(await readFile(resolve(toolRoot, 'package.json'), 'utf8'));
if (pkg.version !== '1.11.0') throw new Error('Use the pinned diagnostic installer before running this check.');
const chromePath = process.env.CHROME_PATH || resolve(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe');
await access(chromePath);
const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (!response.ok) throw new Error('Local preflight failed with HTTP ' + response.status);
const outputRoot = resolve(repoRoot, '.data/browser-diagnostics');
await mkdir(outputRoot, { recursive: true });
const runDir = await mkdtemp(resolve(outputRoot, 'devtools-'));
const results = [];
const report = { tool: pkg.name, version: pkg.version, target: target.href,
  mode: 'Prepared browsing context; explicit reload with HTTP-cache bypass; five-second trace window',
  preflight: { status: response.status, coop: response.headers.get('cross-origin-opener-policy') },
  passed: false, limitations: 'Local lab check; not a cold browsing-context first visit, production benchmark, or field INP.' };
const child = spawn(process.execPath, [resolve(toolRoot, pkg.bin['chrome-devtools-mcp']),
  '--executable-path=' + chromePath, '--headless', '--isolated',
  '--filesystem-root=' + repoRoot, '--no-usage-statistics', '--no-performance-crux'], {
  cwd: repoRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, TEMP: runDir, TMP: runDir, NODE_DEBUG: '',
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1', CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1' },
});
let buffer = '';
let nextId = 0;
let stderr = '';
const pending = new Map();
const exited = new Promise(resolveExit => child.once('exit', resolveExit));
function rejectPending(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
child.on('error', rejectPending);
child.on('exit', code => rejectPending(new Error('MCP exited: ' + code)));
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
child.stdout.on('data', chunk => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === 'roots/list' && message.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id,
        result: { roots: [{ uri: pathToFileURL(repoRoot).href, name: 'SmartStoreAI' }] } }) + '\n');
      continue;
    }
    const item = pending.get(message.id);
    if (!item) continue;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
  }
});
function request(method, params) {
  const id = ++nextId;
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 90000);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const textOf = result => result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '';
async function call(name, args) {
  const result = await request('tools/call', { name, arguments: args });
  results.push({ name, result });
  if (result.isError) throw new Error(name + ': ' + textOf(result));
  return result;
}
try {
  const init = await request('initialize', { protocolVersion: '2024-11-05',
    capabilities: { roots: { listChanged: false } }, clientInfo: { name: 'smartstore-local-browser-check', version: '1.0.0' } });
  report.server = init.serverInfo;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  report.advertisedTools = (await request('tools/list', {})).tools.length;
  console.log('MCP connected; checking the local page and recording its navigation.');
  await call('new_page', { url: target.href, isolatedContext: 'smartstore-diagnostics', timeout: 20000 });
  const pages = textOf(await call('list_pages', {}));
  const pageId = Number(pages.match(/^(\d+):.*\[selected\]/m)?.[1]);
  if (!Number.isFinite(pageId)) throw new Error('The selected diagnostic page could not be identified.');
  const domResult = textOf(await call('evaluate_script', { pageId, waitForStableDom: false,
    function: '() => ({title: document.title, url: location.href, lang: document.documentElement.lang, dir: document.documentElement.dir, readyState: document.readyState})' }));
  const domJson = domResult.match(/```json\s*([\s\S]*?)```/)?.[1];
  if (!domJson) throw new Error('No structured DOM response was returned.');
  report.dom = JSON.parse(domJson);
  const domUrl = new URL(report.dom.url);
  if (domUrl.origin !== target.origin || domUrl.pathname !== target.pathname) {
    throw new Error('The browser left the supplied loopback route.');
  }
  for (const line of pages.split('\n')) {
    const otherId = Number(line.match(/^(\d+):/)?.[1]);
    if (Number.isFinite(otherId) && otherId !== pageId) await call('close_page', { pageId: otherId });
  }
  await call('navigate_page', { pageId, type: 'url', url: target.href });
  await call('performance_start_trace', { pageId, reload: false, autoStop: false });
  await call('navigate_page', { pageId, type: 'reload', ignoreCache: true });
  // The built-in autoStop mode also observes five seconds. Here navigation is
  // explicit to keep COOP's prepared browsing context throughout recording.
  await call('evaluate_script', { pageId, waitForStableDom: false,
    function: 'async () => { await new Promise(resolve => setTimeout(resolve, 5000)); return {url: location.href}; }' });
  const traceSummary = textOf(await call('performance_stop_trace', { pageId, filePath: resolve(runDir, 'trace.json.gz') }));
  await writeFile(resolve(runDir, 'trace-summary.md'), traceSummary);
  const traceUrl = traceSummary.match(/^URL: (.+)$/m)?.[1]?.trim();
  const measuredUrl = traceUrl ? new URL(traceUrl) : null;
  if (!measuredUrl || measuredUrl.origin !== target.origin || measuredUrl.pathname !== target.pathname ||
      !traceSummary.includes('NAVIGATION_')) {
    throw new Error('The trace did not contain a navigation for the supplied page. No performance result is accepted.');
  }
  report.trace = { url: traceUrl, lcpMs: Number(traceSummary.match(/LCP: ([\d.]+) ms/)?.[1]),
    cls: Number(traceSummary.match(/CLS: ([\d.]+)/)?.[1]) };
  if (!Number.isFinite(report.trace.lcpMs) || !Number.isFinite(report.trace.cls)) {
    throw new Error('The navigation trace did not contain valid LCP and CLS measurements.');
  }
  report.console = textOf(await call('list_console_messages', { pageId }));
  const network = textOf(await call('list_network_requests', { pageId }));
  await writeFile(resolve(runDir, 'network.md'), network);
  report.network = { requests: (network.match(/^reqid=/gm) || []).length,
    failed: network.split('\n').filter(line => /^reqid=/.test(line) && /\[(?:[45]\d\d|failed)/i.test(line)).length };
  report.passed = true;
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
} finally {
  if (!child.stdin.destroyed) child.stdin.end();
  await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 1500))]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 3000))]);
    if (child.exitCode === null && child.signalCode === null) {
      report.cleanupError = 'MCP process termination could not be confirmed.';
      report.passed = false;
      process.exitCode = 1;
    }
  }
  await writeFile(resolve(runDir, 'mcp-results.json'), JSON.stringify(results, null, 2));
  await writeFile(resolve(runDir, 'mcp-stderr.log'), stderr);
  await writeFile(resolve(runDir, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, error: report.error, cleanupError: report.cleanupError, output: runDir,
    trace: report.trace, network: report.network }, null, 2));
}
}

main().catch(error => {
  console.error((error instanceof Error ? error.message : 'Local browser check failed')
    .replace(/https?:\/\/[^\s)]+/g, '[URL]'));
  process.exitCode = 1;
});
