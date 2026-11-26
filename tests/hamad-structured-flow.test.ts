import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { POST } from '@/app/api/chat/route';
import { createSessionCookie, getAuthSession } from '@/lib/auth/session';
import { aiConsentHeader, aiSharingConsent } from '@/lib/platform/ai-consent';
import { addListingImageForSeller, createListingDraft, getListing, listSellerListings } from '@/agent/marketplace/store';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { readHamadKnowledge } from '@/lib/chat/hamad-knowledge';
import { hamadCapabilities } from '@/lib/chat/hamad-capabilities';
import { openHamadState, sealHamadState } from '@/lib/chat/hamad-structured-state';
import { getLocalModelReviews } from '@/lib/admin/model-review';
import sharp from 'sharp';
import { textAnalysis } from './helpers/text-understanding';

type Part = { type: 'text'; text: string } | { type: 'file'; mediaType: string; url: string };
type Turn = { id: string; role: 'user' | 'assistant'; parts: Part[]; metadata?: Record<string, unknown> };
type Plan = Record<string, unknown>;
const conversation = 'hamad-structured-acceptance';
const cookies = new Map<string, string>();
function user(id: string, text: string): Turn {
  return { id, role: 'user', parts: [{ type: 'text', text }] };
}
function enable(t: TestContext, plans: (Plan | string | ((instructions: string) => Plan | string))[], options: {
  reply?: string; writeAllowed?: boolean; answerAllowed?: boolean; failPlan?: boolean; failReply?: boolean;
  categoryReplies?: string[];
  draftReplan?: Plan;
  onProviderRequest?: (role: string, responseFormat: unknown) => void;
  onModelInput?: (role: string, data: Record<string, unknown>) => void | Promise<void>;
} = {}) {
  const roles: string[] = [];
  let index = 0;
  let categoryIndex = 0;
  const analysis = textAnalysis({ intent: 'create_listing' });
  t.mock.method(marketplaceTextAnalyzer, 'analyze', async () => analysis);
  t.mock.method(marketplaceTextAnalyzer, 'peek', () => analysis);
  t.mock.method(globalThis, 'fetch', async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const input = JSON.parse(String(init?.body));
    const messages = input.messages as { role: string; content: string | object[] }[];
    const system = messages.filter((item) => item.role === 'system').map((item) => item.content).join('\n');
    let content: string;
    if (system.includes('[hamad:plan]')) {
      roles.push('plan');
      if (options.failPlan) throw new DOMException('fixture timeout', 'AbortError');
      const plan = plans[index++] ?? { action: 'clarify', reply: 'وش تقصد؟' };
      const value = typeof plan === 'function' ? plan(system) : plan;
      content = typeof value === 'string' ? value : JSON.stringify(value);
    } else if (system.includes('[hamad:draft-replan]')) {
      roles.push('draft-replan');
      content = JSON.stringify(options.draftReplan ?? { action: 'clarify' });
    } else if (system.includes('[hamad:draft-fields]')) {
      roles.push('draft-fields');
      content = options.categoryReplies?.[categoryIndex++]
        ?? '{"details":{"category":"mobile_phones"},"evidence":{"category":"جوال"}}';
    } else if (system.includes('[hamad:write-check]')) {
      roles.push('write-check');
      content = JSON.stringify({ allow: options.writeAllowed ?? true });
    } else if (system.includes('[hamad:reply]')) {
      roles.push('reply');
      if (options.failReply) throw new DOMException('fixture timeout', 'AbortError');
      content = options.reply ?? 'تفضل، هذه نتيجة الطلب.';
    } else if (system.includes('[hamad:source-check]')) {
      roles.push('source-check');
      content = JSON.stringify({ allow: options.answerAllowed ?? true });
    } else if (messages.some(({ content }) => Array.isArray(content) && content.some((part) => 'image_url' in part))) {
      roles.push('vision');
      content = '{"decision":"allow","confidence":0.9,"reasons":[],"detected_product":"هاتف ظاهر","sharia_sensitive":false}';
    } else {
      roles.push('other');
      content = '{"decision":"ALLOW","confidence":1,"reason_code":"legacy_fixture","intent":"support"}';
    }
    const role = roles.at(-1)!;
    if (role !== 'vision' && role !== 'other') {
      await options.onModelInput?.(role, JSON.parse(String(messages.at(-1)?.content)));
      options.onProviderRequest?.(role, input.response_format);
    }
    return Response.json({ id: 'synthetic-hamad', object: 'chat.completion', created: 1, model: 'fixture',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
  });
  return roles;
}

async function send(owner: string, messages: Turn[], extra: Record<string, unknown> = {}) {
  if (!cookies.has(owner)) cookies.set(owner, createSessionCookie({ id: owner, email: owner + '@example.test' }));
  const started = performance.now();
  const response = await POST(new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [aiConsentHeader]: aiSharingConsent.version,
      cookie: cookies.get(owner)! },
    body: JSON.stringify({ messages, chatOwnerId: owner, chatConversationId: conversation, creationMethod: 'chat', ...extra }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/u);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let stream = '';
  let firstTextMs: number | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    stream += decoder.decode(value, { stream: true });
    if (firstTextMs === undefined && stream.includes('"type":"text-delta"')) firstTextMs = performance.now() - started;
  }
  stream += decoder.decode();
  if (process.env.SMARTSTORE_HAMAD_FIXTURE_TIMING === '1') {
    console.info(JSON.stringify({ event: 'hamad_fixture_turn', firstTextMs, totalMs: performance.now() - started }));
  }
  const data = stream.split('\n').filter((line) => line.startsWith('data: {')).map((line) => JSON.parse(line.slice(6)));
  return {
    id: data.find((part) => part.type === 'start').messageId as string,
    role: 'assistant' as const,
    parts: [{ type: 'text' as const, text: data.filter((part) => part.type === 'text-delta').map((part) => part.delta).join('') }],
    metadata: Object.assign({}, ...data.map((part) => part.messageMetadata ?? {})),
    files: data.filter((part) => part.type === 'file'),
  };
}

test('lists only the signed-in customer drafts without putting internal IDs in the reply or exposed state', async (t) => {
  const roles = enable(t, [{ action: 'list', reply: 'هذي المسودات المتاحة.' }]);
  const owner = 'hamad-v2-ignore-internal-identifiers';
  const own = createListingDraft({ sellerId: owner, category: 'other', title: 'مكتب خشب لاختبار حمد' });
  createListingDraft({ sellerId: 'unrelated-v2-account', category: 'other', title: 'مسودة حساب آخر' });
  const reply = await send(owner, [user('owned-list', 'أكمل إعلاني السابق')]);
  assert.match(reply.parts[0].text, /مكتب خشب لاختبار حمد/u);
  assert.doesNotMatch(reply.parts[0].text, /مسودة حساب آخر/u);
  assert.ok(!reply.parts[0].text.includes(own.id));
  assert.match(String(reply.metadata.hamadDraftMemory), /^h2_[\w-]+\.[\w-]{43}$/u);
  assert.deepEqual(roles, ['plan']);
  assert.equal(getListing(own.id)?.title, own.title);
});

function draft(owner: string, title: string, date: string, price = 300) {
  const listing = createListingDraft({ sellerId: owner, category: 'other', title, description: 'وصف سابق محفوظ', price });
  listing.updatedAt = date;
  return listing;
}

test('selects the second displayed draft and saves both authorized fields exactly once', async (t) => {
  const change = {
    action: 'update', reference: 'خل السعر ٥٠٠', confirmWrite: true,
    details: { price: 500, description: 'جهاز نظيف' }, evidence: { price: '٥٠٠', description: 'جهاز نظيف' },
  };
  const roles = enable(t, [{ action: 'list' }, { action: 'select', choice: 2, reference: 'الثانية' }, change, change]);
  const owner = 'hamad-v2-two-fields';
  const desktop = draft(owner, 'مسودة الكمبيوتر', '2026-11-20T09:00:00.000Z');
  const phone = draft(owner, 'مسودة الجوال', '2026-11-20T08:00:00.000Z');
  const first = user('view-page', 'أبي أرجع لإعلاني');
  const listed = await send(owner, [first]);
  assert.match(listed.parts[0].text, /1\. مسودة الكمبيوتر[\s\S]*2\. مسودة الجوال/u);
  const choice = user('choose-phone', 'الثانية');
  const selected = await send(owner, [first, listed, choice]);
  assert.match(selected.parts[0].text, /مسودة الجوال/u);
  assert.equal(getListing(phone.id)?.price, 300);
  const edit = user('same-message-retry', 'خل السعر ٥٠٠ والوصف جهاز نظيف');
  const messages = [first, listed, choice, selected, edit];
  await send(owner, messages);
  const savedVersion = getListing(phone.id)?.updatedAt;
  await send(owner, messages);
  assert.equal(getListing(phone.id)?.price, 500);
  assert.equal(getListing(phone.id)?.description, 'جهاز نظيف');
  assert.equal(getListing(phone.id)?.updatedAt, savedVersion);
  assert.equal(getListing(desktop.id)?.price, 300);
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
});

test('paginates drafts and refreshes a selection page after a newer change alters its order', async (t) => {
  enable(t, [{ action: 'list' }, { action: 'next' }, { action: 'select', choice: 1, reference: 'الأولى' }]);
  const owner = 'hamad-v2-reordered';
  const listings = Array.from({ length: 5 }, (_, i) => draft(owner, 'مسودة العينة ' + i, '2026-11-2' + i + 'T08:00:00.000Z'));
  const first = user('get-selection-page', 'أبي المسودات');
  const a = await send(owner, [first]);
  assert.match(a.parts[0].text, /الصفحة التالية/u);
  assert.doesNotMatch(a.parts[0].text, /مسودة العينة 0/u);
  const next = user('page-next', 'التالي');
  const b = await send(owner, [first, a, next]);
  assert.match(b.parts[0].text, /1\. مسودة العينة 0/u);
  listings[0].updatedAt = '2026-11-26T08:00:00.000Z';
  const c = await send(owner, [first, a, next, b, user('stale-select', 'الأولى')]);
  assert.match(c.parts[0].text, /1\. مسودة العينة 0[\s\S]*الصفحة التالية/u);
  assert.doesNotMatch(c.parts[0].text, /هذه نتيجة الطلب/u);
});

test('picking an owned card opens its preview without a model and scopes a compound edit to that draft', async (t) => {
  const change = { action: 'update', confirmWrite: true, reference: 'خل السعر ٥٠٠ وأضف الصورة',
    details: { price: 500 }, evidence: { price: '٥٠٠' }, photos: [1] };
  const roles = enable(t, [{ action: 'list' }, change, change]);
  const owner = 'hamad-v2-tappable-cards';
  const firstDraft = draft(owner, 'مسودة المكتب', '2026-11-20T09:00:00.000Z');
  const secondDraft = draft(owner, 'مسودة الجوال', '2026-11-20T08:00:00.000Z');
  const first = user('open-cards', 'أريد تعديل إعلان سابق');
  const listed = await send(owner, [first], { hamadDraftCards: true });
  const page = listed.metadata.hamadDraftUi.page;
  assert.deepEqual(page.cards.map((card: { title: string }) => card.title), ['مسودة المكتب', 'مسودة الجوال']);
  assert.ok(!JSON.stringify(page).includes(secondDraft.id));
  const choice = user('tap-second', 'أرني المسودة المختارة.');
  const selected = await send(owner, [first, listed, choice], { hamadDraftCards: true,
    hamadDraftAction: { type: 'select', page: page.key, choice: 2 } });
  assert.deepEqual(roles, ['plan']);
  assert.equal(selected.metadata.hamadDraftUi.active.title, 'مسودة الجوال');
  assert.equal(selected.metadata.hamadDraftUi.preview.description, 'وصف سابق محفوظ');
  assert.equal(selected.metadata.hamadDraftUi.preview.price, 300);
  const invalidFile = user('invalid-photo', 'أرفق الملف');
  invalidFile.parts.push({ type: 'file', mediaType: 'video/mp4', url: 'data:video/mp4;base64,AAA=' });
  const validation = await send(owner, [first, listed, choice, selected, invalidFile], { hamadDraftCards: true });
  assert.match(validation.parts[0].text, /أرفق صور المنتج/u);
  assert.equal(validation.metadata.hamadDraftUi.active.title, 'مسودة الجوال');
  assert.deepEqual(roles, ['plan']);
  const png = await sharp({ create: { width: 96, height: 96, channels: 3, background: '#35877c' } }).png().toBuffer();
  const edit = user('update-and-attach', 'خل السعر ٥٠٠ وأضف الصورة');
  edit.parts.push({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') });
  const thread = [first, listed, choice, selected, invalidFile, validation, edit];
  const saved = await send(owner, thread, { hamadDraftCards: true });
  await send(owner, thread, { hamadDraftCards: true });
  assert.equal(saved.metadata.hamadDraftUi.active.title, 'مسودة الجوال');
  assert.equal(getListing(secondDraft.id)?.price, 500);
  assert.equal(getListing(secondDraft.id)?.images.length, 1);
  assert.equal(getListing(secondDraft.id)?.status, 'draft');
  assert.equal(getListing(firstDraft.id)?.price, 300);
  assert.equal(getListing(firstDraft.id)?.images.length, 0);
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
  const reopened = await send(owner, [first, listed, choice, selected, edit, saved,
    user('open-list-again', 'اعرض مسوداتي')], { hamadDraftCards: true, hamadDraftAction: { type: 'list' } });
  assert.equal(reopened.metadata.hamadDraftUi.active, null);
  assert.equal(reopened.metadata.hamadDraftUi.page.cards.length, 2);
});

test('direct card actions page without a model and fail safely on stale or foreign selections', async (t) => {
  const roles = enable(t, [], { failPlan: true });
  const owner = 'hamad-v2-stale-card';
  const records = Array.from({ length: 5 }, (_, i) => draft(owner, 'مسودة بطاقة ' + i, '2026-11-2' + i + 'T08:00:00.000Z'));
  const first = user('open-picker', 'اعرض مسوداتي');
  const a = await send(owner, [first], { hamadDraftCards: true, hamadDraftAction: { type: 'list' } });
  const next = user('next-picker', 'اعرض المسودات التالية.');
  const b = await send(owner, [first, a, next], { hamadDraftCards: true,
    hamadDraftAction: { type: 'next', page: a.metadata.hamadDraftUi.page.key } });
  const shown = b.metadata.hamadDraftUi.page;
  assert.deepEqual(shown.cards.map((card: { title: string }) => card.title), ['مسودة بطاقة 0']);
  records[0].updatedAt = '2026-11-28T08:00:00.000Z';
  const choose = user('tap-stale-picker', 'أرني المسودة المختارة.');
  const action = { hamadDraftCards: true, hamadDraftAction: { type: 'select', page: shown.key, choice: 1 } };
  const stale = await send(owner, [first, a, next, b, choose], action);
  assert.equal(stale.metadata.hamadDraftUi.active, null);
  assert.equal(stale.metadata.hamadDraftUi.page.refreshed, true);
  assert.equal(stale.metadata.hamadDraftUi.page.cards[0].title, 'مسودة بطاقة 0');
  const other = await send('hamad-v2-foreign-card', [first, a, next, b, choose], action);
  assert.equal(other.metadata.hamadDraftUi.active, null);
  assert.equal(other.metadata.hamadDraftUi.page, undefined);
  assert.doesNotMatch(other.parts[0].text, /مسودة بطاقة 0/u);
  assert.deepEqual(roles, []);
});

test('serializes concurrent chat writes with different message IDs for the same draft', { timeout: 10_000 }, async (t) => {
  const entered = Promise.withResolvers<void>();
  const continueFirst = Promise.withResolvers<void>();
  const update = (value: number) => ({
    action: 'update', reference: 'غير السعر إلى ' + value, confirmWrite: true,
    details: { price: value }, evidence: { price: String(value) },
  });
  const calls = enable(t, [{ action: 'list' }, { action: 'select', choice: 1, reference: 'الأولى' }, update(500), update(600)], {
    onModelInput: async (role) => {
      if (role !== 'write-check') return;
      entered.resolve();
      await continueFirst.promise;
    },
  });
  const owner = 'hamad-v2-concurrent-writes';
  const listing = draft(owner, 'مسودة مكتب العمل', '2026-11-20T09:00:00.000Z');
  const start = user('see-owned', 'أبي مسوداتي');
  const shown = await send(owner, [start]);
  const pick = user('choose-paper', 'الأولى');
  const selected = await send(owner, [start, shown, pick]);
  const history = [start, shown, pick, selected];
  const first = send(owner, [...history, user('first-write', 'غير السعر إلى 500')]);
  await entered.promise;
  try {
    const second = await send(owner, [...history, user('parallel-write', 'غير السعر إلى 600')]);
    assert.match(second.parts[0].text, /طلبًا آخر/u);
    assert.equal(getListing(listing.id)?.price, 300);
  } finally {
    continueFirst.resolve();
  }
  await first;
  assert.equal(getListing(listing.id)?.price, 500);
  assert.equal(calls.filter((role) => role === 'write-check').length, 1);
});

test('uses existing SSE file parts for vetted ready thumbnails without sending private URLs or exposing them to the model', async (t) => {
  const roles = enable(t, [{ action: 'list' }], { onModelInput: (_role, data) => {
    assert.doesNotMatch(JSON.stringify(data), /data:image|signed-secret/u);
  } });
  const owner = 'hamad-v2-thumbnails';
  const ready = draft(owner, 'عرض iPhone 15', '2026-11-20T10:00:00.000Z');
  const hidden = draft(owner, 'صورة خاصة', '2026-11-20T09:00:00.000Z');
  const thumbnail = 'data:image/webp;base64,' + (await sharp({ create: { width: 12, height: 12, channels: 3, background: 'purple' } }).webp().toBuffer()).toString('base64');
  for (const [listing, url] of [[ready, thumbnail], [hidden, 'https://private.example.test/listings/thumbnail.webp?sig=signed-secret']] as const) {
    addListingImageForSeller(listing.id, owner, { id: 'photo-' + listing.id, listingId: listing.id, originalUrl: url,
      displayUrl: url, thumbnailUrl: url, isPrimary: true, qualityScore: 95, status: 'approved', enhancements: [] });
  }
  const reply = await send(owner, [user('ready-image-list', 'ورني مسوداتي')]);
  assert.match(reply.parts[0].text, /iPhone 15/u);
  assert.deepEqual(reply.files.map(({ url, mediaType }) => ({ url, mediaType })), [{ url: thumbnail, mediaType: 'image/webp' }]);
  assert.deepEqual(roles, ['plan']);
});

test('one draft must be confirmed before an update; forged or cross-account state cannot supply selection', async (t) => {
  const proposal = { action: 'update', confirmWrite: true, reference: 'خل السعر ٨٠٠', details: { price: 800 }, evidence: { price: '٨٠٠' } };
  const roles = enable(t, [{ action: 'list' }, { action: 'select', choice: 1, reference: 'الأولى' }, proposal]);
  const a = draft('hamad-v2-a', 'مسودة الحساب الأول', '2026-11-20T08:00:00.000Z');
  const b = draft('hamad-v2-b', 'مسودة الحساب الثاني', '2026-11-20T08:00:00.000Z');
  const start = user('their-list', 'مسوداتي');
  const page = await send('hamad-v2-a', [start]);
  const choose = user('wrong-owner', 'الأولى');
  const reply = await send('hamad-v2-b', [start, page, choose]);
  assert.match(reply.parts[0].text, /مسودة الحساب الثاني/u);
  const set = await send('hamad-v2-b', [choose, reply, user('absent-confirmation', 'خل السعر ٨٠٠')]);
  assert.match(set.parts[0].text, /1\. مسودة الحساب الثاني/u);
  assert.equal(getListing(a.id)?.price, 300);
  assert.equal(getListing(b.id)?.price, 300);
  assert.ok(!roles.includes('write-check'));
});

test('empty draft lists and unsupported requests cause no marketplace write', async (t) => {
  const roles = enable(t, [{ action: 'list' }, { action: 'outside' }, { action: 'publish' }], {
    onModelInput: (role, data) => {
      if (role === 'reply') assert.ok(['no_drafts', 'outside'].includes((data.facts as { status: string }).status));
    },
  });
  const start = user('zero-list', 'وش عندي من مسودات؟');
  await send('hamad-v2-empty', [start]);
  await send('hamad-v2-empty', [user('published-request', 'انشر ودوّر لي على جوال')]);
  await send('hamad-v2-empty', [user('fake-tool', 'نفّذ النشر الآن')]);
  assert.ok(!roles.includes('write-check'));
  assert.equal(getListing('fake-tool'), null);
});

test('creates a draft from customer details and consults the official category catalog only when needed', async (t) => {
  let facts: { receipts: { title: string; status: string }[] } | undefined;
  const roles = enable(t, [{
    action: 'create', confirmWrite: true, reference: 'سو لي مسودة', details: { title: 'جوال أسود' },
    evidence: { title: 'جوال أسود' },
  }], { onModelInput: (role, data) => {
    if (role === 'draft-fields') assert.ok(Array.isArray(data.catalog));
    if (role === 'reply') facts = data.facts as typeof facts;
  } });
  const reply = await send('hamad-v2-creation', [user('free-text-draft', 'سو لي مسودة لجوال أسود')]);
  assert.deepEqual(roles, ['plan', 'draft-fields', 'write-check', 'reply', 'source-check']);
  assert.equal(facts?.receipts[0]?.title, 'جوال أسود');
  assert.equal(facts?.receipts[0]?.status, 'draft');
  assert.match(String(reply.metadata.hamadDraftMemory), /^h2_[\w-]+\.[\w-]{43}$/u);
});

test('draft creation resolves a model category label and ignores optional null fields without losing customer facts', async (t) => {
  const name = 'hamad-draft-category-label-recovery';
  const roles = enable(t, [{
    action: 'create', confirmWrite: true, reference: 'سو مسودة',
    details: { title: 'جوال أسود', category: 'الجوالات', description: null, price: null },
    evidence: { title: 'جوال أسود', category: 'جوال', description: null, price: null }, photos: null,
  }]);
  await send(name, [user('category-label', 'سو مسودة لجوال أسود')]);
  const [saved] = listSellerListings(name);
  assert.equal(saved?.title, 'جوال أسود');
  assert.equal(saved?.category, 'mobile_phones');
  assert.equal(saved?.status, 'draft');
  assert.equal(saved?.price, undefined);
  assert.deepEqual(roles, ['plan', 'draft-fields', 'write-check', 'reply', 'source-check']);
});

test('an empty model plan requests a JSON object once more before saving exactly one draft', async (t) => {
  const name = 'hamad-draft-empty-json-recovery';
  const calls: [string, unknown][] = [];
  const roles = enable(t, [' ', {
    action: 'create', confirmWrite: true, reference: 'سو مسودة',
    details: { title: 'جوال أسود', category: 'mobile_phones' },
    evidence: { title: 'جوال أسود', category: 'جوال' },
  }], { onProviderRequest: (role, responseFormat) => { calls.push([role, responseFormat]); } });
  await send(name, [user('empty-plan', 'سو مسودة لجوال أسود')]);
  assert.equal(listSellerListings(name).length, 1);
  assert.deepEqual(roles, ['plan', 'plan', 'write-check', 'reply', 'source-check']);
  for (const [role, responseFormat] of calls) {
    assert.deepEqual(responseFormat, role === 'reply' ? undefined : { type: 'json_object' });
  }
});

test('Hamad repairs a schema-invalid plan before saving one verified draft', async (t) => {
  const owner = 'hamad-repairs-plan-fields';
  const title = 'لابتوب اتش بي';
  const correct = {
    action: 'create', confirmWrite: true, reference: 'جهز مسودة',
    details: { title, category: 'computers', price: 2500 },
    evidence: { title, category: 'لابتوب', price: '٢٥٠٠' },
  };
  const invalid = { ...correct, details: { ...correct.details, price: '٢٥٠٠ ريال', condition: 'بلا ملاحظات' } };
  let retryInstructions = '';
  const roles = enable(t, [invalid, instructions => {
    retryInstructions = instructions;
    return instructions.includes('details.price') ? correct : invalid;
  }], { failReply: true });
  const message = user('invalid-plan-turn', 'جهز مسودة لابتوب اتش بي بـ٢٥٠٠ ريال');
  const reply = await send(owner, [message], { hamadDraftCards: true });
  assert.match(retryInstructions, /details\.condition/u);
  assert.doesNotMatch(retryInstructions, /٢٥٠٠ ريال|بلا ملاحظات/u);
  assert.match(reply.parts[0].text, /حُفظت المسودة/u);
  const drafts = listSellerListings(owner);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].price, 2500);
  assert.equal(drafts[0].status, 'draft');
  assert.equal(drafts[0].condition, undefined);
  assert.equal(roles.filter(role => role === 'write-check').length, 1);
});

test('two schema-invalid plans log only known paths and never start a draft write', async (t) => {
  const owner = 'hamad-rejects-invalid-plan-fields';
  const marker = 'synthetic-private-data';
  const invalid = { action: 'create', confirmWrite: 'yes', details: { title: marker }, evidence: { [marker]: 2500 } };
  const logs: string[] = [];
  t.mock.method(console, 'warn', (line: string) => { logs.push(line); });
  const roles = enable(t, [invalid, invalid]);
  const reply = await send(owner, [user('unusable-plan-turn', 'جهز مسودة مكتب')]);
  assert.match(reply.parts[0].text, /تعذر إكمال رد المساعد الآن/u);
  assert.deepEqual(roles, ['plan', 'plan']);
  assert.equal(listSellerListings(owner).length, 0);
  const event = logs.find(line => line.includes('hamad_model_failure'));
  assert.ok(event);
  assert.doesNotMatch(event, /synthetic-private-data/u);
  assert.deepEqual(JSON.parse(event).issues, ['evidence (invalid_type)', 'confirmWrite (invalid_type)']);
});

test('an unverified category preserves intake and never saves a guessed category', async (t) => {
  const name = 'hamad-draft-category-unverified';
  const roles = enable(t, [{
    action: 'create', confirmWrite: true, reference: 'سو مسودة',
    details: { title: 'جوال أسود' }, evidence: { title: 'جوال أسود' },
  }], { categoryReplies: [' ', '{"details":{"category":"guessed"}}'] });
  const reply = await send(name, [user('category-unverified', 'سو مسودة لجوال أسود')]);
  assert.match(reply.parts[0].text, /تصنيف المنتج/u);
  assert.equal(listSellerListings(name).length, 0);
  assert.deepEqual(roles, ['plan', 'draft-fields', 'draft-fields']);
  assert.match(String(reply.metadata.hamadDraftMemory), /^h2_[\w-]+\.[\w-]{43}$/u);
});

test('resumes an active draft intake without importing a price from an older unrelated request', async (t) => {
  const correct = {
    action: 'create', confirmWrite: true, reference: 'أسود ونظيف',
    details: { title: 'جوال', description: 'أسود ونظيف', category: 'mobile_phones' },
    evidence: { title: 'جوال', description: 'أسود ونظيف', category: 'جوال' },
  };
  const roles = enable(t, [{ action: 'create' }, {
    ...correct, details: { ...correct.details, price: 990 }, evidence: { ...correct.evidence, price: '٩٩٠' },
  }, correct]);
  const owner = 'hamad-v2-creation-anchor';
  const old = user('another-product-old', 'كنت أبيع لابتوب بـ٩٩٠');
  const start = user('this-product', 'أريد تجهيز مسودة جوال');
  const intake = await send(owner, [old, start]);
  const next = user('missing-proof', 'أسود ونظيف');
  const clarification = await send(owner, [old, start, intake, next]);
  assert.equal(listSellerListings(owner).length, 0);
  await send(owner, [old, start, intake, next, clarification, user('proper-proof', 'أسود ونظيف')]);
  assert.equal(listSellerListings(owner).length, 1);
  assert.equal(listSellerListings(owner)[0]?.title, 'جوال');
  assert.equal(listSellerListings(owner)[0]?.price, undefined);
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
});

test('keeps the first product details when a seller corrects a spoken price', async (t) => {
  const owner = 'hamad-clarifies-spoken-price';
  const details = { title: 'جوال أسود', category: 'mobile_phones', price: 500 };
  const evidence = { title: 'جوال أسود', category: 'جوال', price: 'خمس مية' };
  const roles = enable(t, [
    { action: 'create', confirmWrite: true, reference: 'أبي مسودة', details, evidence },
    { action: 'create', confirmWrite: true, reference: '٥٠٠', details, evidence: { ...evidence, price: '٥٠٠' } },
  ], { failReply: true });
  const first = user('spoken-price', 'أبي مسودة إعلان لجوال أسود بخمس مية');
  const clarification = await send(owner, [first]);
  assert.match(clarification.parts[0].text, /السعر بالأرقام/u);
  assert.equal(listSellerListings(owner).length, 0);

  await send(owner, [first, clarification, user('corrected-price', '٥٠٠')]);
  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.title, 'جوال أسود');
  assert.equal(listings[0]?.price, 500);
  assert.equal(listings[0]?.status, 'draft');
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
});

test('keeps details supplied before the Hamad creation choice when a field needs clarification', async (t) => {
  const owner = 'hamad-clarifies-after-choosing';
  const details = { title: 'مكتب خشبي', category: 'other', price: 300 };
  const evidence = { title: 'مكتب خشبي', category: 'مكتب خشبي', price: 'ثلاث مية' };
  const choice = 'أختار الإنشاء مع حمد.';
  enable(t, [
    { action: 'create', confirmWrite: true, reference: choice, details, evidence },
    { action: 'create', confirmWrite: true, reference: '٣٠٠', details, evidence: { ...evidence, price: '٣٠٠' } },
  ]);
  const first = user('choose-with-details', 'سو مسودة مكتب خشبي بثلاث مية');
  const selected = user('choose-hamad-method', choice);
  const clarification = await send(owner, [first, selected], { beginDraftWithHamad: true });
  assert.equal(listSellerListings(owner).length, 0);

  await send(owner, [first, selected, clarification, user('choose-clarified-price', '٣٠٠')]);
  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0]?.title, 'مكتب خشبي');
  assert.equal(listings[0]?.price, 300);
});

test('retains the chosen draft intake across clarification turns and saves the confirmed laptop details', async (t) => {
  const owner = 'hamad-draft-choice-clarification';
  const product = 'لابتوب اتش بي';
  const price = 'السعر ٢٥٠٠';
  const notes = 'لاتوجد به ملاحظات';
  const collecting: boolean[] = [];
  const roles = enable(t, [
    { action: 'clarify', reply: 'كم السعر المطلوب؟' },
    { action: 'clarify', reply: 'هل عندك ملاحظات عن الجهاز؟' },
    { action: 'create', confirmWrite: true, reference: notes,
      details: { title: product, category: 'computers', price: 2500, defects: notes },
      evidence: { title: product, category: 'لابتوب', price: '٢٥٠٠', defects: notes } },
  ], {
    onModelInput(role, data) {
      if (role === 'plan') collecting.push((data.conversation as { collecting: boolean }).collecting);
    },
  });
  const first = user('laptop', product);
  const selected = user('choose-hamad', 'أختار الإنشاء مع حمد.');
  const clarification = await send(owner, [first, selected], { beginDraftWithHamad: true });
  const askingPrice = user('laptop-price', price);
  const followUp = await send(owner, [first, selected, clarification, askingPrice]);
  await send(owner, [first, selected, clarification, askingPrice, followUp, user('laptop-notes', notes)]);

  assert.deepEqual(collecting, [true, true, true]);
  assert.equal(roles.filter(role => role === 'write-check').length, 1);
  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].title, product);
  assert.equal(listings[0].price, 2500);
  assert.equal(listings[0].status, 'draft');
});

test('an empty draft picker preserves the intake for the customer’s confirmation', async (t) => {
  const owner = 'hamad-continues-intake-after-empty-picker';
  const product = 'لابتوب اتش بي';
  const confirmation = 'ايوه';
  const collecting: boolean[] = [];
  const roles = enable(t, [
    { action: 'clarify', details: { title: product, category: 'computers', price: 2500 },
      evidence: { title: product, category: 'لابتوب', price: '٢٥٠٠' } },
    { action: 'create', confirmWrite: true, reference: confirmation },
  ], {
    failReply: true,
    onModelInput(role, data) {
      if (role === 'plan') collecting.push((data.conversation as { collecting: boolean }).collecting);
    },
  });
  const request = user('product', product + ' السعر ٢٥٠٠');
  const choice = user('choose', 'أختار الإنشاء مع حمد.');
  const intake = await send(owner, [request, choice], { beginDraftWithHamad: true });
  const picker = user('picker', 'عندي مسودات');
  const empty = await send(owner, [request, choice, intake, picker], {
    hamadDraftCards: true, hamadDraftAction: { type: 'list' },
  });
  assert.match(empty.parts[0].text, /ما عندك مسودات/u);
  assert.equal(listSellerListings(owner).length, 0);
  const reply = await send(owner, [picker, empty, user('continue', confirmation)], { hamadDraftCards: true });
  const drafts = listSellerListings(owner);
  assert.deepEqual(collecting, [true, true]);
  assert.equal(roles.filter(role => role === 'write-check').length, 1);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, product);
  assert.equal(drafts[0].price, 2500);
  assert.equal(drafts[0].status, 'draft');
  assert.match(reply.parts[0].text, /حُفظت المسودة/u);
});

test('remembers the product and corrected price after their turns leave the chat history', async (t) => {
  const owner = 'hamad-long-draft-intake';
  const product = 'لابتوب HP';
  const initialPrice = 'السعر ٢٥٠٠';
  const correctedPrice = 'خل السعر ٢٣٠٠';
  const notes = 'لا توجد ملاحظات';
  let checkedWrite = false;
  enable(t, [
    { action: 'clarify', details: { title: product, category: 'computers' },
      evidence: { title: product, category: product } },
    { action: 'clarify', details: { price: 2500 }, evidence: { price: '٢٥٠٠' } },
    { action: 'clarify', details: { price: 2300 }, evidence: { price: '٢٣٠٠' } },
    ...Array.from({ length: 5 }, () => ({ action: 'clarify' })),
    { action: 'create', confirmWrite: true, reference: notes, details: { price: 2500, defects: notes },
      evidence: { price: '٢٥٠٠', defects: notes } },
  ], {
    onModelInput(role, data) {
      if (data.request !== notes) return;
      if (role === 'plan') {
        assert.equal((data.conversation as { collecting: boolean }).collecting, true);
        assert.doesNotMatch(JSON.stringify(data.history), /٢٥٠٠|٢٣٠٠|لابتوب HP/u);
        assert.match(JSON.stringify(data.rememberedDraft), /٢٣٠٠/u);
      }
      if (role === 'write-check') {
        assert.deepEqual(data.proposedDetails, { title: product, category: 'computers', price: 2300, defects: notes });
        assert.deepEqual((data.customerFieldSources as { field: string; text: string }[]).find(({ field }) => field === 'price'),
          { field: 'price', quote: '٢٣٠٠', text: correctedPrice });
        checkedWrite = true;
      }
    },
  });
  const messages: Turn[] = [user('remember-product', product), user('remember-choice', 'أختار الإنشاء مع حمد.')];
  messages.push(await send(owner, messages, { beginDraftWithHamad: true }));
  for (const [index, text] of [initialPrice, correctedPrice, 'طيب', 'تمام', 'أكمل', 'وش بعد؟', 'لحظة'].entries()) {
    messages.push(user('intake-turn-' + index, text));
    messages.push(await send(owner, messages));
  }
  messages.push(user('intake-notes', notes));
  await send(owner, messages.slice(-8));

  assert.equal(checkedWrite, true);
  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].title, product);
  assert.equal(listings[0].price, 2300);
  assert.equal(listings[0].status, 'draft');
});

test('a separate draft starts without the previous product or price', async (t) => {
  const owner = 'hamad-separate-draft-intake';
  const laptop = 'لابتوب HP بسعر ٢٥٠٠';
  const nextProduct = 'سماعات لاسلكية';
  const next = 'ابدأ مسودة ثانية لسماعات لاسلكية';
  enable(t, [
    { action: 'clarify', details: { title: 'لابتوب HP', category: 'computers', price: 2500 },
      evidence: { title: 'لابتوب HP', category: 'لابتوب', price: '٢٥٠٠' } },
    { action: 'create', newDraft: next, confirmWrite: true, reference: next,
      details: { title: nextProduct, category: 'tv_audio' }, evidence: { title: nextProduct, category: 'سماعات' } },
  ], {
    onModelInput(role, data) {
      if (data.request !== next) return;
      if (role === 'plan') assert.match(JSON.stringify(data.rememberedDraft), /٢٥٠٠/u);
      if (role === 'write-check') {
        assert.equal(data.collecting, false);
        assert.doesNotMatch(JSON.stringify(data), /٢٥٠٠|لابتوب/u);
      }
    },
  });
  const first = [user('separate-laptop', laptop), user('separate-choice', 'أختار الإنشاء مع حمد.')];
  const followUp = await send(owner, first, { beginDraftWithHamad: true });
  await send(owner, [...first, followUp, user('separate-speakers', next)]);

  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].title, nextProduct);
  assert.equal(listings[0].price, undefined);
});

test('selecting a saved draft clears intake facts and scopes the following edit to that card', async (t) => {
  const owner = 'hamad-pick-draft-while-collecting';
  const laptop = 'لابتوب HP بسعر ٢٥٠٠';
  const edit = 'خل السعر ٨٠٠';
  const firstDraft = draft(owner, 'مسودة المكتب', '2026-11-20T09:00:00.000Z', 350);
  const selectedDraft = draft(owner, 'مسودة الجوال', '2026-11-20T08:00:00.000Z', 450);
  const roles = enable(t, [
    { action: 'clarify', details: { title: 'لابتوب HP', category: 'computers', price: 2500 },
      evidence: { title: 'لابتوب HP', category: 'لابتوب', price: '٢٥٠٠' } },
    { action: 'update', confirmWrite: true, reference: edit, details: { price: 800 }, evidence: { price: '٨٠٠' } },
  ], {
    onModelInput(role, data) {
      if (role === 'plan' && data.request === edit) {
        assert.equal(data.rememberedDraft, undefined);
        assert.equal((data.conversation as { selectedDraftTitle: string }).selectedDraftTitle, selectedDraft.title);
      }
      if (role === 'write-check') assert.deepEqual(data.proposedDetails, { price: 800 });
    },
  });
  const messages: Turn[] = [user('intake-laptop', laptop), user('intake-choice', 'أختار الإنشاء مع حمد.')];
  messages.push(await send(owner, messages, { beginDraftWithHamad: true, hamadDraftCards: true }));
  const session = getAuthSession(new Request('http://localhost/api/chat', { headers: { cookie: cookies.get(owner)! } }))!;
  const intake = openHamadState(messages.at(-1)?.metadata?.hamadDraftMemory, session, conversation);
  assert.equal(intake.intake?.find(({ field }) => field === 'price')?.value, 2500);

  messages.push(user('open-existing-picker', 'اعرض مسوداتي'));
  const listed = await send(owner, messages, { hamadDraftCards: true, hamadDraftAction: { type: 'list' } });
  messages.push(listed, user('tap-existing-second', 'أرني المسودة المختارة.'));
  const selected = await send(owner, messages, { hamadDraftCards: true,
    hamadDraftAction: { type: 'select', page: listed.metadata.hamadDraftUi.page.key, choice: 2 } });
  assert.equal(selected.metadata.hamadDraftUi.preview.price, 450);
  assert.deepEqual(roles, ['plan', 'draft-replan']);
  messages.push(selected, user('edit-existing-price', edit));
  await send(owner, messages, { hamadDraftCards: true });

  assert.equal(listSellerListings(owner).length, 2);
  assert.equal(getListing(firstDraft.id)?.price, 350);
  assert.equal(getListing(selectedDraft.id)?.price, 800);
});

test('the bounded intake token preserves essential facts and stays bound to its owner and conversation', () => {
  const sessionFor = (id: string) => getAuthSession(new Request('http://localhost/api/chat', {
    headers: { cookie: createSessionCookie({ id, email: id + '@example.test' }) },
  }))!;
  const owner = sessionFor('hamad-intake-token-owner');
  const bulkyNote = 'تفاصيل إضافية '.repeat(70);
  const token = sealHamadState({
    collecting: 'first-message',
    intake: [
      { field: 'description', value: bulkyNote, quote: bulkyNote.slice(0, 400), source: bulkyNote },
      { field: 'title', value: 'لابتوب HP', quote: 'لابتوب HP' },
      { field: 'price', value: 2300, quote: '٢٣٠٠', source: 'خل السعر ٢٣٠٠' },
    ],
  }, owner, conversation);

  assert.ok(token && token.length <= 2_400);
  assert.deepEqual(openHamadState(token, owner, conversation).intake?.map(({ field, value }) => [field, value]), [
    ['title', 'لابتوب HP'], ['price', 2300],
  ]);
  assert.deepEqual(openHamadState(token, sessionFor('hamad-intake-token-other'), conversation), {});
  assert.deepEqual(openHamadState(token, owner, 'another-hamad-conversation'), {});
});

test('preserves the existing choice contract and denies a mutation rejected by the independent check', async (t) => {
  const create = {
    action: 'create', confirmWrite: true, reference: 'سو إعلان', details: { title: 'مكتب صغير', category: 'other' },
    evidence: { title: 'مكتب صغير', category: 'مكتب صغير' },
  };
  const owner = 'hamad-v2-permission';
  const roles = enable(t, [create, create], { writeAllowed: false });
  const choice = await send(owner, [user('mode', 'سو إعلان لمكتب صغير')], { creationMethod: undefined });
  assert.equal(choice.metadata.creationChoice, true);
  const declined = await send(owner, [user('denied-create', 'سو إعلان لمكتب صغير')]);
  assert.equal(declined.metadata.creationChoice, undefined);
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
  assert.equal(listSellerListings(owner).length, 0);
});

test('choosing Hamad carries the preceding description and exact photo source into the saved draft', async (t) => {
  const selection = 'أختار الإنشاء مع حمد.';
  const description = 'جهز مسودة مكتب خشبي بسعر ٣٠٠';
  const roles = enable(t, [{
    action: 'create', confirmWrite: true, reference: selection, details: { title: 'مكتب خشبي', category: 'other', price: 300 },
    evidence: { title: 'مكتب خشبي', category: 'مكتب خشبي', price: '٣٠٠' }, photos: [1],
  }], {
    onModelInput: (role, data) => {
      if (role === 'plan') assert.equal(data.hasImages, true);
    },
  });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'steelblue' } }).png().toBuffer();
  const original = user('creation-entry-photo', description);
  original.parts.push({ type: 'text', text: 'Earlier image attachment reference: creation-entry-photo' });
  const owner = 'hamad-choice-entry-active';
  await send(owner, [original, user('choose-hamad-entry', selection)], {
    beginDraftWithHamad: true,
    retainedListingImageMessageId: 'creation-entry-photo',
    retainedListingImages: [{ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') }],
  });
  const [saved] = listSellerListings(owner);
  assert.equal(saved?.title, 'مكتب خشبي');
  assert.equal(saved?.price, 300);
  assert.equal(saved?.images.length, 1);
  assert.equal(saved?.status, 'draft');
  assert.ok(roles.includes('write-check'));
});

test('a provider failure after draft save reports it and replay cannot duplicate the draft', async (t) => {
  const plan = { action: 'create', details: { category: 'other', title: 'مكتب' },
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true };
  const roles = enable(t, [plan, plan], { failReply: true });
  const owner = 'hamad-adopt-replay';
  const message = user('creation-replay', 'جهز مسودة مكتب');
  for (let i = 0; i < 2; i++) {
    const reply = await send(owner, [message]);
    assert.match(reply.parts[0].text, /حُفظت المسودة/u);
    assert.match(reply.parts[0].text, /\/account\/listings/u);
  }
  assert.equal(listSellerListings(owner).length, 1);
  assert.equal(roles.filter((role) => role === 'write-check').length, 1);
});

test('the receipt uses saved draft facts even when the model falsely claims publication', async (t) => {
  enable(t, [{ action: 'create', details: { category: 'other', title: 'مكتب' },
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true }],
  { reply: 'تم نشر إعلانك فورًا.', answerAllowed: false });
  const owner = 'hamad-adopt-false-publication';
  const reply = await send(owner, [user('false-publication', 'جهز مسودة مكتب')]);
  assert.match(reply.parts[0].text, /حُفظت المسودة/u);
  assert.doesNotMatch(reply.parts[0].text, /تم نشر/u);
  assert.equal(listSellerListings(owner)[0]?.status, 'draft');
});

test('a made-up save reply cannot confirm an operation when no draft tool was called', async (t) => {
  enable(t, [{ action: 'clarify' }], { reply: 'حفظت مسودة جديدة.', answerAllowed: false });
  const owner = 'hamad-adopt-fake-save';
  const reply = await send(owner, [user('false-save', 'عندي استفسار')], { creationMethod: undefined });
  assert.match(reply.parts[0].text, /تعذّر التحقق/u);
  assert.doesNotMatch(reply.parts[0].text, /حفظت مسودة/u);
  assert.equal(listSellerListings(owner).length, 0);
});

const hpDraftRequest = 'يا حمد، احفظ لي مسودة إعلان عن لابتوب HP 15 أسود، مستعمل ونظيف، في الرياض، بسعر ٢٥٠٠ ريال';
const hpDraftPlan = {
  action: 'create', confirmWrite: true, reference: 'احفظ لي مسودة إعلان',
  details: { title: 'لابتوب HP 15 أسود', category: 'computers', price: 2500, city: 'الرياض', condition: 'used' },
  evidence: { title: 'لابتوب HP 15 أسود', category: 'لابتوب', price: '٢٥٠٠', city: 'الرياض', condition: 'مستعمل' },
};
const misleadingPhotoQuestion = { action: 'clarify', reply: 'حفظت تفاصيل المسودة. تحب أضيف الصور؟' };

test('rechecks a clarification and saves a complete HP draft without optional photos', async (t) => {
  const owner = 'hamad-recheck-complete-draft';
  const roles = enable(t, [misleadingPhotoQuestion], { draftReplan: hpDraftPlan, failReply: true });
  const reply = await send(owner, [user('hp-complete-no-photos', hpDraftRequest)], { hamadDraftCards: true });
  const listings = listSellerListings(owner);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].title, hpDraftPlan.details.title);
  assert.equal(listings[0].price, 2500);
  assert.equal(listings[0].status, 'draft');
  assert.equal(listings[0].images.length, 0);
  assert.equal(reply.metadata.hamadDraftUi.preview.title, hpDraftPlan.details.title);
  assert.match(reply.parts[0].text, /حُفظت المسودة/u);
  assert.deepEqual(roles, ['plan', 'draft-replan', 'write-check', 'reply']);
});

test('a draft clarification reports that nothing was saved even if the model suggests a false confirmation', async (t) => {
  const owner = 'hamad-recheck-ambiguous-draft';
  const roles = enable(t, [misleadingPhotoQuestion], { reply: misleadingPhotoQuestion.reply, answerAllowed: true });
  const reply = await send(owner, [user('hp-still-ambiguous', hpDraftRequest)]);
  assert.match(reply.parts[0].text, /ما حُفظت المسودة بعد/u);
  assert.doesNotMatch(reply.parts[0].text, /حفظت تفاصيل المسودة|الصور/u);
  assert.equal(listSellerListings(owner).length, 0);
  assert.deepEqual(roles, ['plan', 'draft-replan']);
});

test('a recovered creation proposal still requires the independent write check', async (t) => {
  const owner = 'hamad-recheck-draft-denied';
  const roles = enable(t, [misleadingPhotoQuestion], { draftReplan: hpDraftPlan, writeAllowed: false });
  const reply = await send(owner, [user('hp-write-check-denied', hpDraftRequest)]);
  assert.match(reply.parts[0].text, /ما حُفظت المسودة بعد/u);
  assert.equal(listSellerListings(owner).length, 0);
  assert.deepEqual(roles, ['plan', 'draft-replan', 'write-check']);
});

test('the receipt reports a partial image save even when the model says all photos were attached', async (t) => {
  enable(t, [{ action: 'create', details: { category: 'other', title: 'مكتب' }, photos: [1, 2],
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true }],
  { reply: 'أرفقت جميع الصور بالمسودة.' });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'orange' } }).png().toBuffer();
  const turn = user('partial-photo-save', 'جهز مسودة مكتب مع الصورتين');
  turn.parts.push({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') },
    { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,AQID' });
  const owner = 'hamad-adopt-partial-photos';
  const reply = await send(owner, [turn]);
  assert.match(reply.parts[0].text, /حُفظت 1 من أصل 2 صورة/u);
  assert.doesNotMatch(reply.parts[0].text, /أرفقت جميع الصور/u);
  assert.equal(listSellerListings(owner)[0]?.images.length, 1);
});

test('reports that sent photos are missing when a creation plan omits their selection', async (t) => {
  enable(t, [{
    action: 'create', details: { category: 'other', title: 'مكتب' },
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true,
  }], { reply: 'حُفظت المسودة.' });
  const owner = 'hamad-draft-missing-selection';
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'orange' } }).png().toBuffer();
  const turn = user('missing-photo-selection', 'جهز مسودة مكتب مع الصورتين');
  const photo = { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') };
  turn.parts.push(photo, photo);

  const reply = await send(owner, [turn], { hamadDraftCards: true });
  assert.match(reply.parts[0].text, /حُفظت المسودة/u);
  assert.match(reply.parts[0].text, /لم تُرفق الصور/u);
  assert.equal(listSellerListings(owner).length, 1);
  assert.equal(listSellerListings(owner)[0]?.images.length, 0);
  assert.equal((reply.metadata.hamadDraftUi as { preview?: { imageCount: number } }).preview?.imageCount, 0);
});

test('reports an omitted earlier attachment only for the current draft intake', async (t) => {
  const plan = {
    action: 'create', details: { category: 'other', title: 'مكتب' },
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true,
  };
  enable(t, [{ action: 'create' }, plan, plan], { reply: 'حُفظت المسودة.' });
  const owner = 'hamad-draft-missing-retained-selection';
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'orange' } }).png().toBuffer();
  const first = user('pending-draft-photo', 'أبي أجهز مسودة بهالصورة');
  first.parts.push({ type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') });
  const intake = await send(owner, [first]);
  const resumed = user('finish-pending-draft', 'جهز مسودة مكتب');
  const saved = await send(owner, [first, intake, resumed]);
  assert.match(saved.parts[0].text, /لم تُرفق الصور/u);

  const separate = await send(owner, [first, intake, resumed, saved, user('separate-draft-request', 'جهز مسودة مكتب ثاني')]);
  assert.doesNotMatch(separate.parts[0].text, /لم تُرفق الصور/u);
  assert.equal(listSellerListings(owner).length, 2);
});

test('Hamad records advisory message reviews without making a moderation decision on the draft', async (t) => {
  enable(t, [{ action: 'create', details: { category: 'other', title: 'مكتب' },
    evidence: { category: 'مكتب', title: 'مكتب' }, reference: 'جهز مسودة', confirmWrite: true,
    advisory: { decision: 'block', reasons: ['review_fixture'] } }]);
  const owner = 'hamad-adopt-advisory';
  await send(owner, [user('advisory-request', 'جهز مسودة مكتب')]);
  assert.equal(listSellerListings(owner)[0]?.status, 'draft');
  assert.ok(getLocalModelReviews().some((review) =>
    review.subject === 'message' && review.userId === owner && review.assessment.decision === 'block'));
});

test('retrieves versioned policies only for help and rejects unapproved links', async (t) => {
  const source = readHamadKnowledge('commissions');
  assert.equal(source.source_id, 'platform:commissions');
  assert.equal(source.access_level, 'public');
  assert.match(source.version, /^[a-f0-9]{64}$/u);
  const roles = enable(t, [{ action: 'help', topics: ['commissions'] }, { action: 'help' }], {
    reply: 'تفضل [هذه صفحة](/admin).',
    onModelInput: (role, data) => {
      if (role === 'reply') assert.ok(Array.isArray((data.facts as { sources: unknown }).sources));
    },
  });
  const official = await send('hamad-v2-help', [user('commission', 'كيف تكون العمولة؟')]);
  assert.doesNotMatch(official.parts[0].text, /\/admin/u);
  const unknown = await send('hamad-v2-help', [user('unknown-policy', 'كم سعر الاشتراك في خدمة غير موجودة؟')]);
  assert.match(unknown.parts[0].text, /معلومة موثقة/u);
  assert.deepEqual(roles, ['plan', 'reply', 'plan', 'reply']);
});

test('runs vision for validated photos only and keeps the observation tentative', async (t) => {
  const roles = enable(t, [{ action: 'inspect', photos: [1, 2] }], {
    onModelInput: (role, data) => {
      if (role === 'reply') {
        const observations = (data.facts as { tentativeObservations: Array<{ tentative: boolean }> }).tentativeObservations;
        assert.ok(observations?.every(({ tentative }) => tentative));
        assert.equal(observations.length, 2);
      }
    },
  });
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#a64b76' } }).png().toBuffer();
  const image = { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,' + png.toString('base64') };
  const bad = await send('hamad-v2-images', [{ id: 'broken', role: 'user', parts: [{ ...image, mediaType: 'video/mp4' }] }]);
  assert.match(bad.parts[0].text, /جي بي جي أو بي إن جي أو ويب بي/u);
  assert.equal(roles.length, 0);
  await send('hamad-v2-images', [{ id: 'inspect-two', role: 'user', parts: [{ type: 'text', text: 'وش ظاهر في الصورتين؟' }, image, image] }]);
  assert.ok(roles.includes('vision'));
  assert.ok(!roles.includes('write-check'));
});

test('provides a safe response on model timeout and limits its registry to authorized contracts', async (t) => {
  const roles = enable(t, [], { failPlan: true });
  const reply = await send('hamad-v2-timeout', [user('timeouts', 'تقدر تجهز إعلان؟')]);
  assert.match(reply.parts[0].text, /تعذر|تعذّر/u);
  assert.deepEqual(roles, ['plan']);
  assert.deepEqual(Object.values(hamadCapabilities).filter(({ sideEffect }) => sideEffect === 'draft-write').map(({ name }) => name),
    ['create_draft', 'update_draft', 'attach_draft_images']);
  assert.equal(hamadCapabilities.list_my_drafts.input.safeParse({ offset: 0, sellerId: 'another-owner' }).success, false);
});
