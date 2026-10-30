import { headers } from 'next/headers';
import { AppDownloadGateway } from '@/components/app-download-gateway';
import { detectMobileAppPlatform, getMobileAppStoreUrl } from '@/lib/mobile/app-store-links';

/** Existing customer URLs keep their resource identity while opening native UI. */
export async function CustomerAppGateway({ path }: { path: string }) {
  const requestHeaders = await headers();
  return <AppDownloadGateway
    platform={detectMobileAppPlatform(requestHeaders.get('user-agent'), requestHeaders.get('sec-ch-ua-platform'))}
    androidStoreUrl={getMobileAppStoreUrl('android')}
    iosStoreUrl={getMobileAppStoreUrl('ios')}
    targetPath={path}
  />;
}
