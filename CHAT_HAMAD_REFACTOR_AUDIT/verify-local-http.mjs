import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const fixture = 'HAMAD_HTTP_SMOKE_CHILD';
if (process.env[fixture] === '1') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.hostname !== 'api.deepseek.com') return realFetch(request, init);
    const { messages } = JSON.parse(String(init?.body));
    const instructions = messages.filter(({ role }) => role === 'system').map(({ content }) => content).join('\n');
    let result;
    if (instructions.includes('[hamad:plan]')) {
      const { request: customer } = JSON.parse(messages.at(-1).content);
      const cases = {
        'جهز مسودة لابتوب': { action: 'create', details: { category: 'computers', title: 'لابتوب' },
          reference: 'جهز مسودة', confirmWrite: true, evidence: { category: 'لابتوب', title: 'لابتوب' } },
        'اعرض مسوداتي': { action: 'list' },
        'الأولى': { action: 'select', choice: 1, reference: 'الأولى' },
        'خل السعر ٥٠٠': { action: 'update', details: { price: 500 }, reference: 'خل السعر ٥٠٠',
          confirmWrite: true, evidence: { price: '٥٠٠' } },
      };
      result = JSON.stringify(cases[customer] ?? { action: 'outside' });
    } else if (instructions.includes('[hamad:write-check]') || instructions.includes('[hamad:source-check]')) {
      result = '{"allow":true}';
    } else if (instructions.includes('[hamad:reply]')) {
      const { facts } = JSON.parse(messages.at(-1).content);
      result = facts?.receipts?.length ? 'تم حفظ التغيير في مسودتك.' : 'تفضل، هذه تفاصيل المسودة.';
    } else {
      result = '{}';
    }
    return Response.json({ id: 'hamad-http-fixture', object: 'chat.completion', created: 1, model: 'fixture',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: result } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  };
} else {
  const [source, output, ...flags] = process.argv.slice(2);
  assert.ok(source && output, 'Usage: node verify-local-http.mjs CLEAN_SERVER_WORKTREE RECEIPT_JSON [--cards] [--postgres]');
  assert.ok(flags.every((flag) => flag === '--postgres' || flag === '--cards'), 'Unknown smoke-test mode');
  const dbMode = flags.includes('--postgres');
  const cards = flags.includes('--cards');
  let databaseUrl;
  if (dbMode) {
    const target = new URL(process.env.DATABASE_URL ?? '');
    assert.ok(target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' && target.port === '55432'
      && target.pathname === '/smartstore_codex_test' && target.username === 'codex_local',
    'Database mode requires the dedicated local audit test database');
    databaseUrl = target.href;
  }
  const cwd = resolve(source);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  assert.equal(git('status', '--porcelain=v1'), '');
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local']) {
    assert.ok(!existsSync(resolve(cwd, name)), 'The isolated checkout must contain no runtime environment files');
  }
  assert.ok(existsSync(resolve(cwd, '.next', 'BUILD_ID')), 'Build the isolated checkout first');
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((finish) => reservation.close(finish));

  const keep = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|COMSPEC|WINDIR|TEMP|TMP|TMPDIR|USERPROFILE|HOME|APPDATA|LOCALAPPDATA|LANG)$/i;
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => keep.test(name))),
    CI: '1', NEXT_TELEMETRY_DISABLED: '1',
    AUTH_SECRET: 'hamad-http-synthetic-only-verified-secret',
    DEEPSEEK_API_KEY: 'fixture-deepseek-key',
    SMARTSTORE_HAMAD_STRUCTURED: '1', SMARTSTORE_MARKETPLACE_STORE: dbMode ? 'database' : 'file',
    SMARTSTORE_IMAGE_STORAGE: '', SMARTSTORE_DATA_DIR: mkdtempSync(join(tmpdir(), 'hamad-http-proof-')),
    [fixture]: '1', NODE_OPTIONS: '--import=' + import.meta.url,
  };
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  const owner = 'hamad-http-synthetic-' + randomUUID();
  const email = owner + '@example.test';
  function databaseScript(script) {
    const args = ['node_modules/tsx/dist/cli.mjs', '-e',
      "const {prisma}=require('./lib/db/prisma'); void (async()=>{" + script +
      "})().catch(()=>{process.exitCode=1}).finally(()=>prisma.$disconnect());"];
    execFileSync(process.execPath, args, { cwd, env, stdio: 'pipe' });
  }
  const constants = execFileSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '-e', [
    "const {createSessionCookie}=require('./lib/auth/session');",
    "const {aiConsentHeader,aiSharingConsent}=require('./lib/platform/ai-consent');",
    'console.log(JSON.stringify({cookie:createSessionCookie(' + JSON.stringify({ id: owner, email }) + '),aiConsentHeader,version:aiSharingConsent.version}));',
  ].join('')], { cwd, env, encoding: 'utf8' });
  const { cookie, aiConsentHeader, version } = JSON.parse(constants);
  const origin = 'http://127.0.0.1:' + port;
  const startedAt = new Date().toISOString();
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd, env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
  const stopped = once(child, 'exit').catch(() => []);

  const observed = [];
  const messages = [];
  let pageKey;
  let seeded = false;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40 && child.exitCode === null && !ready; attempt++) {
      ready = (await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1_000) }).catch(() => null))?.ok === true;
      if (!ready) await delay(250);
    }
    assert.ok(ready, 'The loopback Next.js server became healthy');
    if (dbMode) {
      databaseScript('await prisma.user.create({data:' + JSON.stringify({ id: owner, email, sessionVersion: 0 }) + '});');
      seeded = true;
    }
    for (const [index, text] of ['جهز مسودة لابتوب', 'اعرض مسوداتي', cards ? 'أرني المسودة المختارة.' : 'الأولى', 'خل السعر ٥٠٠'].entries()) {
      messages.push({ id: 'synthetic-turn-' + index, role: 'user', parts: [{ type: 'text', text }] });
      const started = performance.now();
      const response = await fetch(origin + '/api/chat', {
        method: 'POST', headers: { 'content-type': 'application/json', cookie, [aiConsentHeader]: version },
        body: JSON.stringify({ messages, chatOwnerId: owner, chatConversationId: 'synthetic-hamad-http-conversation', creationMethod: 'chat',
          ...(cards && { hamadDraftCards: true }),
          ...(cards && index === 2 && { hamadDraftAction: { type: 'select', page: pageKey, choice: 1 } }) }),
        signal: AbortSignal.timeout(16_000),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/u);
      const data = (await response.text()).split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)));
      const answer = data.filter((entry) => entry.type === 'text-delta').map((entry) => entry.delta).join('');
      const metadata = Object.assign({}, ...data.map((entry) => entry.messageMetadata ?? {}));
      assert.match(String(metadata.hamadDraftMemory), /^h2_[\w-]+\.[\w-]{43}$/u);
      assert.match(answer, index === 0 || index === 3 ? /تم حفظ/u : /لابتوب/u);
      if (cards && index === 1) {
        pageKey = metadata.hamadDraftUi?.page?.key;
        assert.match(String(pageKey), /^[a-f0-9]{64}:0$/u);
        assert.equal(metadata.hamadDraftUi.page.cards[0].title, 'لابتوب');
      }
      if (cards && index >= 2) {
        assert.equal(metadata.hamadDraftUi.active.title, 'لابتوب');
        assert.equal(metadata.hamadDraftUi.preview.title, 'لابتوب');
        if (index === 3) assert.equal(metadata.hamadDraftUi.preview.price, 500);
      }
      messages.push({ id: data.find((entry) => entry.type === 'start').messageId, role: 'assistant', parts: [{ type: 'text', text: answer }], metadata });
      observed.push({ turn: index + 1, status: response.status, elapsedMs: Math.round(performance.now() - started) });
    }
    const read = await fetch(origin + '/api/marketplace/me/listings', { headers: { cookie }, signal: AbortSignal.timeout(4_000) });
    assert.equal(read.status, 200);
    const { listings } = await read.json();
    assert.equal(listings.length, 1);
    assert.equal(listings[0].status, 'draft');
    assert.equal(listings[0].price, 500);
    const receipt = { status: 'PASS', revision: git('rev-parse', 'HEAD'), startedAt, completedAt: new Date().toISOString(),
      mode: dbMode ? 'built Next.js over loopback with synthetic provider and isolated PostgreSQL'
        : 'built Next.js over loopback with synthetic provider and file-store data', cards, observed,
      persisted: { listingCount: listings.length, status: listings[0].status, price: listings[0].price } };
    writeFileSync(resolve(output), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt));
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await stopped;
    if (seeded) {
      databaseScript('await prisma.apiIdempotencyKey.deleteMany({where:{actorKey:' + JSON.stringify(owner) +
        ',namespace:{in:["hamad_structured_write","hamad_structured_draft_lock"]}}});' +
        'await prisma.user.deleteMany({where:{id:' + JSON.stringify(owner) + '}});');
      console.log('Synthetic PostgreSQL fixture removed.');
    }
  }
}
