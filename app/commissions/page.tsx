'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Check,
  Copy,
  CreditCard,
  FileText,
  Percent,
  Receipt,
  User,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useSmartstoreRealtime } from '@/lib/realtime/use-smartstore-realtime';
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

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

type CommissionPaymentMethod = {
  id: 'alrajhi' | 'snb' | 'stc-pay';
  name: string;
  subtitle: string;
  logoLabel: string;
  fields: Array<{
    label: string;
    value: string;
    copyValue: string;
  }>;
};

function getPaymentMethodTheme(methodId: CommissionPaymentMethod['id']) {
  if (methodId === 'alrajhi') {
    return {
      card: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-400/20 dark:bg-emerald-400/5',
      logo: 'bg-emerald-600 text-white',
      chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200',
    };
  }

  if (methodId === 'snb') {
    return {
      card: 'border-teal-200 bg-teal-50/80 dark:border-teal-400/20 dark:bg-teal-400/5',
      logo: 'bg-teal-700 text-white',
      chip: 'bg-teal-100 text-teal-800 dark:bg-teal-400/10 dark:text-teal-200',
    };
  }

  return {
    card: 'border-violet-200 bg-violet-50/80 dark:border-violet-400/20 dark:bg-violet-400/5',
    logo: 'bg-violet-700 text-white',
    chip: 'bg-violet-100 text-violet-800 dark:bg-violet-400/10 dark:text-violet-200',
  };
}

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

function createClientIdempotencyKey(scope: string) {
  return `${scope}:${crypto.randomUUID()}`;
}

export default function CommissionsPage() {
  const [session, setSession] = useState<AuthSessionPayload>({
    authenticated: false,
    user: null,
  });
  const [commissions, setCommissions] = useState<CommissionRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<
    CommissionPaymentMethod[]
  >([]);
  const [commissionsPagination, setCommissionsPagination] =
    useState<PaginationMeta | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [copiedPaymentValue, setCopiedPaymentValue] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const updateRequestKeysRef = useRef<Record<string, string>>({});

  const totalDue = useMemo(
    () =>
      commissions
        .filter((commission) => commission.status === 'due')
        .reduce((total, commission) => total + (commission.commissionAmount ?? 0), 0),
    [commissions],
  );

  const refreshCommissions = useCallback(async (page = 1) => {
    setIsLoading(true);
    setNotice('');

    try {
      const [sessionResponse, commissionsResponse, paymentMethodsResponse] =
        await Promise.all([
          fetch('/api/auth/session', { cache: 'no-store' }),
          fetch(`/api/marketplace/me/commissions?page=${page}&limit=20`, {
            cache: 'no-store',
          }),
          fetch('/api/marketplace/commission-payment-methods', {
            cache: 'no-store',
          }),
        ]);
      const nextSession =
        (await sessionResponse.json()) as AuthSessionPayload;
      setSession(nextSession);

      if (paymentMethodsResponse.ok) {
        const paymentMethodsPayload = (await paymentMethodsResponse.json()) as {
          paymentMethods?: CommissionPaymentMethod[];
        };
        setPaymentMethods(paymentMethodsPayload.paymentMethods ?? []);
      } else {
        setPaymentMethods([]);
      }

      if (!commissionsResponse.ok) {
        setCommissions([]);
        return;
      }

      const payload = (await commissionsResponse.json()) as {
        commissions?: CommissionRecord[];
        pagination?: PaginationMeta;
      };
      setCommissions((currentCommissions) =>
        page === 1
          ? (payload.commissions ?? [])
          : [...currentCommissions, ...(payload.commissions ?? [])],
      );
      setCommissionsPagination(payload.pagination ?? null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    void refreshCommissions();
  }, [refreshCommissions]);

  useSmartstoreRealtime({
    enabled: session.authenticated,
    fallbackIntervalMs: 4000,
    eventTypes: ['commission_updated', 'maintenance_cleanup'],
    onEvent: () => {
      void refreshCommissions(1);
    },
    onResync: ({ reason }) => {
      if (reason === 'event' || !session.authenticated) {
        return;
      }

      return refreshCommissions(1);
    },
  });

  const commissionsLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(commissionsPagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void refreshCommissions(commissionsPagination?.nextPage ?? 1);
    },
  });

  const updateSaleAmount = useCallback(
    async (event: FormEvent<HTMLFormElement>, commissionId: string) => {
      event.preventDefault();
      const productValue = Number(amounts[commissionId]);

      if (!Number.isFinite(productValue) || productValue <= 0) {
        setNotice('أدخل قيمة بيع صحيحة.');
        return;
      }

      const requestKey =
        updateRequestKeysRef.current[commissionId] ??
        createClientIdempotencyKey('commission-update');
      updateRequestKeysRef.current[commissionId] = requestKey;

      try {
      const response = await fetch(`/api/marketplace/commissions/${commissionId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': requestKey,
        },
        body: JSON.stringify({ productValue }),
      });

      if (!response.ok) {
        setNotice('تعذر تحديث قيمة البيع.');
        return;
      }

      setAmounts((current) => ({ ...current, [commissionId]: '' }));
      await refreshCommissions();
      } finally {
      delete updateRequestKeysRef.current[commissionId];
      }
    },
    [amounts, refreshCommissions],
  );

  const copyPaymentValue = useCallback(async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPaymentValue(value);
      setNotice('تم نسخ بيانات الدفع.');

      window.setTimeout(() => {
        setCopiedPaymentValue((currentValue) =>
          currentValue === value ? '' : currentValue,
        );
      }, 1800);
    } catch {
      setNotice('تعذر نسخ بيانات الدفع. يمكنك تحديد الرقم ونسخه يدوياً.');
    }
  }, []);

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
              <Button asChild className="rounded-md bg-[#111827] text-white hover:bg-[#111827]/90">
                <a href="/api/auth/apple/start">
                  <User className="size-4" />
                  دخول Apple
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

            <section className="grid gap-4 rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                    <CreditCard className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">طرق دفع العمولة</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      اختر الجهة المناسبة وحوّل عمولة البيع، ثم احتفظ بصورة الإيصال للمراجعة.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                    عمولة 1%
                  </span>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-md text-xs"
                  >
                    <Link href="/commission-policy">
                      <FileText className="size-3.5" />
                      سياسة العمولة
                    </Link>
                  </Button>
                </div>
              </div>

              {paymentMethods.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  لم يتم إعداد بيانات دفع العمولة بعد.
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-3">
                  {paymentMethods.map((method) => {
                    const theme = getPaymentMethodTheme(method.id);

                    return (
                      <article
                        key={method.id}
                        className={`grid gap-3 rounded-md border p-3 ${theme.card}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold">{method.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {method.subtitle}
                            </div>
                          </div>
                          <div
                            className={`grid min-h-10 min-w-16 place-items-center rounded-md px-3 text-xs font-black ${theme.logo}`}
                          >
                            {method.logoLabel}
                          </div>
                        </div>

                        <div className="grid gap-2">
                          {method.fields.map((field) => (
                            <div
                              key={`${method.id}-${field.label}`}
                              className="rounded-md bg-white/75 p-2 dark:bg-background/40"
                            >
                              <div className="text-[11px] font-semibold text-muted-foreground">
                                {field.label}
                              </div>
                              <div className="mt-1 flex items-center justify-between gap-2">
                                <span
                                  className="min-w-0 break-all text-sm font-bold"
                                  dir="ltr"
                                >
                                  {field.value}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className={`h-8 w-8 shrink-0 rounded-md ${theme.chip}`}
                                  onClick={() => void copyPaymentValue(field.copyValue)}
                                  title="نسخ"
                                >
                                  {copiedPaymentValue === field.copyValue ? (
                                    <Check className="size-4" />
                                  ) : (
                                    <Copy className="size-4" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold">
                <Receipt className="size-4 text-blue-600" />
                السجلات
              </div>

              {isLoading && commissions.length === 0 ? (
                <div className="grid min-h-56 place-items-center text-sm text-muted-foreground">
                  جار تحميل العمولات...
                </div>
              ) : commissions.length === 0 ? (
                <div className="grid min-h-56 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">
                  لا توجد عمولات حتى الآن.
                </div>
              ) : (
                <div className="grid gap-4">
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
                  <div ref={commissionsLoadMoreRef} className="h-px" />
                  {commissionsPagination?.hasMore && (
                    <Button
                      variant="outline"
                      className="mx-auto rounded-md"
                      disabled={isLoading}
                      onClick={() =>
                        void refreshCommissions(
                          commissionsPagination.nextPage ?? 1,
                        )
                      }
                    >
                      {isLoading ? 'جارٍ التحميل...' : 'تحميل المزيد'}
                    </Button>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
