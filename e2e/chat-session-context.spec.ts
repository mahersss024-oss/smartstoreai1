import { expect, type Page, test } from '@playwright/test';

function reply(text: string, id: string) {
  return [
    { type: 'start', messageId: id },
    { type: 'text-start', id },
    { type: 'text-delta', id, delta: text },
    { type: 'text-end', id },
    { type: 'finish', finishReason: 'stop' },
  ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

async function prepare(page: Page) {
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
  await page.route('**/api/marketplace/listings**', route => route.fulfill({ json: {
    listings: [], pagination: { page: 1, limit: 24, hasMore: false },
  } }));
}

async function openChat(page: Page) {
  const input = page.getByPlaceholder(/اكتب طلبك/);
  const launcher = page.getByRole('button', { name: 'فتح حمد', exact: true });
  await expect.poll(async () => await input.isVisible() || await launcher.isVisible()).toBe(true);
  if (!(await input.isVisible())) await launcher.click();
  await expect(input).toBeVisible();
  return input;
}

async function navigate(page: Page, href: string, name: string) {
  const close = page.getByRole('button', { name: 'العودة للإعلانات', exact: true });
  if (await close.isVisible()) await close.click();
  const link = page.locator(`a[href="${href}"]:visible`).first();
  if (await link.count()) await link.click();
  else await page.getByRole('button', { name, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${href === '/' ? '\\/' : href}$`));
}

test('logout clears private assistant history even when returning to home without reloading', async ({ page }) => {
  await prepare(page);
  let signedIn = true;
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: signedIn, user: signedIn ? { id: 'private-chat-owner', email: 'private-chat@example.test', name: 'عميل' } : null,
  } }));
  await page.route('**/api/auth/logout', async route => {
    signedIn = false;
    await route.fulfill({ json: { status: 'signed_out' } });
  });
  await page.route('**/api/chat', async route => {
    expect(route.request().postDataJSON().chatOwnerId).toBe('private-chat-owner');
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: reply('رد خاص بصاحب الحساب', 'private-reply') });
  });
  await page.goto('/?chat=1');
  const input = await openChat(page);
  await input.fill('طلب شخصي لا يظهر بعد الخروج');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.locator('body')).toContainText('رد خاص بصاحب الحساب');
  await navigate(page, '/account', 'حسابي');
  await page.getByRole('button', { name: 'خروج', exact: true }).click();
  await expect(page.getByRole('button', { name: 'خروج', exact: true })).toHaveCount(0);
  await navigate(page, '/', 'الرئيسية');
  await openChat(page);
  await expect(page.locator('body')).not.toContainText('رد خاص بصاحب الحساب');
  await expect(page.locator('body')).not.toContainText('طلب شخصي لا يظهر بعد الخروج');
});

for (const transport of ['channel', 'storage'] as const) {
  test(`logout in another tab clears the open chat through ${transport} session synchronization`, async ({ page, context }) => {
    let signedIn = true;
    await context.addInitScript((method) => {
      if (method === 'storage') Object.defineProperty(window, 'BroadcastChannel', { value: undefined });
      else {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key !== 'smartstore:auth-session-changed') original.call(this, key, value);
        };
      }
    }, transport);
    await context.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: signedIn, user: signedIn ? { id: 'shared-tab-owner', email: 'shared@example.test', name: 'عميل' } : null,
    } }));
    await context.route('**/api/auth/logout', async route => {
      signedIn = false;
      await route.fulfill({ json: { status: 'signed_out' } });
    });
    await prepare(page);
    await page.route('**/api/chat', route => route.fulfill({ headers: {
      'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1',
    }, body: reply('محادثة خاصة يجب مسحها في جميع التبويبات', 'cross-tab-private') }));
    await page.goto('/?chat=1');
    await (await openChat(page)).fill('طلب خاص قبل الخروج');
    await page.getByRole('button', { name: 'إرسال', exact: true }).click();
    await expect(page.getByText('محادثة خاصة يجب مسحها في جميع التبويبات', { exact: true })).toBeVisible();
    const otherTab = await context.newPage();
    try {
      await prepare(otherTab);
      await otherTab.goto('/account');
      await otherTab.getByRole('button', { name: 'خروج', exact: true }).click();
      await expect(page.locator('body')).not.toContainText('محادثة خاصة يجب مسحها في جميع التبويبات');
      await expect(page.locator('body')).not.toContainText('طلب خاص قبل الخروج');
      signedIn = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(await openChat(page)).toBeEnabled();
      await expect(page.locator('body')).not.toContainText('محادثة خاصة يجب مسحها في جميع التبويبات');
      await expect(page.locator('body')).not.toContainText('طلب خاص قبل الخروج');
    } finally {
      await otherTab.close();
    }
  });
}

test('returning to a tab verifies an externally switched account without retaining private history', async ({ page }) => {
  await prepare(page);
  let owner = 'first-owner';
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: owner, email: `${owner}@example.test`, name: 'عميل' },
  } }));
  const owners: string[] = [];
  await page.route('**/api/chat', async route => {
    owners.push(route.request().postDataJSON().chatOwnerId);
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: reply(`رد الحساب ${owners.length}`, `account-reply-${owners.length}`) });
  });
  await page.goto('/?chat=1');
  await (await openChat(page)).fill('طلب خاص للحساب الأول');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('رد الحساب 1', { exact: true })).toBeVisible();
  owner = 'second-owner';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('body')).not.toContainText('طلب خاص للحساب الأول');
  const input = await openChat(page);
  await expect(input).toBeEnabled();
  await input.fill('طلب للحساب الثاني');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('رد الحساب 2', { exact: true })).toBeVisible();
  expect(owners).toEqual(['first-owner', 'second-owner']);
});

test('a delayed session response cannot restore private history after another tab logs out', async ({ page, context }) => {
  let signedIn = true;
  let holdNext = false;
  let held = false;
  let release!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delivery = new Promise<void>(resolve => { delivered = resolve; });
  await context.route('**/api/auth/session', async route => {
    const authenticated = signedIn;
    const delayed = holdNext;
    if (delayed) {
      holdNext = false;
      held = true;
      await gate;
    }
    await route.fulfill({ json: { authenticated, user: authenticated
      ? { id: 'session-race-owner', email: 'race@example.test', name: 'عميل' } : null } });
    if (delayed) delivered();
  });
  await context.route('**/api/auth/logout', async route => {
    signedIn = false;
    await route.fulfill({ json: { status: 'signed_out' } });
  });
  await prepare(page);
  await page.route('**/api/chat', route => route.fulfill({ headers: {
    'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1',
  }, body: reply('سجل خاص لا تعيده استجابة قديمة', 'session-race-private') }));
  await page.goto('/?chat=1');
  await (await openChat(page)).fill('طلب خاص قبل انتهاء الجلسة');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByText('سجل خاص لا تعيده استجابة قديمة', { exact: true })).toBeVisible();
  const otherTab = await context.newPage();
  try {
    await prepare(otherTab);
    await otherTab.goto('/account');
    await expect(otherTab.getByRole('button', { name: 'خروج', exact: true })).toBeVisible();
    await page.bringToFront();
    holdNext = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => held).toBe(true);
    await otherTab.getByRole('button', { name: 'خروج', exact: true }).click();
    await expect(page.locator('body')).not.toContainText('سجل خاص لا تعيده استجابة قديمة');
    release();
    await delivery;
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    await expect(page.locator('body')).not.toContainText('سجل خاص لا تعيده استجابة قديمة');
    await expect(page.locator('body')).not.toContainText('طلب خاص قبل انتهاء الجلسة');
  } finally {
    release();
    await otherTab.close();
  }
});

test('two tabs keep distinct conversation IDs and a new chat resets only its previous search namespace', async ({ page, context }) => {
  await context.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'tab-search-owner', email: 'search-tabs@example.test', name: 'عميل' },
  } }));
  const conversations: { id: string; text: string }[] = [];
  let resetId: string | undefined;
  await context.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    conversations.push({ id: body.chatConversationId, text: body.messages.at(-1).parts[0].text });
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: reply(`نتيجة مستقلة ${conversations.length}`, `tab-result-${conversations.length}`) });
  });
  await context.route('**/api/chat/reset', async route => {
    resetId = route.request().headers()['x-chat-conversation-id'];
    await route.fulfill({ json: { status: 'reset' } });
  });
  const otherTab = await context.newPage();
  try {
    for (const [tab, query, count] of [[page, 'هاتف', 1], [otherTab, 'سيارة', 2]] as const) {
      await prepare(tab);
      await tab.goto('/?chat=1');
      await (await openChat(tab)).fill(query);
      await tab.getByRole('button', { name: 'إرسال', exact: true }).click();
      await expect(tab.getByText(`نتيجة مستقلة ${count}`, { exact: true })).toBeVisible();
    }
    expect(conversations[0].id).toBeTruthy();
    expect(conversations[0].id).not.toBe(conversations[1].id);
    await navigate(page, '/account', 'حسابي');
    await navigate(page, '/', 'الرئيسية');
    await (await openChat(page)).fill('أرخص');
    await page.getByRole('button', { name: 'إرسال', exact: true }).click();
    await expect(page.getByText('نتيجة مستقلة 3', { exact: true })).toBeVisible();
    expect(conversations[2].id).toBe(conversations[0].id);
    await page.getByRole('button', { name: 'مسح المحادثة وبدء محادثة جديدة', exact: true }).click();
    await expect.poll(() => resetId).toBe(conversations[0].id);
    await (await openChat(page)).fill('بحث جديد');
    await page.getByRole('button', { name: 'إرسال', exact: true }).click();
    await expect(page.getByText('نتيجة مستقلة 4', { exact: true })).toBeVisible();
    expect(conversations[3].id).not.toBe(conversations[0].id);
    await (await openChat(otherTab)).fill('أحدث');
    await otherTab.getByRole('button', { name: 'إرسال', exact: true }).click();
    await expect(otherTab.getByText('نتيجة مستقلة 5', { exact: true })).toBeVisible();
    expect(conversations[4].id).toBe(conversations[1].id);
    await expect(otherTab.getByText('سيارة', { exact: true })).toHaveCount(1);
  } finally {
    await otherTab.close();
  }
});

test('a long visible chat continues beyond twenty exchanges with bounded outgoing context', async ({ page }, info) => {
  test.setTimeout(60_000);
  await prepare(page);
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'long-browser-chat', email: 'long-chat@example.test', name: 'عميل' },
  } }));
  let turns = 0;
  let lastCount = 0;
  await page.route('**/api/chat', async route => {
    const body = route.request().postDataJSON();
    turns++;
    lastCount = body.messages.length;
    expect(lastCount).toBeLessThanOrEqual(40);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages.at(-1).id).toBeTruthy();
    await route.fulfill({ headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: reply(`متابعة السوق ${turns}`, `long-reply-${turns}`) });
  });
  await page.goto('/?chat=1');
  const input = await openChat(page);
  for (let index = 1; index <= 22; index++) {
    await input.fill(`طلب السوق ${index}`);
    await page.getByRole('button', { name: 'إرسال', exact: true }).click();
    await expect(page.getByText(`متابعة السوق ${index}`, { exact: true })).toBeVisible();
  }
  expect(turns).toBe(22);
  expect(lastCount).toBe(39);
  await expect(page.getByText('طلب السوق 1', { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('long-chat.png'), fullPage: true });
});

test('clearing early verified cards stays cleared when the delayed final answer arrives without duplicate assistant frames', async ({ page }, info) => {
  await prepare(page);
  await page.route('**/api/auth/session', route => route.fulfill({ json: {
    authenticated: true, user: { id: 'delayed-chat-owner', email: 'delayed@example.test', name: 'عميل' },
  } }));
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    let turn = 0;
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/api/chat') return originalFetch(input, init);
      turn++;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ start(controller) {
        const emit = (chunk: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        emit({ type: 'start', messageId: `delayed-answer-${turn}`, messageMetadata: { marketplaceIntent: 'search_listing' } });
        emit({ type: 'tool-input-available', toolCallId: 'early-search', toolName: 'searchMarketplaceListings', input: { query: 'هاتف' } });
        emit({ type: 'tool-output-available', toolCallId: 'early-search', output: { status: 'searched', listings: [
          { id: 'early-listing', title: 'هاتف', category: 'other', price: 100, image: '/hamad-market-logo.webp', status: 'published' },
        ] } });
        emit({ type: 'text-start', id: 'final' });
        (window as Window & { appendDelayedText?: (text: string) => void }).appendDelayedText = text => {
          emit({ type: 'text-delta', id: 'final', delta: text });
        };
        (window as Window & { finishDelayedAnswer?: () => void }).finishDelayedAnswer = () => {
          emit({ type: 'text-delta', id: 'final', delta: ' البحث المتاحة.' });
          emit({ type: 'text-end', id: 'final' });
          emit({ type: 'finish', finishReason: 'stop' });
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        };
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } });
    };
  });
  await page.goto('/?chat=1');
  await (await openChat(page)).fill('هاتف');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(1);
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(1);
  await expect(page.getByTestId('assistant-thinking')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('تعذر إكمال رد المساعد الآن');
  await page.evaluate(() => (window as Window & { appendDelayedText?: (text: string) => void }).appendDelayedText!('   '));
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(1);
  await expect(page.getByTestId('assistant-thinking')).toHaveCount(1);
  await expect(page.locator('body')).not.toContainText('تعذر إكمال رد المساعد الآن');
  await page.screenshot({ path: info.outputPath('single-pending-assistant.png'), fullPage: true });
  const back = page.getByRole('button', { name: 'العودة للإعلانات', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'مسح بحث المساعد', exact: true }).click();
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(0);
  await openChat(page);
  await page.evaluate(() => (window as Window & { appendDelayedText?: (text: string) => void }).appendDelayedText!('هذه نتائج'));
  await expect(page.getByText('هذه نتائج', { exact: true })).toBeVisible();
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(1);
  await expect(page.getByTestId('assistant-thinking')).toHaveCount(0);
  await page.evaluate(() => (window as Window & { finishDelayedAnswer?: () => void }).finishDelayedAnswer!());
  await expect(page.locator('body')).toContainText('هذه نتائج البحث المتاحة.');
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(1);
  await expect(page.locator('.smart-assistant-result-card')).toHaveCount(0);
  const input = await openChat(page);
  await input.fill('هاتف آخر');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await expect(page.getByTestId('assistant-thinking')).toHaveCount(1);
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(2);
  await page.evaluate(() => (window as Window & { appendDelayedText?: (text: string) => void }).appendDelayedText!('هذه نتائج'));
  await expect(page.getByTestId('assistant-thinking')).toHaveCount(0);
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(2);
  await page.evaluate(() => (window as Window & { finishDelayedAnswer?: () => void }).finishDelayedAnswer!());
  await expect(page.getByText('هذه نتائج البحث المتاحة.', { exact: true })).toHaveCount(2);
  await expect(page.getByTestId('assistant-message-frame')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('completed-assistant-replies.png'), fullPage: true });
});
