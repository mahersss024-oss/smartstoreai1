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
  deletedListings: number;
  deletedListingImages: number;
  closedReports: number;
  closedUserReports: number;
  searchStates: number;
  idempotencyKeys: number;
};

type CleanupScope =
  | 'closed_reports'
  | 'closed_user_reports'
  | 'search_state'
  | 'purge_deleted_listings';

const cleanupScopes: Array<{
  value: CleanupScope;
  label: string;
  description: string;
}> = [
  {
    value: 'closed_reports',
    label: 'حذف بلاغات الإعلانات المغلقة',
    description: 'يحذف بلاغات الإعلانات التي تمت مراجعتها أو إغلاقها فقط.',
  },
  {
    value: 'closed_user_reports',
    label: 'حذف بلاغات المستخدمين المغلقة',
    description: 'يحذف بلاغات المستخدمين التي تمت مراجعتها أو إغلاقها فقط.',
  },
  {
    value: 'search_state',
    label: 'تنظيف ذاكرة البحث والطلبات',
    description: 'يحذف ذاكرة البحث المؤقتة ومفاتيح منع تكرار الطلبات.',
  },
  {
    value: 'purge_deleted_listings',
    label: 'حذف نهائي للإعلانات المحذوفة من العملاء',
    description:
      'يحذف نهائيًا الإعلانات التي حالتها محذوفة فقط، مع صورها من التخزين وما يرتبط بها. لا يمس الإعلانات الحية.',
  },
];

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

function getCleanupPreview(scope: CleanupScope, counts: MaintenanceCounts) {
  const previews: Record<CleanupScope, Array<[string, number]>> = {
    closed_reports: [
      ['بلاغات الإعلانات المغلقة التي ستُحذف', counts.closedReports],
    ],
    closed_user_reports: [
      ['بلاغات المحادثات المغلقة التي ستُحذف', counts.closedUserReports],
    ],
    search_state: [
      ['سجلات البحث المؤقتة', counts.searchStates],
      ['مفاتيح الطلبات القديمة', counts.idempotencyKeys],
    ],
    purge_deleted_listings: [
      ['الإعلانات المحذوفة نهائيًا', counts.deletedListings],
      ['الصور التي ستُراجع للحذف', counts.deletedListingImages],
    ],
  };

  return previews[scope];
}

export default function AdminMaintenancePage() {
  const router = useRouter();
  const { adminAccessNotice, verifyAdminAccess } = useAdminAccess('owner');
  const [counts, setCounts] = useState<MaintenanceCounts | null>(null);
  const [scope, setScope] = useState<CleanupScope>('closed_reports');
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  const selectedScope = useMemo(
    () => cleanupScopes.find((option) => option.value === scope),
    [scope],
  );
  const cleanupPreview = useMemo(
    () => (counts ? getCleanupPreview(scope, counts) : []),
    [counts, scope],
  );

  const loadCounts = useCallback(async () => {
    setIsLoading(true);
    setNotice('');

    try {
      if (!(await verifyAdminAccess())) {
        setCounts(null);
        return;
      }

      const response = await fetch('/api/admin/maintenance', { cache: 'no-store' });

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
            'التنظيف معطل في بيئة الإنتاج. فعّل المتغير SMARTSTORE_ENABLE_ADMIN_MAINTENANCE_CLEANUP=1 ثم أعد تشغيل الخادم.',
          );
          return;
        }

        if (payload?.error === 'confirmation_required') {
          setNotice('كلمة التأكيد غير صحيحة. اكتب بالضبط: تنظيف');
          return;
        }

        if (payload?.error === 'owner_required') {
          setNotice('هذه العملية مخصصة للمالك فقط.');
          return;
        }

        if (response.status === 429) {
          setNotice('طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.');
          return;
        }

        setNotice(
          payload?.message ??
            'تعذر تنفيذ عملية التنظيف. تحقق من كلمة التأكيد وحاول مجددًا.',
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
                أدوات مالك المنصة لتنظيف البيانات وتشغيل الصيانة بأمان
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

        <section className="grid gap-4 rounded-md border border-red-500/30 bg-white p-4 shadow-sm dark:bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">تنفيذ تنظيف</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                اختر العملية، ثم راجع أثرها واكتب كلمة التأكيد: تنظيف
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-md"
              disabled={isLoading}
              onClick={() => void loadCounts()}
            >
              <RefreshCw className="size-4" />
              تحديث المعاينة
            </Button>
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

          <div className="grid gap-2 text-sm">
            <p className="text-muted-foreground">{selectedScope?.description}</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground">جار حساب أثر العملية...</p>
            ) : counts ? (
              <div className="grid gap-1.5 border-r-2 border-red-500/40 pr-3">
                {cleanupPreview.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <strong>{formatNumber(value)}</strong>
                  </div>
                ))}
              </div>
            ) : null}
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
