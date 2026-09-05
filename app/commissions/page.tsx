'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, Percent, Receipt, User } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import { Input } from '@ui/input';

type AuthUser = {
  id: string;
  email: string;
  name?: string;
};

type AuthSessionPayload = {
  authenticated: boolean;
  user: AuthUser | null;
};

type CommissionRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  productValue: number | null;
  commissionRatePercent: 1;
  commissionAmount: number | null;
  status: 'pending_amount' | 'due' | 'paid' | 'waived' | 'disputed';
  createdAt: string;
  updatedAt: string;
  listing: {
    title?: string;
    price?: number | 'bid' | 'negotiable';
    city?: string;
  } | null;
};

function formatMoney(value: number | null) {
  if (typeof value !== 'number') {
    return 'غير محدد';
  }

  return `${new Intl.NumberFormat('ar-SA').format(value)} ر.س`;
}

function formatStatus(status: CommissionRecord['status']) {
  const labels = {
    pending_amount: 'بانتظار قيمة البيع',
    due: 'مستحقة',
    paid: 'مدفوعة',
    waived: 'معفاة',
    disputed: 'متنازع عليها',
  };

  return labels[status];
}

export default function CommissionsPage() {
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const totalDue = useMemo(
    () =>
      commissions
        .filter((commission) => commission.status === 'due')
        .reduce((total, commission) => total + (commission.commissionAmount ?? 0), 0),
    [commissions],
  );

  const refreshCommissions = useCallback(async () => {
    setIsLoading(true);
    setNotice('');

    try {
      const [sessionResponse, commissionsResponse] = await Promise.all([
        fetch('/api/auth/session'),
        fetch('/api/marketplace/me/commissions'),
      ]);
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (!commissionsResponse.ok) {
        setCommissions([]);
        return;
      }

      const payload = (await commissionsResponse.json()) as {
        commissions?: CommissionRecord[];
      };
      setCommissions(payload.commissions ?? []);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshCommissions();
  }, [refreshCommissions]);

  const updateSaleAmount = useCallback(
    async (event: FormEvent<HTMLFormElement>, commissionId: string) => {
      event.preventDefault();
      const productValue = Number(amounts[commissionId]);

      if (!Number.isFinite(productValue) || productValue <= 0) {
        setNotice('أدخل قيمة بيع صحيحة.');
        return;
      }

      const response = await fetch(`/api/marketplace/commissions/${commissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productValue }),
      });

      if (!response.ok) {
        setNotice('تعذر تحديث قيمة البيع.');
        return;
      }

      setAmounts((current) => ({ ...current, [commissionId]: '' }));
      await refreshCommissions();
    },
    [amounts, refreshCommissions],
  );

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-5xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Percent className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">عمولات البيع</h1>
              <p className="truncate text-xs text-muted-foreground">
                عمولة 1% على البيع الذي يتم عبر الموقع
              </p>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        {!session.authenticated ? (
          <section className="grid min-h-[28rem] place-items-center rounded-md border bg-white p-6 text-center shadow-sm dark:bg-card">
            <div className="grid max-w-md gap-4">
              <Receipt className="mx-auto size-12 text-blue-600" />
              <h2 className="text-xl font-bold">سجل الدخول لعرض العمولات</h2>
              <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                <a href="/api/auth/google/start">
                  <User className="size-4" />
                  دخول Google
                </a>
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                <div className="text-xs text-muted-foreground">عمولات مستحقة</div>
                <div className="mt-1 text-2xl font-bold">{formatMoney(totalDue)}</div>
              </div>
              <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                <div className="text-xs text-muted-foreground">عدد السجلات</div>
                <div className="mt-1 text-2xl font-bold">{commissions.length}</div>
              </div>
              <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                <div className="text-xs text-muted-foreground">النسبة</div>
                <div className="mt-1 text-2xl font-bold">1%</div>
              </div>
            </section>

            {notice && (
              <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
                {notice}
              </div>
            )}

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold">
                <Receipt className="size-4 text-blue-600" />
                السجلات
              </div>

              {isLoading ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  جار تحميل العمولات...
                </div>
              ) : commissions.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
                  لا توجد عمولات حتى الآن.
                </div>
              ) : (
                <div className="grid gap-3">
                  {commissions.map((commission) => (
                    <article key={commission.id} className="grid gap-3 rounded-md border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="text-base font-bold">
                            {commission.listing?.title ?? 'إعلان غير متاح'}
                          </h2>
                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>قيمة البيع: {formatMoney(commission.productValue)}</span>
                            <span>العمولة: {formatMoney(commission.commissionAmount)}</span>
                            <span>{formatStatus(commission.status)}</span>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                          <BadgeCheck className="size-3.5" />
                          {commission.commissionRatePercent}%
                        </span>
                      </div>

                      {commission.status === 'pending_amount' && (
                        <form
                          className="grid gap-2 sm:grid-cols-[1fr_auto]"
                          onSubmit={(event) => updateSaleAmount(event, commission.id)}
                        >
                          <Input
                            inputMode="decimal"
                            min="1"
                            onChange={(event) =>
                              setAmounts((current) => ({
                                ...current,
                                [commission.id]: event.target.value,
                              }))
                            }
                            placeholder="قيمة البيع النهائية"
                            type="number"
                            value={amounts[commission.id] ?? ''}
                          />
                          <Button className="rounded-md bg-blue-600 hover:bg-blue-700">
                            تحديث العمولة
                          </Button>
                        </form>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
