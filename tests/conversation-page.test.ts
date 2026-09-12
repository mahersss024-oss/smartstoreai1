import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readConversationPage() {
  return readFileSync(
    join(process.cwd(), 'app', 'conversations', '[conversationId]', 'page.tsx'),
    'utf8',
  );
}

test('seller buyer conversation scrolls to the latest message', () => {
  const source = readConversationPage();

  assert.match(source, /messagesEndRef/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /visibleMessages\.length/);
  assert.match(source, /flex min-h-full flex-col justify-end gap-3/);
});

test('seller buyer conversation handles non-json send failures safely', () => {
  const source = readConversationPage();

  assert.match(source, /let payload: \{/);
  assert.match(source, /await response\.json\(\)/);
  assert.match(source, /catch \{/);
  assert.match(source, /payload = \{\}/);
});

test('seller buyer conversation preserves newer draft text after send', () => {
  const source = readConversationPage();

  assert.match(source, /const messageBody = draft\.trim\(\)/);
  assert.match(source, /currentDraft\.trim\(\) === messageBody/);
});

test('seller buyer conversation hides blocked messages and uses official contact sharing', () => {
  const source = readConversationPage();

  assert.match(source, /message\.status === 'sent'/);
  assert.match(source, /shareOfficialContact/);
  assert.match(source, /action: 'share_contact'/);
  assert.match(source, /message\.type === 'contact_share'/);
  assert.match(source, /مشاركة الرقم/);
  assert.doesNotMatch(source, /محجوبة/);
});
