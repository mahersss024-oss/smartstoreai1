'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, BadgeCheck, Megaphone, Star } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { SellerAvatar } from '../../components/seller-avatar';
import { SellerProfileIdentity } from '../../app/sellers/[sellerId]/seller-profile-identity';
import { Button } from '../../components/ui/button';
import { useAuthSession } from '../../hooks/use-auth-session';
import MobileLink from './link';

type SellerStats = {
  id: string;
  name: string;
  picture?: string;
  joinedAt?: string;
  publishedListingCount: number;
  ratingCount: number;
};

function AccountSellerProfileFrame({ children }: { children: ReactNode }) {
  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid h-full min-h-0 max-w-5xl gap-2 px-1.5 py-2 sm:px-3 md:px-4 lg:px-6 lg:py-3">
        <section className="marketplace-panel flex min-h-0 flex-col overflow-hidden rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-[#f7f9fc] px-2 dark:bg-background sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="outline" size="icon" className="rounded-md">
                <MobileLink href="/account" aria-label="العودة إلى الحساب"><ArrowRight className="size-4" /></MobileLink>
              </Button>
              <div className="min-w-0"><h1 className="truncate text-base font-bold">الملف الشخصي</h1></div>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/45 p-2 dark:bg-background/55 sm:p-3 lg:p-4">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

export function MobileAccountSellerProfile() {
  const router = useRouter();
  const { isSessionLoading, session } = useAuthSession();
  const [seller, setSeller] = useState<SellerStats | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const user = session.user;

  useEffect(() => {
    if (isSessionLoading) return;
    if (!user) {
      router.replace('/account');
      return;
    }

    let cancelled = false;
    fetch('/api/marketplace/users/' + encodeURIComponent(user.id) + '/profile', {
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('seller profile unavailable');
        return response.json() as Promise<{ seller: SellerStats }>;
      })
      .then((payload) => {
        if (!cancelled) setSeller(payload.seller);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isSessionLoading, router.replace, user?.id]);

  if (isSessionLoading || (!seller && !loadFailed)) {
    return (
      <AccountSellerProfileFrame>
        <section className="marketplace-home-controls shrink-0 animate-pulse overflow-hidden rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-card">
          <div className="flex items-center gap-3"><div className="size-12 rounded-md bg-slate-200 dark:bg-slate-700" /><div className="grid flex-1 gap-2"><div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" /><div className="h-3 w-48 max-w-full rounded bg-slate-100 dark:bg-slate-800" /></div></div>
        </section>
        <section className="grid min-h-0 flex-1 content-start gap-3 pt-3">
          <div className="grid gap-2 sm:grid-cols-2">{[0, 1].map((item) => <div key={item} className="grid h-28 animate-pulse gap-3 rounded-md border bg-white p-3 dark:border-white/10 dark:bg-card"><div className="size-9 rounded-md bg-slate-200 dark:bg-slate-700" /><div className="h-4 w-32 rounded bg-slate-100 dark:bg-slate-800" /></div>)}</div>
        </section>
      </AccountSellerProfileFrame>
    );
  }

  if (loadFailed || !seller || !user) {
    return (
      <AccountSellerProfileFrame>
        <section className="m-auto grid max-w-sm justify-items-center gap-3 rounded-md border bg-card p-5 text-center">
          <h1 className="font-bold">تعذّر تحميل الملف الشخصي</h1>
          <MobileLink className="text-blue-700 underline dark:text-blue-300" href="/account">العودة إلى حسابي</MobileLink>
        </section>
      </AccountSellerProfileFrame>
    );
  }

  const displayName = seller.name || user.name || 'عميل سوق حمد';
  const joinedAt = seller.joinedAt
    ? new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' }).format(new Date(seller.joinedAt))
    : 'عضو في سوق حمد';

  return (
    <AccountSellerProfileFrame>
            <section className="marketplace-home-controls shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-card">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-3">
              <div className="grid size-12 place-items-center overflow-hidden rounded-md border border-white/80 bg-[#0f766e] text-base font-bold text-white shadow-sm dark:border-white/10 sm:size-14">
                <SellerAvatar alt={displayName} className="size-full object-cover" picture={seller.picture || user.picture} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-bold">{displayName}</h2>
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                    <BadgeCheck className="size-3.5" /> موثّق
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{joinedAt}</span>
                  <span>{seller.publishedListingCount} إعلان منشور</span>
                  {user.phoneNumber ? <span>رقم الجوال {user.phoneNumber}</span> : null}
                </div>
              </div>
              <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-2 sm:col-span-1">
                <SellerProfileIdentity compact sellerId={seller.id} sellerName={displayName} />
              </div>
              </div>
            </section>
            <section className="grid min-h-0 flex-1 content-start gap-3 pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-right shadow-sm dark:border-white/10 dark:bg-card">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200"><Megaphone className="size-4" /></span>
                  <div><div className="text-sm font-bold">الإعلانات المنشورة</div><div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{seller.publishedListingCount}</div></div>
                </div>
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-right shadow-sm dark:border-white/10 dark:bg-card">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-100"><Star className="size-4" /></span>
                  <div><div className="text-sm font-bold">عدد التقييمات</div><div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">{seller.ratingCount}</div></div>
                </div>
              </div>
            </section>
    </AccountSellerProfileFrame>
  );
}
