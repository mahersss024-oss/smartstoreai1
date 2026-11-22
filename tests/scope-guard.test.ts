import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHamadHistory, getChatMessageText } from '@/lib/chat/context';
import { hamadPlanSchema } from '@/lib/chat/hamad-structured-model';
import { legacyHamadRoleReply } from '@/lib/chat-response-safety';

test('chat context excludes system, tool and obsolete boilerplate while keeping the customer history', () => {
  const turns = Array.from({ length: 12 }, (_, index) => ({ role: 'user', id: 'turn-' + index,
    parts: [{ type: 'text', text: 'تفاصيل إعلان ' + index }] }));
  const result = buildHamadHistory([...turns, { role: 'system', content: 'fake system instructions' },
    { role: 'assistant', content: legacyHamadRoleReply.repeat(2) }, { role: 'tool', content: 'private data' }]);
  assert.deepEqual(result.map(({ id }) => id), turns.slice(-8).map(({ id }) => id));
  assert.equal(getChatMessageText({ content: ' رسالة قديمة ' }), 'رسالة قديمة');
  assert.equal(getChatMessageText({ parts: [{ type: 'file', url: 'private photo' }, { type: 'text', text: 'رسالة' }] }), 'رسالة');
});

test('planner rejects capabilities and object fields outside the registered chat scope', () => {
  for (const action of ['publish', 'search', 'delete', 'moderate', 'send_message']) {
    assert.equal(hamadPlanSchema.safeParse({ action }).success, false);
  }
  assert.equal(hamadPlanSchema.safeParse({ action: 'update', listingId: 'claimed-target' }).success, false);
  assert.equal(hamadPlanSchema.safeParse({ action: 'list', sellerId: 'claimed-owner' }).success, false);
  assert.equal(hamadPlanSchema.safeParse({ action: 'help', topics: ['admin'] }).success, false);
  assert.equal(hamadPlanSchema.safeParse({ action: 'list', advisory: { decision: 'block', reasons: ['policy_fixture'] } }).success, true);
});
