/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  Megaphone,
  Star,
} from 'lucide-react';

import { getPublicSellerProfile } from '@/agent/marketplace/repository';
import { SellerAvatar } from '@/components/seller-avatar';
import { getAuthSession } from '@/lib/auth/session';
import { Button } from '@ui/button';
import { SellerProfileIdentity } from '../../sellers/[sellerId]/seller-profile-identity';

export const dynamic = 'force-dynamic';

function formatJoinDate(value: string | undefined) {
  if (!value) {
    return 'حساب سوق حمد';
  }

  return new Intl.DateTimeFormat('ar-SA', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

export default async function AccountSellerProfilePage() {
  const requestHeaders = await headers();
  const session = getAuthSession(
    new Request('https://souqhamad.local/account/seller-profile', {
      headers: requestHeaders,
    }),
  );

  if (!session) {
    redirect('/account');
  }

  const seller = await getPublicSellerProfile(session.user.id);
  const sellerName = seller?.name ?? session.user.name ?? 'عميل سوق حمد';
  const sellerPicture = seller?.picture ?? session.user.picture;
  const phoneNumber = seller?.phoneNumber ?? session.user.phoneNumber;
  const joinedAt = seller?.joinedAt;
  const publishedListingCount = seller?.publishedListingCount ?? 0;
  const ratingCount = seller?.ratingCount ?? 0;

  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid h-full min-h-0 max-w-5xl gap-2 px-1.5 py-2 sm:px-3 md:px-4 lg:px-6 lg:py-3">
        <section className="marketplace-panel flex min-h-0 flex-col overflow-hidden rounded-md border bg-white shadow-2xl shadow-slate-950/10 dark:bg-card">
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-[#f7f9fc] px-2 dark:bg-background sm:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <Button asChild variant="outline" size="icon" className="rounded-md">
                <Link href="/account">
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white dark:bg-card">
                <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.webp" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold">الملف الشخصي</h1>
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white/45 p-2 dark:bg-background/55 sm:p-3 lg:p-4">
            <section className="marketplace-home-controls shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-card">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 p-2.5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-3">
                <div className="grid size-12 place-items-center overflow-hidden rounded-md border border-white/80 bg-[#0f766e] text-base font-bold text-white shadow-sm dark:border-white/10 sm:size-14">
                  <SellerAvatar
                    alt={sellerName}
                    className="size-full object-cover"
                    picture={sellerPicture}
                  />
                </div>

                <div className="min-w-0">
                  <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate text-base font-bold sm:text-lg">{sellerName}</h2>
                    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                      <BadgeCheck className="size-3.5" />
                      موثق
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatJoinDate(joinedAt)}</span>
                    <span>{publishedListingCount} إعلان منشور</span>
                    {phoneNumber ? <span>رقم الجوال {phoneNumber}</span> : null}
                  </div>
                </div>

                <div className="col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-2 sm:col-span-1">
                  <SellerProfileIdentity compact sellerId={session.user.id} sellerName={sellerName} />
                </div>
              </div>
            </section>

            <section className="grid min-h-0 flex-1 content-start gap-3 pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-right shadow-sm dark:border-white/10 dark:bg-card">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                    <Megaphone className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-bold">الإعلانات المنشورة</div>
                    <div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
                      {publishedListingCount}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-right shadow-sm dark:border-white/10 dark:bg-card">
                  <span className="inline-flex size-9 items-center justify-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-100">
                    <Star className="size-4" />
                  </span>
                  <div>
                    <div className="text-sm font-bold">عدد التقييمات</div>
                    <div className="mt-1 text-2xl font-black text-slate-950 dark:text-white">
                      {ratingCount}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
