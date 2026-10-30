import test from 'node:test';
import assert from 'node:assert/strict';
import { customerAppDestination } from '@/lib/mobile/customer-destination';

test('existing customer routes open their corresponding native screen', () => {
  for (const [web, native] of [
    ['/favorites', '/favorites'], ['/conversations', '/messages'],
    ['/commissions', '/commissions'], ['/notifications', '/notifications'],
    ['/listings/item-123', '/listings/item-123'],
    ['/listings/listing%3Ashare%201', '/listings/listing%3Ashare%201'],
    ['/sellers/google%3A123', '/sellers/google%3A123'],
    ['/conversations/chat-1', '/conversations/chat-1'],
  ]) {
    assert.deepEqual(customerAppDestination(web), { webPath: web, nativePath: native,
      launchUrl: `smartstore://${native.slice(1)}`, webUrl: `https://souqhamad.com${web}` });
  }
});

test('gateway targets cannot forward credentials, auth tickets or administration', () => {
  for (const path of ['/admin', '/api/auth/mobile/exchange?ticket=private', '//evil.test', 'https://evil.test',
    '/favorites?ticket=private', '/conversations/chat?token=secret', '/listings/id#token=secret',
    '/listings/%2fadmin', '/listings/%252fadmin', '/sellers/..', '/listings/%00',
    '/listings/%', '/listings/id\\evil', '/listings/id/extra']) {
    assert.deepEqual(customerAppDestination(path), customerAppDestination('/'), path);
  }
});

test('root handoff stays unchanged and resource encoding is canonical', () => {
  assert.equal(customerAppDestination('/').launchUrl, 'smartstore://');
  const id = 'معرف-إعلان';
  const path = `/listings/${encodeURIComponent(id)}`;
  assert.deepEqual(customerAppDestination(path.toLowerCase()), customerAppDestination(path));
  assert.equal(customerAppDestination(path).webPath, path);
});
