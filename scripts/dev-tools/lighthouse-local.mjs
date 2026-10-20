import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const toolsRoot = join(repoRoot, '.data/environment-audit/tools/node_modules');
const pinnedVersions = { 'chrome-devtools-mcp': '1.11.0', lighthouse: '13.5.0' };
const metricIds = [
  'first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time',
  'cumulative-layout-shift', 'speed-index',
];
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

function localUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Provide an absolute HTTP loopback URL.');
  }
  if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname)
    || url.username || url.password) {
    throw new Error('Only HTTP loopback URLs without credentials are permitted.');
  }
  return url;
}

function displayUrl(url) {
  // Do not put potentially sensitive query parameters or fragments in console/summary output.
  return `${url.origin}${url.pathname}`;
}

function errorText(error) {
  return (error instanceof Error ? error.message : 'Unknown diagnostic failure')
    .replace(/https?:\/\/[^\s)]+/g, '[URL]');
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

async function findChrome() {
  if (process.env.CHROME_PATH) {
    const configuredPath = process.env.CHROME_PATH;
    if (!isAbsolute(configuredPath) || !(await isFile(configuredPath))) {
      throw new Error('CHROME_PATH must name an existing absolute Chrome executable.');
    }
    return configuredPath;
  }
  const folders = [
    process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA, 'C:/Program Files', 'C:/Program Files (x86)',
  ].filter(Boolean);
  for (const folder of new Set(folders)) {
    const candidate = join(folder, 'Google/Chrome/Application/chrome.exe');
    if (await isFile(candidate)) return candidate;
  }
  throw new Error('Chrome was not found. Set CHROME_PATH to an existing Chrome executable.');
}

async function loadTools() {
  for (const [name, expected] of Object.entries(pinnedVersions)) {
    const packageFile = join(toolsRoot, name, 'package.json');
    if (!(await isFile(packageFile))) {
      throw new Error('Pinned local diagnostics are missing. Run scripts/dev-tools/install-audit-tools.ps1 first.');
    }
    const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
    if (metadata.version !== expected) {
      throw new Error(`The local ${name} version must be ${expected}; review the isolated tools installation.`);
    }
  }
  const load = path => import(pathToFileURL(join(toolsRoot, path)).href);
  const [mcp, lighthouse, config, saver, generator] = await Promise.all([
    load('chrome-devtools-mcp/build/src/third_party/index.js'),
    load('lighthouse/core/index.js'),
    load('lighthouse/core/config/desktop-config.js'),
    load('lighthouse/core/lib/asset-saver.js'),
    load('lighthouse/report/generator/report-generator.js'),
  ]);
  return {
    puppeteer: mcp.puppeteer, lighthouse: lighthouse.default, desktopConfig: config.default,
    saveAssets: saver.saveAssets, ReportGenerator: generator.ReportGenerator,
  };
}

function validateResult(lhr, target) {
  if (lhr.runtimeError) {
    throw new Error(`Lighthouse failed: ${lhr.runtimeError.code || 'runtime error'}.`);
  }
  for (const value of [lhr.finalDisplayedUrl, lhr.finalUrl]) {
    if (!value) throw new Error('Lighthouse did not identify the measured final URL.');
    const finalUrl = localUrl(value);
    if (finalUrl.origin !== target.origin || finalUrl.pathname !== target.pathname) {
      throw new Error('The measured page redirected away from the requested local route.');
    }
  }
  const score = lhr.categories?.performance?.score;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('Lighthouse did not produce a numeric performance score.');
  }
  for (const id of metricIds) {
    if (!Number.isFinite(lhr.audits?.[id]?.numericValue)) {
      throw new Error(`Lighthouse did not produce the ${id} metric.`);
    }
  }
  const failedAudits = Object.entries(lhr.audits || {})
    .filter(([, audit]) => audit.errorMessage || audit.scoreDisplayMode === 'error')
    .map(([id]) => id);
  if (failedAudits.length) {
    throw new Error(`Lighthouse audit errors: ${failedAudits.join(', ')}.`);
  }
}

async function audit(target) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major >= 25 || (major === 22 && minor < 19)) {
    throw new Error('Use the project Node range >=22.19 <25 for these pinned diagnostics.');
  }
  const executablePath = await findChrome();
  const diagnosticsRoot = join(repoRoot, '.data/browser-diagnostics');
  await mkdir(diagnosticsRoot, { recursive: true });
  const runDir = await mkdtemp(join(diagnosticsRoot, 'lighthouse-'));
  const tempDir = join(runDir, 'temp');
  const profileDir = join(runDir, 'profile');
  await Promise.all([mkdir(tempDir), mkdir(profileDir)]);
  process.env.TEMP = process.env.TMP = tempDir;
  const summary = {
    success: false, startedAt: new Date().toISOString(), target: displayUrl(target),
    mode: 'prepared browsing context navigation; desktop; storage reset enabled; provided throttling',
    versions: { node: process.version, ...pinnedVersions },
    settings: { skipAboutBlank: true, disableStorageReset: false, throttlingMethod: 'provided' },
    limitations: [
      'Local laboratory sample with fixture/development data; not a production or field measurement.',
      'The page enters the origin before measurement; this is not an untouched first visit.',
      'Storage/cache reset is enabled, but browser processes and server caches may be warm.',
      'Provided throttling uses this machine; scores are not comparable to mobile or PSI defaults.',
      'TBT is a laboratory metric, not field INP.',
    ],
  };
  let browser;
  try {
    const { puppeteer, lighthouse, desktopConfig, saveAssets, ReportGenerator } = await loadTools();
    browser = await puppeteer.launch({ executablePath, headless: true,
      userDataDir: profileDir, pipe: false, timeout: 15_000 });
    summary.versions.browser = await browser.version();
    const pages = await browser.pages();
    if (pages.length !== 1) throw new Error('Expected one fresh browser page for the local audit.');
    const [page] = pages;
    const response = await page.goto(target.href, { waitUntil: 'load', timeout: 30_000 });
    const preparedUrl = localUrl(page.url());
    summary.preflight = {
      status: response?.status() ?? null, finalUrl: displayUrl(preparedUrl),
      crossOriginOpenerPolicy: response?.headers()['cross-origin-opener-policy'] ?? null,
    };
    if (!response?.ok() || preparedUrl.origin !== target.origin || preparedUrl.pathname !== target.pathname) {
      throw new Error('The local preflight did not load the requested route successfully.');
    }
    const result = await lighthouse(target.href, {
      output: 'json', logLevel: 'error', onlyCategories: ['performance'],
      skipAboutBlank: true, disableStorageReset: false, throttlingMethod: 'provided',
      disableFullPageScreenshot: true, enableErrorReporting: false,
    }, desktopConfig, page);
    if (!result?.lhr) throw new Error('Lighthouse returned no result.');
    const { lhr } = result;
    summary.result = {
      performance: lhr.categories?.performance?.score ?? null,
      runtimeError: lhr.runtimeError?.code ?? null,
      metrics: Object.fromEntries(metricIds.map(id => [id, lhr.audits?.[id]?.numericValue ?? null])),
      auditErrors: Object.entries(lhr.audits || {})
        .filter(([, entry]) => entry.errorMessage || entry.scoreDisplayMode === 'error')
        .map(([id]) => id),
    };
    await writeFile(join(runDir, 'report.json'), JSON.stringify(lhr, null, 2));
    await writeFile(join(runDir, 'report.html'), ReportGenerator.generateReportHtml(lhr));
    await saveAssets(result.artifacts, lhr.audits, join(runDir, 'assets'));
    validateResult(lhr, target);
    summary.success = true;
  } catch (error) {
    summary.error = errorText(error);
    process.exitCode = 1;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        summary.cleanupError = errorText(error);
        summary.success = false;
        process.exitCode = 1;
      }
    }
    summary.finishedAt = new Date().toISOString();
    await writeFile(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ success: summary.success, performance: summary.result?.performance ?? null,
      reportDirectory: resolve(runDir), error: summary.error, cleanupError: summary.cleanupError }, null, 2));
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log('Usage: node scripts/dev-tools/lighthouse-local.mjs [http://127.0.0.1:3197/]');
    console.log('Requires existing pinned local tools and Chrome. Saves a prepared-context desktop audit under .data/browser-diagnostics/.');
  } else {
    if (args.length > 1) throw new Error('Provide at most one HTTP loopback URL.');
    const target = localUrl(args[0] || 'http://127.0.0.1:3197/');
    await audit(target);
  }
} catch (error) {
  console.error(errorText(error));
  process.exitCode = 1;
}
