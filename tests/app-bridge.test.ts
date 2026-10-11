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

test('native bridge recognizes the Capacitor wrapper marker used by the mobile shells', () => {
  const appBridge = readFileSync(
    join(process.cwd(), 'lib', 'native', 'app-bridge.ts'),
    'utf8',
  );
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  assert.match(appBridge, /SouqHamadCapacitor/);
  assert.match(appBridge, /bridgeWindow\.Capacitor/);
  assert.match(layout, /userAgent\.indexOf\('SouqHamadCapacitor'\) !== -1/);
  assert.match(layout, /window\.Capacitor/);
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

test('auth provider visibility is gated by the native wrapper before platform', () => {
  const hook = readFileSync(
    join(process.cwd(), 'hooks', 'use-auth-provider-visibility.ts'),
    'utf8',
  );

  assert.match(hook, /isInsideNativeApp\(\)/);
  assert.match(hook, /detectAppPlatform\(\)/);
  assert.match(hook, /platform === 'android'/);
  assert.match(hook, /google: true, apple: false/);
  assert.match(hook, /platform === 'ios'/);
  assert.match(hook, /google: false, apple: true/);
  assert.match(hook, /google: true, apple: true/);
});
