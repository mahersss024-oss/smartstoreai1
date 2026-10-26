import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectMobileAppPlatform,
  getMobileAppStoreUrl,
  mobileAppGatewayUrl,
  mobileAppLaunchUrl,
  mobileAppPackageId,
} from '@/lib/mobile/app-store-links';

test('unpublished applications never invent store destinations', () => {
  for (const configuration of [{}, { NEXT_PUBLIC_ANDROID_APP_STORE_URL: ' ', NEXT_PUBLIC_IOS_APP_STORE_URL: '' }]) {
    assert.equal(getMobileAppStoreUrl('android', configuration), null);
    assert.equal(getMobileAppStoreUrl('ios', configuration), null);
  }
  assert.equal(mobileAppPackageId, 'com.souqhamad.app');
  assert.equal(mobileAppLaunchUrl, 'smartstore://');
  assert.equal(mobileAppGatewayUrl, 'https://souqhamad.com/');
});

test('Android links retain the production package and store query parameters', () => {
  const value = `https://play.google.com/store/apps/details?id=${mobileAppPackageId}&hl=ar&gl=SA`;
  assert.equal(getMobileAppStoreUrl('android', { NEXT_PUBLIC_ANDROID_APP_STORE_URL: ` ${value} ` }), value);
  for (const value of [
    'https://play.google.com/store/apps/details?id=com.souqhamad.app.dev',
    'https://play.google.com/store/apps/details?id=another.app',
    'https://play.google.com/store/apps/details?id=YOUR_PACKAGE_ID',
    'https://play.google.com/store/apps/details',
    'https://play.google.com/store/apps/details?id=com.souqhamad.app&id=another.app',
    'https://play.google.com/store/search?q=com.souqhamad.app',
  ]) assert.equal(getMobileAppStoreUrl('android', { NEXT_PUBLIC_ANDROID_APP_STORE_URL: value }), null, value);
});

test('store links reject non-HTTPS, credentials, deceptive hosts, ports and fragments', () => {
  for (const value of [
    'javascript:alert(1)',
    '//play.google.com/store/apps/details?id=com.souqhamad.app',
    'http://play.google.com/store/apps/details?id=com.souqhamad.app',
    'https://play.google.com.example.test/store/apps/details?id=com.souqhamad.app',
    'https://play.google.com@evil.example/store/apps/details?id=com.souqhamad.app',
    'https://user:password@play.google.com/store/apps/details?id=com.souqhamad.app',
    'https://play.google.com:8443/store/apps/details?id=com.souqhamad.app',
    'https://play.google.com/store/apps/details?id=com.souqhamad.app#other',
    'not a URL',
  ]) assert.equal(getMobileAppStoreUrl('android', { NEXT_PUBLIC_ANDROID_APP_STORE_URL: value }), null, value);
  for (const value of [
    'http://apps.apple.com/sa/app/id123456789',
    'https://apps.apple.com.example.test/sa/app/id123456789',
    'https://user@apps.apple.com/sa/app/id123456789',
    'https://testflight.apple.com:8443/join/Ab12Cd34',
    'https://testflight.apple.com/join/Ab12Cd34#fragment',
  ]) assert.equal(getMobileAppStoreUrl('ios', { NEXT_PUBLIC_IOS_APP_STORE_URL: value }), null, value);
});

test('iPhone accepts configured app listings and TestFlight invitations only', () => {
  for (const value of [
    'https://apps.apple.com/sa/app/souq-hamad/id123456789',
    'https://apps.apple.com/app/id123456789?l=ar',
    'https://testflight.apple.com/join/Ab12Cd34',
  ]) assert.equal(getMobileAppStoreUrl('ios', { NEXT_PUBLIC_IOS_APP_STORE_URL: value }), value);
  for (const value of [
    'https://apps.apple.com/',
    'https://apps.apple.com/sa/search?term=souq-hamad',
    'https://apps.apple.com/app/id0',
    'https://apps.apple.com/app/idYOUR_APP_ID',
    'https://testflight.apple.com/',
    'https://testflight.apple.com/join/not-an-invite',
    'https://testflight.apple.com/join/YOURCODE',
    'https://play.google.com/store/apps/details?id=com.souqhamad.app',
  ]) assert.equal(getMobileAppStoreUrl('ios', { NEXT_PUBLIC_IOS_APP_STORE_URL: value }), null, value);
  assert.equal(getMobileAppStoreUrl('android', { NEXT_PUBLIC_ANDROID_APP_STORE_URL: 'https://apps.apple.com/app/id123456789' }), null);
});

test('mobile platform selection handles Android, iPhone, iPad and client hints', () => {
  assert.equal(detectMobileAppPlatform('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), 'android');
  assert.equal(detectMobileAppPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(detectMobileAppPlatform('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)'), 'ios');
  assert.equal(detectMobileAppPlatform(undefined, '"Android"'), 'android');
  assert.equal(detectMobileAppPlatform(null, '"iOS"'), 'ios');
  assert.equal(detectMobileAppPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', '"Windows"'), null);
  assert.equal(detectMobileAppPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)'), null);
  assert.equal(detectMobileAppPlatform(null), null);
});
