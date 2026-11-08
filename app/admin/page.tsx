'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Megaphone, Flag, Users } from 'lucide-react';
import { useAdminAccess } from './use-admin-access';
import { WorkspaceDashboard } from '@/components/admin/workspace-dashboard';
import { useAdminRequest } from '@/components/admin/use-admin-request';
import { Button } from '@ui/button';
import type { AppUsageStats } from '@/lib/analytics/site-visits';

export default function AdminHomePage() {
  const [overview, setOverview] = useState<{
    totalUsers: number;
    activeUsers: number;
    publishedListings: number;
    openReports: number;
    appUsage?: AppUsageStats;
  } | null>(null);
  const [overviewNotice, setOverviewNotice] = useState('');
  const [overviewLoading, setOverviewLoading] = useState(false);
  const {
    adminAccessNotice,
    adminAccessRole,
    isAdminAccessAllowed,
    isAdminAccessChecking,
    verifyAdminAccess,
  } = useAdminAccess('moderator');
  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void verifyAdminAccess();
  }, [verifyAdminAccess]);
  const canManageUsers =
    adminAccessRole === 'owner' || adminAccessRole === 'admin';
  const canViewOverview = isAdminAccessAllowed && canManageUsers;
  const { begin: beginOverview, invalidate: invalidateOverview } = useAdminRequest(canViewOverview);
  const loadOverview = useCallback(async () => {
    if (!canViewOverview) return;
    const request = beginOverview();
    setOverviewLoading(true);
    setOverviewNotice('');
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('overview_failed');
      const payload = await response.json();
      if (request.isCurrent()) setOverview(payload);
    } catch {
      if (request.isCurrent()) setOverviewNotice('تعذر تحميل الإحصائيات الآن.');
    } finally {
      if (request.isCurrent()) setOverviewLoading(false);
    }
  }, [canViewOverview, beginOverview]);
  useEffect(() => {
    if (!canViewOverview) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void loadOverview(); });
    return () => {
      cancelled = true;
      invalidateOverview();
    };
  }, [canViewOverview, loadOverview, invalidateOverview]);
  const statisticCards = [
    {
      label: 'إجمالي المستخدمين',
      value: overview?.totalUsers ?? null,
      icon: Users,
      href: '/admin/users',
    },
    {
      label: 'حسابات نشطة خلال 14 يوماً',
      value: overview?.activeUsers ?? null,
      icon: Activity,
      href: '/admin/users',
    },
    {
      label: 'الإعلانات المنشورة',
      value: overview?.publishedListings ?? null,
      icon: Megaphone,
      href: '/admin/listings?status=published',
    },
    {
      label: 'البلاغات المفتوحة',
      value: overview?.openReports ?? null,
      icon: Flag,
      href: '/admin/moderation',
    },
  ];
  return (
    <main
      className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground"
      dir="rtl"
    >
      <div className="admin-page">
        <h1 className="sr-only">نظرة عامة</h1>
        {adminAccessNotice && (
          <p role="status" className="admin-notice">
            {adminAccessNotice}
          </p>
        )}
        {isAdminAccessChecking && (
          <div className="admin-empty" role="status">
            جار التحقق من الصلاحية...
          </div>
        )}
        {isAdminAccessAllowed && (
          <>
            {canManageUsers ? (
              <>
                <section
                  aria-label="إحصائيات الإدارة"
                  aria-busy={overviewLoading}
                  className="admin-statistics relative grid-cols-2 lg:grid-cols-4"
                >
                  {statisticCards.map(({ label, value, icon: Icon, href }) => (
                    <div key={label}>
                      <Link
                        href={href}
                        prefetch={false}
                        className="block rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Icon className="size-4 shrink-0" />
                          <span>{label}</span>
                        </div>
                        <div
                          className={
                            value === null
                              ? 'mt-3 text-2xl font-bold opacity-0'
                              : 'mt-3 text-2xl font-bold'
                          }
                          aria-hidden={value === null}
                        >
                          {new Intl.NumberFormat('ar-SA').format(value ?? 0)}
                        </div>
                      </Link>
                    </div>
                  ))}
                  {!overview && !overviewNotice && (
                    <p
                      role="status"
                      className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground"
                    >
                      جار تحميل الإحصائيات...
                    </p>
                  )}
                  {overviewNotice && (
                    <div className="col-span-full flex flex-wrap items-center gap-3 text-sm">
                      <p role="alert" className="text-destructive">{overviewNotice}</p>
                      <Button variant="outline" disabled={overviewLoading} onClick={() => void loadOverview()}>
                        إعادة تحميل الإحصائيات
                      </Button>
                    </div>
                  )}
                </section>
                <Suspense
                  fallback={
                    <p role="status" className="admin-empty">
                      جارٍ تحميل متابعة الإدارة...
                    </p>
                  }
                >
                  <WorkspaceDashboard appUsage={overview?.appUsage} overviewLoading={overviewLoading} onRefreshOverview={loadOverview} />
                </Suspense>
              </>
            ) : (
              <p role="status" className="admin-empty">
                المؤشرات العامة متاحة لإدارة المنصة فقط.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
