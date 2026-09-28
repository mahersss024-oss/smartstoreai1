'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Activity,
  ClipboardList,
  FileCheck2,
  Flag,
  Megaphone,
  Percent,
  ShieldCheck,
  Store,
  Trash2,
  Users,
} from 'lucide-react';

import { Button } from '@ui/button';
import { useAdminAccess } from './use-admin-access';

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

  const isOwner = adminAccessRole === 'owner';
  const isModeratorOnly = adminAccessRole === 'moderator';
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
    return () => { cancelled = true; };
  }, [canManageUsers]);

  const adminSections = useMemo(
    () =>
      [
        {
          href: '/admin/moderation',
          icon: <ShieldCheck className="size-5" />,
          label: 'المراجعة والبلاغات',
          text: 'مراجعة الإعلانات وبلاغات الإعلانات والمحادثات.',
          visible: true,
        },
        {
          href: '/admin/listings',
          icon: <Megaphone className="size-5" />,
          label: 'إدارة الإعلانات',
          text: 'إدارة حالة الإعلان وتعديله أو إيقافه أو حذفه.',
          visible: true,
        },
        {
          href: '/admin/users',
          icon: <Users className="size-5" />,
          label: 'إدارة المستخدمين',
          text: 'إدارة الحسابات والصلاحيات وحالة المستخدم.',
          visible: canManageUsers,
        },
        {
          href: '/admin/commissions',
          icon: <Percent className="size-5" />,
          label: 'رسوم المنصة',
          text: 'متابعة الرسوم المستحقة وإدارة حالاتها.',
          visible: isOwner,
        },
        {
          href: '/admin/audit-log',
          icon: <ClipboardList className="size-5" />,
          label: 'سجل الإدارة',
          text: 'مراجعة العمليات الإدارية الحساسة وسياق تنفيذها.',
          visible: canManageUsers,
        },
        {
          href: '/admin/maintenance',
          icon: <Trash2 className="size-5" />,
          label: 'الصيانة والتنظيف',
          text: 'معاينة البيانات وتنفيذ عمليات التنظيف الآمنة.',
          visible: isOwner,
        },
      ].filter((section) => section.visible),
    [canManageUsers, isOwner],
  );

  const statisticCards = overview
    ? [
        { label: 'إجمالي المستخدمين', value: overview.totalUsers, icon: Users },
        { label: 'المستخدمون النشطون', value: overview.activeUsers, icon: Activity },
        { label: 'الإعلانات المنشورة', value: overview.publishedListings, icon: FileCheck2 },
        { label: 'البلاغات المفتوحة', value: overview.openReports, icon: Flag },
      ]
    : [];

  return (
    <main
      className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground"
      dir="rtl"
    >
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 pb-4 dark:border-slate-700/70">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account" aria-label="العودة إلى حسابي">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-blue-600 text-white">
              <Store className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">
                {isModeratorOnly ? 'لوحة المشرف' : 'لوحة الإدارة'}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                إدارة أقسام سوق حمد
              </p>
            </div>
          </div>
        </header>

        {adminAccessNotice && (
          <p className="py-3 text-sm text-muted-foreground">
            {adminAccessNotice}
          </p>
        )}

        {isAdminAccessChecking && (
          <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
            جار التحقق من الصلاحية...
          </div>
        )}

        {isAdminAccessAllowed && (
          <>
          {canManageUsers && (
            <section aria-label="إحصائيات الإدارة" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {statisticCards.map((statistic) => {
                const Icon = statistic.icon;
                return (
                  <div key={statistic.label} className="min-w-0 border-b border-slate-300/70 px-1 py-4 dark:border-slate-700/70">
                    <div className="flex items-center gap-2 text-muted-foreground"><Icon className="size-4" /><span className="truncate text-xs">{statistic.label}</span></div>
                    <div className="mt-2 text-2xl font-bold">{new Intl.NumberFormat('ar-SA').format(statistic.value)}</div>
                  </div>
                );
              })}
              {!overview && !overviewNotice && <p className="col-span-full py-4 text-sm text-muted-foreground">جار تحميل الإحصائيات...</p>}
              {overviewNotice && <p className="col-span-full py-4 text-sm text-red-700 dark:text-red-300">{overviewNotice}</p>}
            </section>
          )}
          <nav aria-label="أقسام الإدارة" className="grid">
            {adminSections.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="group flex items-center gap-3 border-b border-slate-300/70 py-4 transition-colors last:border-b-0 hover:text-blue-700 dark:border-slate-700/70 dark:hover:text-blue-300"
              >
                <span className="grid size-10 shrink-0 place-items-center text-blue-700 dark:text-blue-300">
                  {section.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{section.label}</span>
                  <span className="mt-1 block text-xs leading-6 text-muted-foreground">
                    {section.text}
                  </span>
                </span>
                <ArrowLeft className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-1" />
              </Link>
            ))}
          </nav>
          </>
        )}
      </div>
    </main>
  );
}
