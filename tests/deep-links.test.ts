import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isLikelyInAppBrowser,
  isSafeInternalPath,
  toAppDeepLink,
} from '@/lib/native/deep-links';

test('accepts known and dynamic internal paths', () => {
  assert.equal(isSafeInternalPath('/'), true);
  assert.equal(isSafeInternalPath('/account'), true);
  assert.equal(isSafeInternalPath('/listings/abc_123'), true);
  assert.equal(isSafeInternalPath('/conversations/xyz-9'), true);
});

test('rejects unsafe paths', () => {
  assert.equal(isSafeInternalPath('https://evil.com'), false);
  assert.equal(isSafeInternalPath('//evil.com'), false);
  assert.equal(isSafeInternalPath('/../etc/passwd'), false);
  assert.equal(isSafeInternalPath('/unknown-route'), false);
  assert.equal(isSafeInternalPath('/account\\..\\secret'), false);
});

test('maps an internal URL to the custom scheme', () => {
  assert.equal(toAppDeepLink('/listings/abc'), 'smartstore://listings/abc');
  assert.equal(toAppDeepLink('/account'), 'smartstore://account');
});

test('maps an absolute URL to the custom scheme and keeps query', () => {
  assert.equal(
    toAppDeepLink('https://www.smartstore-ai.com/listings/abc?tab=images'),
    'smartstore://listings/abc?tab=images',
  );
});

test('returns null for external or unknown URLs', () => {
  assert.equal(toAppDeepLink('https://evil.com/listings/abc'), null);
  assert.equal(toAppDeepLink('/totally-unknown'), null);
});

test('detects common in-app browsers', () => {
  assert.equal(
    isLikelyInAppBrowser(
      'Mozilla/5.0 (iPhone) FBAN/FBIOS; FBAV/400.0',
    ),
    true,
  );
  assert.equal(
    isLikelyInAppBrowser('Mozilla/5.0 (iPhone) Version/16 Safari'),
    false,
  );
});
