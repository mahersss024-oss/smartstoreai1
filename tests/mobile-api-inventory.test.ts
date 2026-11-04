import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMobileApiInventory, inspectMobileApiSource } from '@/scripts/testing/mobile-api-inventory';

test('publication coordinator inventory resolves concrete operations while retaining the reviewed HTTP adapter as transport', () => {
  const rows = inspectMobileApiSource('src/core/listing-publication.ts', `
    class Publication {
      async run(id: string) {
        const request = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) => this.dependencies.request(method, path, body);
        await request('POST', '/api/marketplace/listings', {});
        const path = \`/api/marketplace/listings/\${encodeURIComponent(id)}\`;
        await request('PATCH', path, { action: 'publish' });
        await request('PATCH', \`\${path}/images/\${id}\`, { action: 'set_primary' });
        await this.dependencies.request('GET', \`/api/marketplace/me/listings/\${id}\`);
      }
    }
  `);
  const operations = rows.filter(row => row.role === 'operation');
  assert.deepEqual(operations.map(row => [row.method, row.path]), [
    ['POST', '/api/marketplace/listings'], ['PATCH', '/api/marketplace/listings/[param]'],
    ['PATCH', '/api/marketplace/listings/[param]/images/[param]'], ['GET', '/api/marketplace/me/listings/[param]'],
  ]);
  assert.ok(operations.every(row => row.resolution === 'resolved'));
  assert.ok(rows.some(row => row.role === 'transport' && row.reason?.includes('adapter')));
  const provider = inspectMobileApiSource('src/core/listing-publication-context.tsx', `
    import { api } from './api';
    const request = (path: string) => api.get(path);
    api.get('/api/unreviewed-literal');
  `);
  assert.equal(provider[0].role, 'transport');
  assert.equal(provider[1].role, 'operation', 'literal provider calls must still be mapped');
  assert.equal(provider[1].path, '/api/unreviewed-literal');
});

test('mobile API inventory resolves scoped templates, conditional URLs and named helper returns without reading comments', () => {
  const rows = inspectMobileApiSource('src/features/sample.tsx', `
    import { api } from '../core/api';
    // api.delete('/api/comment-only');
    const endpoint = '/api/wrong-scope';
    function Screen(id: string) {
      const endpoint = \`/api/marketplace/listings/\${encodeURIComponent(id)}\`;
      api.get(endpoint);
      api.get(\`\${endpoint}/favorite\`);
      api.delete(id ? \`/api/notifications?id=\${id}\` : '/api/notifications');
    }
    function uploadPath(id: string) { return \`/api/marketplace/listings/\${id}/image-uploads\`; }
    api.post(uploadPath('irrelevant-runtime-id'), { image: true });
    class Recovery {
      path() { return \`/api/marketplace/listings/\${this.id}/image-uploads\`; }
      cancel(id: string) { return api.delete(\`\${this.path()}/\${id}\`); }
    }
  `);
  assert.deepEqual(rows.map(row => [row.method, row.path, row.query]), [
    ['GET', '/api/marketplace/listings/[param]', null],
    ['GET', '/api/marketplace/listings/[param]/favorite', null],
    ['DELETE', '/api/notifications', 'id=[param]'],
    ['DELETE', '/api/notifications', null],
    ['POST', '/api/marketplace/listings/[param]/image-uploads', null],
    ['DELETE', '/api/marketplace/listings/[param]/image-uploads/[param]', null],
  ]);
  assert.ok(rows.every(row => row.resolution === 'resolved' && row.role === 'operation'));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
});

test('mobile API inventory distinguishes parameterized native HTTP methods and signed/media transfers', () => {
  const rows = inspectMobileApiSource('src/core/transfers.ts', `
    import { fetch as nativeFetch } from 'expo/fetch';
    function pushRequest(method: 'POST' | 'DELETE', baseUrl = getApiBaseUrl()) {
      return nativeFetch(\`\${baseUrl}/api/mobile/push/register\`, { method });
    }
    nativeFetch(transfer.url, { method: 'PUT', body: bytes });
    fetch(asset.uri);
    apiFetch('/api/runtime-method', settings);
    api.get(runtimeDestination);
  `);
  assert.deepEqual(rows.slice(0, 2).map(row => [row.method, row.path, row.resolution]), [
    ['POST', '/api/mobile/push/register', 'resolved'],
    ['DELETE', '/api/mobile/push/register', 'resolved'],
  ]);
  assert.equal(rows[2].method, 'PUT');
  assert.equal(rows[2].resolution, 'external');
  assert.equal(rows[2].role, 'transport');
  assert.equal(rows[3].resolution, 'external');
  assert.equal(rows[4].resolution, 'unresolved');
  assert.equal(rows[4].method, null);
  assert.equal(rows[5].resolution, 'unresolved');
  assert.ok(rows.slice(4).every(row => row.reason));
});

test('mobile API inventory retains generic central transports separately and identifies the configured chat transport', () => {
  const central = inspectMobileApiSource('src/core/api.ts', `
    import { fetch as expoFetch } from 'expo/fetch';
    function requestUrl(path: string) { return path; }
    function request(path: string, method: string) { return expoFetch(requestUrl(path), { method }); }
  `);
  assert.equal(central.length, 1);
  assert.equal(central[0].role, 'transport');
  assert.equal(central[0].resolution, 'unresolved');
  const chat = inspectMobileApiSource('src/features/assistant/screen.tsx', `
    new DefaultChatTransport({
      api: getApiBaseUrl() + '/api/chat',
      fetch: (_url, init) => apiFetch('/api/chat', init as RequestInit),
    });
  `);
  assert.equal(chat.length, 1);
  assert.equal(chat[0].method, 'POST');
  assert.equal(chat[0].path, '/api/chat');
  assert.match(chat[0].reason ?? '', /DefaultChatTransport/);
});

test('mobile API inventory rejects an unavailable checkout rather than producing an empty successful map', () => {
  assert.throws(() => buildMobileApiInventory('missing-mobile-checkout'), /must contain src/);
});
