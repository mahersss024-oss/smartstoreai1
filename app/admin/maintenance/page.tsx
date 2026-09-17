'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { useAdminAccess } from '../use-admin-access';

type MaintenanceCounts = {
  users: number;
  listings: number;
  images: number;
  conversations: number;
  messages: number;
  favorites: number;
  reports: number;
  commissions: number;
  analyticsDays: number;
  analyticsVisitors: number;
  searchStates: number;
  idempotencyKeys: number;
};

type CleanupScope =
  | 'commissions'
  | 'conversations'
  | 'reports'
  | 'analytics'
  | 'search_state'
  | 'marketplace_without_users';

const cleanupScopes: Array<{
  value: CleanupScope;
  label: string;
  description: string;
}> = [
  {
    value: 'commissions',
    label: 'حذف العمولات',
    description: 'يحذف سجلات العمولات فقط.',
  },
  {
    value: 'conversations',
    label: 'حذف المحادثات',
    description: 'يحذف المحادثات والرسائل المرتبطة بها.',
  },
  {
    value: 'reports',
    label: 'حذف البلاغات',
    description: 'يحذف بلاغات المستخدمين فقط.',
  },
  {
    value: 'analytics',
    label: 'حذف إحصائيات الزوار',
    description: 'يحذف عدادات الزيارات والزوار الفريدين.',
  },
  {
    value: 'search_state',
    label: 'تنظيف ذاكرة البحث والطلبات',
    description: 'يحذف ذاكرة البحث المؤقتة ومفاتيح منع التكرار.',
  },
  {
    value: 'marketplace_without_users',
    label: 'تنظيف السوق مع إبقاء المستخدمين',
    description: 'يحذف الإعلانات وما يتبعها من صور ومحادثات ومفضلات وبلاغات وعمولات.',
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

export default function AdminMaintenancePage() {
  const router = useRouter();
  const {
    adminAccessNotice,
    verifyAdminAccess,
  } = useAdminAccess('admin');
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [scope, setScope] = useState<CleanupScope>('commissions');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  const selectedScope = useMemo(
    () => cleanupScopes.find((option) => option.value === scope),
    [scope],
  );

  const loadCounts = useCallback(async () => {
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        setCounts(null);
        return;
      }

      const response = await fetch('/api/admin/maintenance');

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (response.status === 403) {
        setNotice('هذه الصفحة مخصصة للمالك فقط.');
        return;
      }

      if (!response.ok) {
        setNotice('تعذر تحميل أعداد الصيانة.');
        return;
      }

      const payload = (await response.json()) as { counts: MaintenanceCounts };
      setCounts(payload.counts);
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
        void loadCounts();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadCounts]);

  const runCleanup = useCallback(async () => {
    setIsRunning(true);
    setNotice('');

    try {
      const response = await fetch('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, confirmation }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { counts?: MaintenanceCounts; error?: string; message?: string }
        | null;

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (payload?.error === 'maintenance_cleanup_disabled') {
          setNotice(
            'التنظيف معطّل في بيئة الإنتاج. فعّل المتغير SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP=1 ثم أعد تشغيل الخادم.',
          );
          return;
        }

        if (payload?.error === 'confirmation_required') {
          setNotice('كلمة التأكيد غير صحيحة. اكتب بالضبط: تنظيف');
          return;
        }

        if (payload?.error === 'admin_required') {
          setNotice('هذه العملية مخصصة للمالك فقط.');
          return;
        }

        if (response.status === 429) {
          setNotice('طلبات كثيرة جدًا. انتظر قليلاً ثم أعد المحاولة.');
          return;
        }

        setNotice(
          payload?.message ??
            'تعذّر تنفيذ عملية التنظيف. تحقق من كلمة التأكيد وحاول مجددًا.',
        );
        return;
      }

      if (payload?.counts) {
        setCounts(payload.counts);
      }
      setConfirmation('');
      setNotice('تم تنفيذ عملية التنظيف.');
    } finally {
      setIsRunning(false);
    }
  }, [confirmation, scope, router]);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-red-50 text-red-700 dark:bg-red-400/10 dark:text-red-200">
              <ShieldAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">الصيانة والتنظيف</h1>
              <p className="truncate text-xs text-muted-foreground">
                أدوات مالك المنصة لتنظيف بيانات التجربة
              </p>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">معاينة الأعداد الحالية</h2>
            <Button variant="outline" className="rounded-md" onClick={() => void loadCounts()}>
              <RefreshCw className="size-4" />
              تحديث
            </Button>
          </div>

          {isLoading || (!counts && !adminAccessNotice && !notice) ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              جار تحميل الأعداد...
            </div>
          ) : !counts ? (
            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
              {adminAccessNotice || notice}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(counts).map(([key, value]) => (
                <div key={key} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">{key}</div>
                  <div className="mt-1 text-xl font-bold">{formatNumber(value)}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-4 rounded-md border border-red-500/30 bg-white p-4 shadow-sm dark:bg-card">
          <div>
            <h2 className="text-sm font-bold">تنفيذ تنظيف</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              اختر العملية، ثم اكتب كلمة التأكيد بالضبط: تنظيف
            </p>
          </div>

          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            name="cleanupScope"
            value={scope}
            onChange={(event) => setScope(event.target.value as CleanupScope)}
          >
            {cleanupScopes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            {selectedScope?.description}
          </div>

          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              name="cleanupConfirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="اكتب: تنظيف"
            />
            <Button
              className="rounded-md bg-red-600 hover:bg-red-700"
              disabled={isRunning || confirmation.trim() !== 'تنظيف'}
              onClick={() => void runCleanup()}
            >
              <Trash2 className="size-4" />
              تنفيذ التنظيف
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
