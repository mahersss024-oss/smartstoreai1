export type MobileAppPlatform = 'android' | 'ios';

const storeHosts: Record<MobileAppPlatform, ReadonlySet<string>> = {
  android: new Set(['play.google.com']),
  ios: new Set(['apps.apple.com', 'testflight.apple.com']),
};

export function detectMobileAppPlatform(
  userAgent: string | null,
  platformHint: string | null,
): MobileAppPlatform | null {
  if (
    /SouqHamadCapacitor|ReactNativeWebView|SmartStoreNative/i.test(
      userAgent ?? '',
    )
  ) {
    return null;
  }

  if (/android/i.test(`${userAgent ?? ''} ${platformHint ?? ''}`)) {
    return 'android';
  }

  if (
    /iphone|ipad|ipod/i.test(userAgent ?? '') ||
    /ios/i.test(platformHint ?? '')
  ) {
    return 'ios';
  }

  return null;
}

export function getMobileAppStoreUrl(
  platform: MobileAppPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidate =
    platform === 'android'
      ? environment.SMARTSTORE_ANDROID_STORE_URL
      : environment.SMARTSTORE_IOS_STORE_URL?.trim() ||
        environment.NEXT_PUBLIC_IOS_APP_STORE_URL;

  if (!candidate?.trim()) {
    return null;
  }

  try {
    const url = new URL(candidate.trim());
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !storeHosts[platform].has(url.hostname.toLowerCase())
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}
