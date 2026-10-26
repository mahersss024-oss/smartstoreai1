export type MobileAppPlatform = 'android' | 'ios';

export const mobileAppPackageId = 'com.souqhamad.app';
export const mobileAppLaunchUrl = 'smartstore://';
export const mobileAppGatewayUrl = 'https://souqhamad.com/';

type StoreConfiguration = {
  NEXT_PUBLIC_ANDROID_APP_STORE_URL?: string;
  NEXT_PUBLIC_IOS_APP_STORE_URL?: string;
};

/** Validate configured destinations; an absent URL never implies a published app. */
export function getMobileAppStoreUrl(
  platform: MobileAppPlatform,
  configuration: StoreConfiguration = {
    NEXT_PUBLIC_ANDROID_APP_STORE_URL: process.env.NEXT_PUBLIC_ANDROID_APP_STORE_URL,
    NEXT_PUBLIC_IOS_APP_STORE_URL: process.env.NEXT_PUBLIC_IOS_APP_STORE_URL,
  },
): string | null {
  const value = platform === 'android'
    ? configuration.NEXT_PUBLIC_ANDROID_APP_STORE_URL
    : configuration.NEXT_PUBLIC_IOS_APP_STORE_URL;
  if (!value?.trim() || /YOUR[_-]?(?:APP[_-]?ID|PACKAGE[_-]?ID|CODE)|PLACEHOLDER|REPLACE[_-]?ME|[<>{}]/i.test(value)) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;

    if (platform === 'android') {
      return url.hostname === 'play.google.com'
        && url.pathname === '/store/apps/details'
        && url.searchParams.getAll('id').length === 1
        && url.searchParams.get('id') === mobileAppPackageId
        ? url.href : null;
    }

    const appStore = url.hostname === 'apps.apple.com'
      && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id[1-9]\d*\/?$/i.test(url.pathname);
    const testFlight = url.hostname === 'testflight.apple.com'
      && /^\/join\/[a-z0-9]{8}\/?$/i.test(url.pathname);
    return appStore || testFlight ? url.href : null;
  } catch {
    return null;
  }
}

export function detectMobileAppPlatform(
  userAgent: string | null | undefined,
  clientHintPlatform?: string | null,
): MobileAppPlatform | null {
  if (/android/i.test(userAgent ?? '')) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent ?? '')) return 'ios';
  const hint = clientHintPlatform?.trim().replace(/^"|"$/g, '').toLowerCase();
  return hint === 'android' ? 'android' : hint === 'ios' ? 'ios' : null;
}
