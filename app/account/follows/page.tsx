'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, UserPlus } from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { SellerAvatar } from '@/components/seller-avatar';
import { useAuthSession } from '@/hooks/use-auth-session';
import { Button } from '@ui/button';

type FollowPerson = {
  id: string;
  userId: string;
  name: string;
  picture?: string;
  createdAt: string;
  publishedListingCount: number;
  isFollowing: boolean;
};

type FollowsPayload = {
  following: FollowPerson[];
  followers: FollowPerson[];
  followingCount: number;
  followerCount: number;
};

function encodeSellerHref(userId: string) {
  return `/sellers/${encodeURIComponent(userId)}`;
}

function formatFollowDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function PersonAvatar({ person }: { person: FollowPerson }) {
  return (
    <div className="grid size-12 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
      <SellerAvatar alt={person.name} picture={person.picture} />
    </div>
  );
}

export default function AccountFollowsPage() {
  const { isSessionLoading, session } = useAuthSession();
  const [follows, setFollows] = useState<FollowsPayload>({
    following: [],
    followers: [],
    followingCount: 0,
    followerCount: 0,
  });
  const [activeTab, setActiveTab] = useState<'followers' | 'following'>(
    'followers',
  );
  const [isLoading, setIsLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);

  const refreshFollows = useCallback(async () => {
    setIsLoading(true);

    try {
      if (!session.authenticated) {
        setFollows({
          following: [],
          followers: [],
          followingCount: 0,
          followerCount: 0,
        });
        return;
      }

      const followsResponse = await fetch('/api/marketplace/me/follows', {
        cache: 'no-store',
      });

      if (!followsResponse.ok) {
        return;
      }

      setFollows((await followsResponse.json()) as FollowsPayload);
    } finally {
      setIsLoading(false);
    }
  }, [session.authenticated]);

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    if (isSessionLoading) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        if (session.authenticated) {
          void refreshFollows();
          return;
        }

        setFollows({
          following: [],
          followers: [],
          followingCount: 0,
          followerCount: 0,
        });
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isSessionLoading, refreshFollows, session.authenticated]);

  const toggleFollow = useCallback(async (userId: string) => {
    setPendingUserId(userId);

    try {
      const response = await fetch(
        `/api/marketplace/users/${encodeURIComponent(userId)}/follow`,
        {
          method: 'POST',
          headers: {
            'Idempotency-Key': `account-follows:${crypto.randomUUID()}`,
          },
        },
      );

      if (response.ok) {
        await refreshFollows();
      }
    } finally {
      setPendingUserId(null);
    }
  }, [refreshFollows]);

  const visiblePeople =
    activeTab === 'followers' ? follows.followers : follows.following;

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-3xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/account">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold">قائمة المتابعة</h1>
            </div>
          </div>
          <ThemeToggle language="ar" />
        </header>

        {!isSessionLoading && !isLoading && !session.authenticated ? (
          <section className="grid min-h-[28rem] place-items-center p-6 text-center">
            <div className="grid max-w-sm gap-3">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <UserPlus className="size-7" />
              </div>
              <h2 className="text-lg font-bold">سجل الدخول لعرض قائمة المتابعة</h2>
              <Button asChild className="rounded-md bg-blue-600 hover:bg-blue-700">
                <a href="/api/auth/google/start">دخول</a>
              </Button>
            </div>
          </section>
        ) : (
          <>
            <section className="grid gap-3 px-1 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-2">
              <div className="grid size-16 place-items-center overflow-hidden rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <SellerAvatar
                  alt={session.user?.name ?? 'حساب سوق حمد'}
                  picture={session.user?.picture}
                />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold">
                  {session.user?.name ?? 'حساب سوق حمد'}
                </h2>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {session.user?.email}
                </p>
              </div>
              <div className="flex items-center gap-4 text-sm font-semibold text-muted-foreground">
                <span>{follows.followerCount} متابع</span>
                <span>{follows.followingCount} متابعة</span>
              </div>
            </section>

            <div className="grid grid-cols-2 overflow-hidden rounded-md bg-white/50 p-1 dark:bg-card/30">
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                  activeTab === 'followers'
                    ? 'bg-blue-600 text-white'
                    : 'text-muted-foreground hover:bg-blue-500/10'
                }`}
                onClick={() => setActiveTab('followers')}
              >
                المتابعون
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-2 text-sm font-bold transition ${
                  activeTab === 'following'
                    ? 'bg-blue-600 text-white'
                    : 'text-muted-foreground hover:bg-blue-500/10'
                }`}
                onClick={() => setActiveTab('following')}
              >
                المتابَعون
              </button>
            </div>

            <section className="grid gap-2">
              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  جار تحميل القائمة...
                </p>
              ) : visiblePeople.length ? (
                visiblePeople.map((person) => (
                  <div
                    key={`${activeTab}:${person.userId}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-200/70 p-3 last:border-b-0 dark:border-white/10"
                  >
                    <Link href={encodeSellerHref(person.userId)}>
                      <PersonAvatar person={person} />
                    </Link>
                    <Link className="min-w-0" href={encodeSellerHref(person.userId)}>
                      <h3 className="truncate text-sm font-bold">{person.name}</h3>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {person.publishedListingCount} إعلان · {formatFollowDate(person.createdAt)}
                      </p>
                    </Link>
                    <Button
                      variant={person.isFollowing ? 'outline' : 'default'}
                      size="sm"
                      className="rounded-md"
                      disabled={pendingUserId === person.userId || person.userId === session.user?.id}
                      onClick={() => void toggleFollow(person.userId)}
                    >
                      {person.isFollowing ? 'إلغاء' : 'متابعة'}
                    </Button>
                  </div>
                ))
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  لا توجد حسابات في هذه القائمة.
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
