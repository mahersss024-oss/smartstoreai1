import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { POST } from '@/app/api/chat/route';
import { createSessionCookie } from '@/lib/auth/session';
import { aiConsentHeader, aiSharingConsent } from '@/lib/platform/ai-consent';
import { addListingImageForSeller, createListingDraft, getListing, listSellerListings } from '@/agent/marketplace/store';
import { marketplaceTextAnalyzer } from '@/agent/marketplace/text-understanding';
import { readHamadKnowledge } from '@/lib/chat/hamad-knowledge';
import { hamadCapabilities } from '@/lib/chat/hamad-capabilities';
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
function enable(t: TestContext, plans: Plan[], options: {
  reply?: string; writeAllowed?: boolean; answerAllowed?: boolean; failPlan?: boolean;
  onModelInput?: (role: string, data: Record<string, unknown>) => void | Promise<void>;
} = {}) {
  const saved = process.env.SMARTSTORE_HAMAD_STRUCTURED;
  process.env.SMARTSTORE_HAMAD_STRUCTURED = '1';
  t.after(() => {
    if (saved === undefined) delete process.env.SMARTSTORE_HAMAD_STRUCTURED;
    else process.env.SMARTSTORE_HAMAD_STRUCTURED = saved;
  });
  const roles: string[] = [];
  let index = 0;
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
      content = JSON.stringify(plans[index++] ?? { action: 'clarify', reply: 'وش تقصد؟' });
    } else if (system.includes('[hamad:draft-fields]')) {
      roles.push('draft-fields');
      content = '{"details":{"category":"mobile_phones"},"evidence":{"category":"جوال"}}';
    } else if (system.includes('[hamad:write-check]')) {
      roles.push('write-check');
      content = JSON.stringify({ allow: options.writeAllowed ?? true });
    } else if (system.includes('[hamad:reply]')) {
      roles.push('reply');
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
    if (options.onModelInput && roles.at(-1) !== 'vision' && roles.at(-1) !== 'other') {
      await options.onModelInput(roles.at(-1)!, JSON.parse(String(messages.at(-1)?.content)));
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
  assert.match(bad.parts[0].text, /JPG/u);
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
