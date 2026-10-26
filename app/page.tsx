import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { AppDownloadGateway } from '@/components/app-download-gateway';
import { detectMobileAppPlatform, getMobileAppStoreUrl } from '@/lib/mobile/app-store-links';

export const metadata: Metadata = {
  title: 'سوق حمد | تطبيق Android وiPhone',
  description: 'افتح تطبيق سوق حمد على جوالك، وتابع روابط Android وiPhone الرسمية عند إتاحتها.',
};

export default async function AppDownloadPage() {
  const requestHeaders = await headers();
  return <AppDownloadGateway
    platform={detectMobileAppPlatform(requestHeaders.get('user-agent'), requestHeaders.get('sec-ch-ua-platform'))}
    androidStoreUrl={getMobileAppStoreUrl('android')}
    iosStoreUrl={getMobileAppStoreUrl('ios')}
  />;
}
