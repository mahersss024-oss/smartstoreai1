'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, Megaphone, Flag, Users } from 'lucide-react';
import { useAdminAccess } from './use-admin-access';
import { WorkspaceDashboard } from '@/components/admin/workspace-dashboard';

export default function AdminHomePage() {
  const [overview, setOverview] = useState<{
    totalUsers: number;
    activeUsers: number;
    publishedListings: number;
    openReports: number;
  } | null>(null);
  const [overviewNotice, setOverviewNotice] = useState('');
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
  useEffect(() => {
    if (!canManageUsers) return;
    let cancelled = false;
    fetch('/api/admin/overview', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('overview_failed');
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setOverview(payload);
      })
      .catch(() => {
        if (!cancelled) setOverviewNotice('تعذر تحميل الإحصائيات الآن.');
      });
    return () => {
      cancelled = true;
    };
  }, [canManageUsers]);
  const statisticCards = [
    {
      label: 'إجمالي المستخدمين',
      value: overview?.totalUsers ?? null,
      icon: Users,
      href: '/admin/users',
    },
    {
      label: 'المستخدمون النشطون',
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
                    <p
                      role="alert"
                      className="col-span-full text-sm text-destructive"
                    >
                      {overviewNotice}
                    </p>
                  )}
                </section>
                <Suspense
                  fallback={
                    <p role="status" className="admin-empty">
                      جارٍ تحميل متابعة الإدارة...
                    </p>
                  }
                >
                  <WorkspaceDashboard />
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
