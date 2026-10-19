import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileUIPart, UIMessage } from 'ai';
import { createChatImageContext } from '@/lib/chat/image-context';
import { readFileSync } from 'node:fs';
import { chatContextTextLimit, chatMessageTextLength, selectChatContext } from '@/lib/chat/context';
import { clearChatSessionState, readChatSessionState, setChatSessionOwner, writeChatSessionState } from '@/lib/chat/session-state';

function turn(index: number, text = 'context'): UIMessage {
  return { id: `turn-${index}`, role: index % 2 ? 'assistant' : 'user', parts: [{ type: 'text', text }] };
}

test('chat snapshots survive navigation only for their owner and are invalidated by logout', () => {
  setChatSessionOwner('first');
  const state = { messages: [turn(0)], photos: ['private-photo'] };
  writeChatSessionState('first', state);
  assert.deepEqual(readChatSessionState('first'), state);
  assert.equal(readChatSessionState('second'), null);
  setChatSessionOwner(null);
  assert.equal(readChatSessionState('first'), null);
  writeChatSessionState('first', state);
  setChatSessionOwner('second');
  assert.equal(readChatSessionState('second'), null);
  writeChatSessionState('first', state);
  assert.equal(readChatSessionState('second'), null, 'a stale request cannot populate another account cache');
  setChatSessionOwner('first');
  assert.equal(readChatSessionState('first'), null, 'signing in again does not restore a pre-logout snapshot');
  clearChatSessionState();
  setChatSessionOwner(null);
});

test('long chat requests keep recent complete turns without deleting visible history or changing the latest ID', () => {
  const history = Array.from({ length: 101 }, (_, index) => turn(index));
  const context = selectChatContext(history);
  assert.equal(history.length, 101);
  assert.equal(context.length, 39);
  assert.equal(context[0].role, 'user');
  assert.equal(context.at(-1)?.id, 'turn-100');
  assert.equal(context.at(-1), history.at(-1));
});

test('context fits the existing text budget and does not hide an oversized latest customer request', () => {
  const context = selectChatContext(Array.from({ length: 31 }, (_, index) => turn(index, 'x'.repeat(1500))));
  assert.ok(context.reduce((total, message) => total + chatMessageTextLength(message), 0) <= chatContextTextLimit);
  const oversized = turn(0, 'x'.repeat(chatContextTextLimit + 1));
  assert.equal(selectChatContext([oversized])[0], oversized);
});

test('older photos become source references, while the current upload and customer-visible history are preserved', () => {
  const photo = { type: 'file' as const, mediaType: 'image/png', url: 'data:image/png;base64,AQID' };
  const history: UIMessage[] = [{ ...turn(0), parts: [photo] }, turn(1), { ...turn(2), parts: [photo] }];
  const context = selectChatContext(history);
  assert.ok(context[0].parts.every(part => part.type !== 'file'));
  assert.match(JSON.stringify(context[0]), /turn-0/);
  assert.deepEqual(context.at(-1)?.parts, [photo]);
  assert.deepEqual(history[0].parts, [photo]);
});

test('the interface uses verified server results instead of keyword-based request inference', () => {
  const page = readFileSync('app/page.tsx', 'utf8');
  for (const name of ['inferClientIntent', 'isSearchRefinement', 'getNextListingQuery', 'shouldSendRetainedListingImages']) {
    assert.ok(!page.includes(name), name);
  }
  assert.match(page, /marketplaceIntent/);
  assert.match(page, /prepareSendMessagesRequest: chatImages.prepareRequest/);
  assert.match(readFileSync('lib/chat/image-context.ts', 'utf8'), /selectChatContext\(messages\)/);
});

test('the actual transport keeps one owner-scoped photo source without keyword decisions or resending old message bytes', async () => {
  const images = createChatImageContext('photo-owner');
  const photo: FileUIPart = { type: 'file', mediaType: 'image/png', filename: 'product.png', url: 'data:image/png;base64,AQID' };
  const history: UIMessage[] = [{ ...turn(0), parts: [photo] }];
  const send = () => images.prepareRequest({ id: 'chat', api: '/api/chat', credentials: 'include', headers: undefined,
    requestMetadata: undefined, messages: history, body: {}, trigger: 'submit-message', messageId: history.at(-1)!.id }).body;
  const initial = await send();
  assert.equal(initial.chatOwnerId, 'photo-owner');
  assert.match(String(initial.chatConversationId), /^[a-zA-Z0-9_-]{16,80}$/);
  assert.deepEqual(initial.retainedListingImages, []);
  history.push(turn(1), turn(2, 'ordinary follow-up with no predefined words'));
  const followUp = await send();
  assert.equal(followUp.retainedListingImageMessageId, 'turn-0');
  assert.equal(followUp.chatConversationId, initial.chatConversationId);
  assert.deepEqual(followUp.retainedListingImages, [photo]);
  assert.ok(!(followUp.messages as UIMessage[])[0].parts.some(part => part.type === 'file'));
  const otherOwner = createChatImageContext('other-owner');
  assert.deepEqual(otherOwner.snapshot().images, []);
  assert.notEqual(otherOwner.snapshot().conversationId, initial.chatConversationId);
  const restored = createChatImageContext('photo-owner');
  restored.restore(images.snapshot().images, images.snapshot().sourceMessageId, images.snapshot().conversationId);
  assert.equal(restored.snapshot().conversationId, initial.chatConversationId, 'navigation restores the same conversation');
  images.clear();
  assert.notEqual(images.snapshot().conversationId, initial.chatConversationId, 'a new chat gets independent search state');
  assert.deepEqual((await send()).retainedListingImages, []);
});
