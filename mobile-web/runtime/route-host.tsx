'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useMobileRouter } from './router';
import { MobileOfflinePage } from './offline-page';
import { MobilePolicyPage } from './policy-page';
import { AppDownloadGateway } from '../../components/app-download-gateway';
import { detectMobileAppPlatform, getMobileAppStoreUrl, type MobileAppPlatform } from '../../lib/mobile/app-store-links';



const LoadingPage = () => (
  <main className="grid min-h-dvh place-items-center text-sm text-muted-foreground">جارٍ تحميل الصفحة…</main>
);

function MobileNotFoundPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#e8edf3] px-5 text-center text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <section className="grid max-w-sm justify-items-center gap-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-card">
        <p className="text-sm font-semibold text-blue-600">404</p>
        <h1 className="text-xl font-bold">الصفحة غير موجودة</h1>
        <p className="text-sm leading-6 text-muted-foreground">تعذّر العثور على الصفحة المطلوبة.</p>
      </section>
    </main>
  );
}

const AdminHomePage = dynamic(() => import('../../app/admin/page'), { loading: LoadingPage, ssr: false });
const AdminAuditLogPage = dynamic(() => import('../../app/admin/audit-log/page'), { loading: LoadingPage, ssr: false });
const AdminCommissionsPage = dynamic(() => import('../../app/admin/commissions/page'), { loading: LoadingPage, ssr: false });
const AdminListingsPage = dynamic(() => import('../../app/admin/listings/page'), { loading: LoadingPage, ssr: false });
const AdminMaintenancePage = dynamic(() => import('../../app/admin/maintenance/page'), { loading: LoadingPage, ssr: false });
const AdminModerationPage = dynamic(() => import('../../app/admin/moderation/page'), { loading: LoadingPage, ssr: false });
const AdminUsersPage = dynamic(() => import('../../app/admin/users/page'), { loading: LoadingPage, ssr: false });
const CommissionAgreementPage = dynamic(() => import('../../app/commission-agreement/page'), { loading: LoadingPage, ssr: false });

function CustomerGateway({ path }: { path: string }) {
  const [platform, setPlatform] = useState<MobileAppPlatform | null>(null);
  useEffect(() => setPlatform(detectMobileAppPlatform(navigator.userAgent)), []);
  return <AppDownloadGateway targetPath={path} platform={platform}
    androidStoreUrl={getMobileAppStoreUrl('android', { NEXT_PUBLIC_ANDROID_APP_STORE_URL: process.env.NEXT_PUBLIC_ANDROID_APP_STORE_URL })}
    iosStoreUrl={getMobileAppStoreUrl('ios', { NEXT_PUBLIC_IOS_APP_STORE_URL: process.env.NEXT_PUBLIC_IOS_APP_STORE_URL })} />;
}

export function MobileRouteHost() {
  const { pathname } = useMobileRouter();
  const listingMatch = pathname.match(/^\/listings\/([^/]+)\/?$/);
  const sellerMatch = pathname.match(/^\/sellers\/([^/]+)\/?$/);
  const conversationMatch = pathname.match(/^\/conversations\/([^/]+)\/?$/);

  if (listingMatch) {
    return <CustomerGateway path={pathname} />;
  }

  if (sellerMatch) return <CustomerGateway path={pathname} />;
  if (conversationMatch) return <CustomerGateway path={pathname} />;
  if (pathname === '/') return <MobileNotFoundPage />;
  if (pathname === '/admin') return <AdminHomePage />;
  if (pathname === '/admin/audit-log') return <AdminAuditLogPage />;
  if (pathname === '/admin/commissions') return <AdminCommissionsPage />;
  if (pathname === '/admin/listings') return <AdminListingsPage />;
  if (pathname === '/admin/maintenance') return <AdminMaintenancePage />;
  if (pathname === '/admin/moderation') return <AdminModerationPage />;
  if (pathname === '/admin/users') return <AdminUsersPage />;
  if (pathname === '/commission-agreement') return <CommissionAgreementPage />;
  if (pathname === '/commission-policy') return <MobilePolicyPage kind="commissions" />;
  if (pathname === '/commissions') return <CustomerGateway path={pathname} />;
  if (pathname === '/conversations') return <CustomerGateway path={pathname} />;
  if (pathname === '/delete-account') return <MobilePolicyPage kind="deletion" />;
  if (pathname === '/favorites') return <CustomerGateway path={pathname} />;
  if (pathname === '/listing-policy') return <MobilePolicyPage kind="listings" />;
  if (pathname === '/notifications') return <CustomerGateway path={pathname} />;
  if (pathname === '/offline') return <MobileOfflinePage />;
  if (pathname === '/privacy') return <MobilePolicyPage kind="privacy" />;
  if (pathname === '/terms') return <MobilePolicyPage kind="terms" />;

  return <MobileNotFoundPage />;
}
