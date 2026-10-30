import test from 'node:test';
import assert from 'node:assert/strict';
import { createOauthState, parseOauthState, sanitizeAuthReturnTo } from '@/lib/auth/session';
import { GET } from '@/app/api/auth/google/start/route';

test('administrative sign-in returns only to existing allowlisted administration pages', () => {
  for (const path of ['/admin', '/admin/audit-log', '/admin/commissions', '/admin/listings', '/admin/maintenance', '/admin/moderation', '/admin/users']) {
    assert.equal(sanitizeAuthReturnTo(path), path);
    assert.equal(parseOauthState(createOauthState(path))?.returnTo, path);
    assert.equal(sanitizeAuthReturnTo(`${path}?ticket=private#token=private`), path);
  }
  for (const path of ['https://evil.test/admin', '//evil.test/admin', '/admin\\evil', '/api/auth/google/start', '/admin/unknown', '/administrator', '/favorites', '/admin/%2f%2fevil.test', '/admin/../privacy']) {
    assert.equal(sanitizeAuthReturnTo(path), '/', path);
  }
});

test('admin sign-in preserves the required agreement and administrative destination', async () => {
  const response = await GET(new Request('https://souqhamad.test/api/auth/google/start?return_to=%2Fadmin%2Fusers'));
  assert.equal(response.status, 307);
  const url = new URL(response.headers.get('location')!);
  assert.equal(url.pathname, '/commission-agreement');
  assert.equal(url.searchParams.get('return_to'), '/admin/users');
  assert.equal(url.searchParams.get('provider'), 'google');
});
