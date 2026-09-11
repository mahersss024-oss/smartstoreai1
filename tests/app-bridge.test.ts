import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectAppPlatform,
  isInsideNativeApp,
  postToNative,
} from '@/lib/native/app-bridge';

test('detectAppPlatform returns web when no navigator', () => {
  // node:test runs without a browser navigator.
  assert.equal(detectAppPlatform(), 'web');
});

test('isInsideNativeApp is false without a bridge shell', () => {
  assert.equal(isInsideNativeApp(), false);
});

test('postToNative returns false without a native shell', () => {
  assert.equal(
    postToNative({ type: 'ready', platform: 'web', version: '1' }),
    false,
  );
});

