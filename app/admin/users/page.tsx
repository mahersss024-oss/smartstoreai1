'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  MessageCircle,
  Percent,
  Phone,
  Save,
  Search,
  ShieldCheck,
  Store,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { Button } from '@ui/button';
import { useAdminAccess } from '../use-admin-access';

type AdminUserRecord = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  phoneNumber?: string;
  phoneUpdatedAt?: string;
  role: 'user' | 'moderator' | 'admin' | string;
  deletedAt?: string;
  commissionAgreementVersion?: string;
  commissionAgreementAccepted?: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    listings: number;
    conversations: number;
    messages: number;
    favorites: number;
    reports: number;
    userReportsReceived?: number;
    commissions: number;
    pushSubscriptions: number;
  };
};

type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
  total?: number;
};

type UserDraft = {
  role: 'user' | 'moderator' | 'admin';
  phoneNumber: string;
};

const roleLabels: Record<string, string> = {
  user: 'عميل',
  moderator: 'مشرف',
  admin: 'مدير',
  owner: 'مالك المنصة',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('ar-SA').format(value);
}

function formatDate(value?: string) {
  if (!value) {
    return 'غير متوفر';
  }

  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizeRole(role: string): UserDraft['role'] {
  return role === 'admin' || role === 'moderator' ? role : 'user';
}

export default function AdminUsersPage() {
  const router = useRouter();
  const {
    adminAccessNotice,
    adminAccessRole,
    verifyAdminAccess,
  } = useAdminAccess('admin');
  const isOwner = adminAccessRole === 'owner';
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [query, setQuery] = useState('');
  const [isLinkedQueryReady, setIsLinkedQueryReady] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const totalUsers = pagination?.total ?? users.length;
  const usersWithPhone = useMemo(
    () => users.filter((user) => Boolean(user.phoneNumber)).length,
    [users],
  );

  const refreshUsers = useCallback(
    async (page = 1) => {
      setIsLoading(true);
      setNotice('');

      try {
        if (!(await verifyAdminAccess())) {
          setUsers([]);
          setPagination(null);
          return;
        }

        const params = new URLSearchParams({
          page: String(page),
          limit: '20',
          role: roleFilter,
        });

        if (isOwner) {
          params.set('includeDeleted', '1');
        }

        if (query.trim()) {
          params.set('query', query.trim());
        }

        const response = await fetch(`/api/admin/users?${params}`, {
          cache: 'no-store',
        });

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (response.status === 403) {
          setNotice('هذه الصفحة مخصصة للإدارة فقط.');
          setUsers([]);
          return;
        }

        if (!response.ok) {
          setNotice('تعذر تحميل المستخدمين.');
          return;
        }

        const payload = (await response.json()) as {
          users?: AdminUserRecord[];
          pagination?: PaginationMeta;
        };
        const nextUsers = payload.users ?? [];

        setUsers((currentUsers) =>
          page === 1 ? nextUsers : [...currentUsers, ...nextUsers],
        );
        setDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };

          for (const user of nextUsers) {
            nextDrafts[user.id] = {
              role: normalizeRole(user.role),
              phoneNumber: user.phoneNumber ?? '',
            };
          }

          return page === 1 ? nextDrafts : nextDrafts;
        });
        setPagination(payload.pagination ?? null);
      } finally {
        setIsLoading(false);
      }
    },
    [isOwner, query, roleFilter, router, verifyAdminAccess],
  );

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setQuery(
          new URLSearchParams(window.location.search).get('query')?.trim() ?? '',
        );
        setIsLinkedQueryReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isLinkedQueryReady) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void refreshUsers(1);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isLinkedQueryReady, refreshUsers]);

  const usersLoadMoreRef = useInfiniteScroll({
    enabled: Boolean(pagination?.hasMore),
    isLoading,
    onLoadMore: () => {
      void refreshUsers(pagination?.nextPage ?? 1);
    },
  });

  const updateDraft = useCallback(
    (userId: string, updates: Partial<UserDraft>) => {
      setDrafts((currentDrafts) => ({
        ...currentDrafts,
        [userId]: {
          role: currentDrafts[userId]?.role ?? 'user',
          phoneNumber: currentDrafts[userId]?.phoneNumber ?? '',
          ...updates,
        },
      }));
    },
    [],
  );

  const saveUser = useCallback(
    async (userId: string, phoneOverride?: string) => {
      const draft = drafts[userId];

      if (!draft) {
        return;
      }

      setSavingUserId(userId);
      setNotice('');

      try {
        const response = await fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(isOwner ? { role: draft.role } : {}),
            phoneNumber: phoneOverride ?? draft.phoneNumber,
          }),
        });
        const payload = (await response.json().catch(() => null)) as {
          user?: AdminUserRecord;
          message?: string;
          error?: string;
        } | null;

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok || !payload?.user) {
          setNotice(
            payload?.message ??
              payload?.error ??
              'تعذر تحديث بيانات المستخدم.',
          );
          return;
        }

        const updatedUser = payload.user;

        setUsers((currentUsers) =>
          currentUsers.map((user) =>
            user.id === updatedUser.id ? updatedUser : user,
          ),
        );
        setDrafts((currentDrafts) => ({
          ...currentDrafts,
          [updatedUser.id]: {
            role: normalizeRole(updatedUser.role),
            phoneNumber: updatedUser.phoneNumber ?? '',
          },
        }));
        setNotice('تم تحديث بيانات المستخدم.');
      } finally {
        setSavingUserId(null);
      }
    },
    [drafts, isOwner, router],
  );

  const deleteUser = useCallback(
    async (user: AdminUserRecord) => {
      if (
        !window.confirm(
          `هل تؤكد حذف المستخدم ${user.email}؟ سيتم حذف بياناته المرتبطة بالحساب من المنصة.`,
        )
      ) {
        return;
      }

      setDeletingUserId(user.id);
      setNotice('');

      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: 'DELETE',
        });
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          error?: string;
        } | null;

        if (response.status === 401) {
          router.push('/api/auth/google/start');
          return;
        }

        if (!response.ok) {
          setNotice(
            payload?.message ??
              payload?.error ??
              'تعذر حذف المستخدم الآن.',
          );
          return;
        }

        setUsers((currentUsers) =>
          currentUsers.filter((currentUser) => currentUser.id !== user.id),
        );
        setDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };
          delete nextDrafts[user.id];
          return nextDrafts;
        });
        setNotice('تم حذف المستخدم من المنصة.');
      } finally {
        setDeletingUserId(null);
      }
    },
    [router],
  );

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:px-6">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3 shadow-sm dark:bg-card">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Users className="size-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">إدارة المستخدمين</h1>
              <p className="truncate text-xs text-muted-foreground">
                عرض بيانات العملاء والتحكم في الدور ورقم التواصل الرسمي
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-md" onClick={() => void refreshUsers(1)}>
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

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">إجمالي المستخدمين</div>
            <div className="mt-1 text-2xl font-bold">{formatNumber(totalUsers)}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">أرقام تواصل محفوظة</div>
            <div className="mt-1 text-2xl font-bold">{formatNumber(usersWithPhone)}</div>
          </div>
          <div className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">المعروض حاليًا</div>
            <div className="mt-1 text-2xl font-bold">{formatNumber(users.length)}</div>
          </div>
        </section>

        <section className="rounded-md border bg-white p-4 shadow-sm dark:bg-card">
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              void refreshUsers(1);
            }}
          >
            <label className="grid gap-1 text-sm font-semibold">
              بحث
              <input
                className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                name="userSearch"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="الاسم، البريد، رقم الجوال، أو معرف المستخدم"
                type="search"
                value={query}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              الدور
              <select
                className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                name="userRoleFilter"
                onChange={(event) => setRoleFilter(event.target.value)}
                value={roleFilter}
              >
                <option value="all">الكل</option>
                <option value="user">عميل</option>
                <option value="moderator">مشرف</option>
                <option value="admin">مدير</option>
              </select>
            </label>
            <Button className="self-end rounded-md bg-blue-600 hover:bg-blue-700" type="submit">
              <Search className="size-4" />
              بحث
            </Button>
          </form>
        </section>

        <section className="grid gap-3">
          {isLoading && users.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-md border bg-white text-sm text-muted-foreground shadow-sm dark:bg-card">
              جار تحميل المستخدمين...
            </div>
          ) : users.length === 0 ? (
            <div className="grid min-h-72 place-items-center rounded-md border border-dashed bg-white text-sm text-muted-foreground shadow-sm dark:bg-card">
              لا يوجد مستخدمون مطابقون.
            </div>
          ) : (
            users.map((user) => {
              const draft = drafts[user.id] ?? {
                role: normalizeRole(user.role),
                phoneNumber: user.phoneNumber ?? '',
              };
              const isSaving = savingUserId === user.id;
              const isDeleting = deletingUserId === user.id;
              const isOwnerAccount = user.role === 'owner';
              const isSoftDeleted = Boolean(user.deletedAt);
              const canChangeRole = isOwner && !isOwnerAccount;
              const canDelete =
                !isOwnerAccount &&
                (isOwner || user.role !== 'admin');
              const isBusy = isSaving || isDeleting;

              return (
                <article key={user.id} className="grid gap-4 rounded-md border bg-white p-4 shadow-sm dark:bg-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                        {user.picture ? (
                          <img alt={user.name ?? user.email} className="size-11 object-cover" src={user.picture} />
                        ) : (
                          <UserRound className="size-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-bold">{user.name ?? 'مستخدم SmartStore AI'}</h2>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground" dir="ltr">
                          {user.id}
                        </p>
                      </div>
                    </div>
                    <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      {isSoftDeleted
                        ? 'حساب معطّل'
                        : roleLabels[user.role] ?? user.role}
                    </span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="grid gap-1 text-sm font-semibold">
                      الدور
                      <select
                        className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        name={`user-${user.id}-role`}
                        disabled={isBusy || !canChangeRole}
                        onChange={(event) =>
                          updateDraft(user.id, {
                            role: normalizeRole(event.target.value),
                          })
                        }
                        value={isOwnerAccount ? 'admin' : draft.role}
                      >
                        <option value="user">عميل</option>
                        <option value="moderator">مشرف</option>
                        <option value="admin">مدير</option>
                      </select>
                      {!canChangeRole && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          {isOwnerAccount
                            ? 'حساب مالك المنصة محميّ من التعديل.'
                            : 'تغيير الأدوار متاح لمالك المنصة فقط.'}
                        </span>
                      )}
                    </label>
                    <label className="grid gap-1 text-sm font-semibold md:col-span-2">
                      رقم التواصل الرسمي
                      <div className="flex gap-2">
                        <input
                          className="h-11 min-w-0 flex-1 rounded-md border bg-background px-3 text-left text-sm font-medium outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          dir="ltr"
                          disabled={isBusy || isOwnerAccount}
                          inputMode="tel"
                          name={`user-${user.id}-phoneNumber`}
                          onChange={(event) =>
                            updateDraft(user.id, {
                              phoneNumber: event.target.value,
                            })
                          }
                          placeholder="05xxxxxxxx"
                          type="tel"
                          value={draft.phoneNumber}
                        />
                        <Button
                          className="rounded-md"
                          disabled={isBusy || isOwnerAccount || !draft.phoneNumber}
                          onClick={() => void saveUser(user.id, '')}
                          type="button"
                          variant="outline"
                        >
                          حذف
                        </Button>
                      </div>
                    </label>
                  </div>

                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex items-center gap-2 rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      <Store className="size-4 text-blue-600" />
                      الإعلانات: {formatNumber(user.counts.listings)}
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      <MessageCircle className="size-4 text-blue-600" />
                      المحادثات: {formatNumber(user.counts.conversations)}
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      <Percent className="size-4 text-blue-600" />
                      العمولات: {formatNumber(user.counts.commissions)}
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      <Phone className="size-4 text-blue-600" />
                      الرقم: {user.phoneNumber ? 'محفوظ' : 'غير محفوظ'}
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      <BadgeCheck className="size-4 text-blue-600" />
                      اتفاقية العمولة: {user.commissionAgreementAccepted ? 'مقبولة' : 'غير مقبولة'}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      الرسائل: {formatNumber(user.counts.messages)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      بلاغات المستخدم: {formatNumber(user.counts.userReportsReceived ?? 0)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      آخر تحديث: {formatDate(user.updatedAt)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-3 py-2 dark:bg-background">
                      التسجيل: {formatDate(user.createdAt)}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldCheck className="size-4 text-blue-600" />
                      أي تعديل إداري يتم تسجيله في سجل الإدارة.
                    </div>
                    {canDelete && (
                      <Button
                        className="rounded-md border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-200"
                        disabled={isBusy}
                        onClick={() => void deleteUser(user)}
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                        {isDeleting ? 'جار الحذف...' : 'حذف المستخدم'}
                      </Button>
                    )}
                    <Button
                      className="rounded-md bg-blue-600 hover:bg-blue-700"
                      disabled={isBusy || isOwnerAccount}
                      onClick={() => void saveUser(user.id)}
                      type="button"
                    >
                      <Save className="size-4" />
                      {isSaving ? 'جار الحفظ...' : 'حفظ التعديلات'}
                    </Button>
                  </div>
                </article>
              );
            })
          )}

          <div ref={usersLoadMoreRef} aria-hidden="true" className="h-4" />
          {pagination?.hasMore && (
            <Button
              className="mx-auto rounded-md"
              disabled={isLoading}
              onClick={() => void refreshUsers(pagination.nextPage ?? 1)}
              type="button"
              variant="outline"
            >
              تحميل المزيد
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
