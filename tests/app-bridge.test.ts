import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('native bridge accepts android viewport inset updates', () => {
  const appBridge = readFileSync(
    join(process.cwd(), 'lib', 'native', 'app-bridge.ts'),
    'utf8',
  );
  const hook = readFileSync(
    join(process.cwd(), 'hooks', 'use-app-bridge.ts'),
    'utf8',
  );

  assert.match(appBridge, /type: 'viewport-insets'/);
  assert.match(appBridge, /statusBarInset\?: number/);
  assert.match(hook, /case 'viewport-insets'/);
  assert.match(hook, /platform === 'android'/);
  assert.match(hook, /--native-status-bar-inset/);
  assert.match(hook, /Math\.min\(message\.statusBarInset, 96\)/);
});
