'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  Flag,
  ImageIcon,
  Megaphone,
  MessageCircle,
  Percent,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
import { Button } from '@ui/button';
import { useAdminAccess } from './use-admin-access';

type OverviewPayload = {
  totals: {
    users: number;
    listings: number;
    images: number;
    conversations: number;
    messages: number;
    favorites: number;
    reports: number;
    commissions: number;
    adminActions: number;
  };
  statuses: {
    listings: Record<string, number>;
    images: Record<string, number>;
    reports: Record<string, number>;
    commissions: Record<string, number>;
  };
  money: {
    dueCommissions: number;
    paidCommissions: number;
  };
  visits: {
    today: { visits: number; uniqueVisitors: number };
    last7Days: { visits: number; uniqueVisitors: number };
    last30Days: { visits: number; uniqueVisitors: number };
  };
};

type ModeratorOverviewPayload = {
  totals: {
    listings: number;
    images: number;
    reports: number;
    openReports: number;
    openListingReports: number;
    openUserReports: number;
  };
  statuses: {
    listings: Record<string, number>;
    images: Record<string, number>;
    reports: Record<string, number>;
  };
};

const statusLabels: Record<string, string> = {
  approved: 'معتمدة',
  deleted: 'محذوفة',
  draft: 'مسودة',
  due: 'مستحقة',
  dismissed: 'مغلقة',
  disputed: 'متنازع عليها',
  needs_retake: 'تحتاج إعادة تصوير',
  open: 'مفتوحة',
  paid: 'مدفوعة',
  paused: 'موقوفة',
  pending: 'قيد المراجعة',
  pending_amount: 'بانتظار قيمة البيع',
  pending_review: 'قيد مراجعة الصورة',
  published: 'منشورة',
  rejected: 'مرفوضة',
  reviewed: 'مراجعة',
  sold: 'مباعة',
  waived: 'معفاة',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

function formatMoney(value: number) {
  return `${formatNumber(value)} ر.س`;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
          {icon}
        </div>
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function StatusBlock({
  title,
  statuses,
}: {
  title: string;
  statuses: Record<string, number>;
}) {
  const entries = Object.entries(statuses).sort((left, right) =>
    left[0].localeCompare(right[0]),
  );

  return (
    <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
      <h2 className="mb-3 text-sm font-bold">{title}</h2>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          لا توجد بيانات.
        </div>
      ) : (
        <div className="grid gap-2">
          {entries.map(([status, count]) => (
            <div
              key={status}
              className="flex items-center justify-between gap-3 rounded-md bg-[#f7f9fc] px-3 py-2 text-sm dark:bg-background"
            >
              <span>{statusLabels[status] ?? status}</span>
              <span className="font-bold">{formatNumber(count)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AdminHomePage() {
  const router = useRouter();
  const {
    adminAccessNotice,
    adminAccessRole,
    isAdminAccessAllowed,
    verifyAdminAccess,
  } = useAdminAccess('moderator');
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [moderatorOverview, setModeratorOverview] =
    useState<ModeratorOverviewPayload | null>(null);
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadOverview = useCallback(async () => {
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        setOverview(null);
        setModeratorOverview(null);
        return;
      }
    } catch {
      setIsLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/admin/overview', {
        cache: 'no-store',
      });

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 403) {
        // Appointed moderators cannot read the full admin overview; fall back
        // to the scoped moderator overview they are allowed to see.
        const moderatorResponse = await fetch('/api/moderator/overview', {
          cache: 'no-store',
        });

        if (moderatorResponse.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (moderatorResponse.ok) {
          setOverview(null);
          setModeratorOverview(
            (await moderatorResponse.json()) as ModeratorOverviewPayload,
          );
          return;
        }

        setNotice('هذه الصفحة مخصصة للفريق الإداري فقط.');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحميل لوحة الإدارة.');
        return;
      }

      setModeratorOverview(null);
      setOverview((await response.json()) as OverviewPayload);
    } finally {
      setIsLoading(false);
    }
  }, [router, verifyAdminAccess]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void loadOverview();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadOverview]);

  useSmartstoreRealtime({
    enabled: isAdminAccessAllowed,
    fallbackIntervalMs: 4000,
    eventTypes: [
      'ad_created',
      'ad_updated',
      'ad_deleted',
      'ad_status_changed',
      'message_created',
      'conversation_updated',
      'commission_updated',
      'moderation_updated',
      'maintenance_cleanup',
    ],
    onEvent: () => {
      void loadOverview();
    },
    onResync: ({ reason }) => {
      if (reason === 'event') {
        return;
      }

      return loadOverview();
    },
  });

  const isOwner = adminAccessRole === 'owner';
  const isModeratorOnly = adminAccessRole === 'moderator';
  const canManageUsers = adminAccessRole === 'owner' || adminAccessRole === 'admin';
  const canManageCommissions = isOwner;

  const quickLinks = useMemo(() => {
    const links = [
      {
        href: '/admin/listings',
        icon: <Megaphone className="size-4" />,
        label: 'إدارة الإعلانات',
        text: 'تعديل، إيقاف، نشر، بيع، أو حذف الإعلانات.',
        visible: true,
      },
      {
        href: '/admin/moderation',
        icon: <ShieldCheck className="size-4" />,
        label: 'المراجعة والبلاغات',
        text: 'اعتماد الإعلانات الحساسة ومراجعة البلاغات.',
        visible: true,
      },
      {
        href: '/admin/users',
        icon: <Users className="size-4" />,
        label: 'إدارة المستخدمين',
        text: 'عرض العملاء، بيانات التواصل الرسمية، الأدوار، ونشاط الحسابات.',
        visible: canManageUsers,
      },
      {
        href: '/admin/commissions',
        icon: <Percent className="size-4" />,
        label: 'إدارة العمولات',
        text: 'تحديث حالة العمولة أو حذف سجل عمولة.',
        visible: canManageCommissions,
      },
      {
        href: '/admin/maintenance',
        icon: <Trash2 className="size-4" />,
        label: 'الصيانة والتنظيف',
        text: 'تنظيف بيانات التجربة بعد معاينة الأعداد.',
        visible: isOwner,
      },
    ];

    return links.filter((link) => link.visible);
  }, [canManageCommissions, canManageUsers, isOwner]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Store className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">
                {isModeratorOnly ? 'لوحة المشرف' : 'لوحة المالك'}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {isModeratorOnly
                  ? 'مراجعة الإعلانات والبلاغات حسب صلاحياتك'
                  : 'إحصائيات وصلاحيات إدارة SmartStore AI'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-md" onClick={() => void loadOverview()}>
              تحديث
            </Button>
            <ThemeToggle language="ar" />
          </div>
        </header>

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        {isLoading ||
        (!overview && !moderatorOverview && !adminAccessNotice && !notice) ? (
          <section className="grid min-h-80 place-items-center rounded-md border bg-white text-sm text-muted-foreground shadow-sm dark:bg-card">
            {isModeratorOnly ? 'جار تحميل لوحة المشرف...' : 'جار تحميل لوحة المالك...'}
          </section>
        ) : moderatorOverview ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<Flag className="size-4" />} label="البلاغات المفتوحة" value={formatNumber(moderatorOverview.totals.openReports)} />
              <StatCard icon={<Flag className="size-4" />} label="بلاغات الإعلانات المفتوحة" value={formatNumber(moderatorOverview.totals.openListingReports)} />
              <StatCard icon={<MessageCircle className="size-4" />} label="بلاغات المحادثات المفتوحة" value={formatNumber(moderatorOverview.totals.openUserReports)} />
              <StatCard icon={<Megaphone className="size-4" />} label="قيد المراجعة (إعلانات)" value={formatNumber((moderatorOverview.statuses.listings.pending ?? 0) + (moderatorOverview.statuses.listings.rejected ?? 0))} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard icon={<Megaphone className="size-4" />} label="كل الإعلانات" value={formatNumber(moderatorOverview.totals.listings)} />
              <StatCard icon={<ImageIcon className="size-4" />} label="صور الإعلانات" value={formatNumber(moderatorOverview.totals.images)} />
              <StatCard icon={<Flag className="size-4" />} label="إجمالي البلاغات" value={formatNumber(moderatorOverview.totals.reports)} />
            </section>

            <section className="grid gap-3 lg:grid-cols-4">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="grid gap-2 rounded-md border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 dark:bg-card dark:hover:bg-blue-400/10"
                >
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {link.icon}
                    {link.label}
                  </div>
                  <p className="text-xs leading-6 text-muted-foreground">{link.text}</p>
                </Link>
              ))}
            </section>

            <section className="grid gap-3 lg:grid-cols-3">
              <StatusBlock title="حالات الإعلانات" statuses={moderatorOverview.statuses.listings} />
              <StatusBlock title="حالات الصور" statuses={moderatorOverview.statuses.images} />
              <StatusBlock title="حالات البلاغات" statuses={moderatorOverview.statuses.reports} />
            </section>
          </>
        ) : !overview ? (
          <section className="grid min-h-80 place-items-center rounded-md border bg-white text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<Users className="size-4" />} label="زيارات اليوم" value={formatNumber(overview.visits.today.visits)} />
              <StatCard icon={<UserRound className="size-4" />} label="زوار اليوم الفريدون" value={formatNumber(overview.visits.today.uniqueVisitors)} />
              <StatCard icon={<BarChart3 className="size-4" />} label="زيارات آخر 7 أيام" value={formatNumber(overview.visits.last7Days.visits)} />
              <StatCard icon={<Users className="size-4" />} label="زوار آخر 30 يوم" value={formatNumber(overview.visits.last30Days.uniqueVisitors)} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={<UserRound className="size-4" />} label="المستخدمون المسجلون" value={formatNumber(overview.totals.users)} />
              <StatCard icon={<Megaphone className="size-4" />} label="كل الإعلانات" value={formatNumber(overview.totals.listings)} />
              <StatCard icon={<ImageIcon className="size-4" />} label="صور الإعلانات" value={formatNumber(overview.totals.images)} />
              <StatCard icon={<MessageCircle className="size-4" />} label="المحادثات" value={formatNumber(overview.totals.conversations)} />
              <StatCard icon={<MessageCircle className="size-4" />} label="الرسائل" value={formatNumber(overview.totals.messages)} />
              <StatCard icon={<Flag className="size-4" />} label="البلاغات" value={formatNumber(overview.totals.reports)} />
              <StatCard icon={<Percent className="size-4" />} label="العمولات" value={formatNumber(overview.totals.commissions)} />
              <StatCard icon={<ShieldCheck className="size-4" />} label="إجراءات الإدارة" value={formatNumber(overview.totals.adminActions)} />
            </section>

            <section className="grid gap-3 sm:grid-cols-2">
              <StatCard icon={<Percent className="size-4" />} label="إجمالي العمولات المستحقة" value={formatMoney(overview.money.dueCommissions)} />
              <StatCard icon={<Percent className="size-4" />} label="إجمالي العمولات المدفوعة" value={formatMoney(overview.money.paidCommissions)} />
            </section>

            <section className="grid gap-3 lg:grid-cols-4">
              {quickLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="grid gap-2 rounded-md border bg-white p-4 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 dark:bg-card dark:hover:bg-blue-400/10"
                >
                  <div className="flex items-center gap-2 text-sm font-bold">
                    {link.icon}
                    {link.label}
                  </div>
                  <p className="text-xs leading-6 text-muted-foreground">{link.text}</p>
                </Link>
              ))}
            </section>

            <section className="grid gap-3 lg:grid-cols-4">
              <StatusBlock title="حالات الإعلانات" statuses={overview.statuses.listings} />
              <StatusBlock title="حالات الصور" statuses={overview.statuses.images} />
              <StatusBlock title="حالات البلاغات" statuses={overview.statuses.reports} />
              <StatusBlock title="حالات العمولات" statuses={overview.statuses.commissions} />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
