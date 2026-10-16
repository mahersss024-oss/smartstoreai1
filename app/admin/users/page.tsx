'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  MessageCircle,
  Percent,
  Phone,
  Save,
  Search,
  ShieldCheck,
  Megaphone,
  Trash2,
  Users,
} from 'lucide-react';

import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { SellerAvatar } from '@/components/seller-avatar';
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
  const isOwner = adminAccessRole === 'owner' || adminAccessRole === 'admin';
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [isLinkedQueryReady, setIsLinkedQueryReady] = useState(false);
  const [roleFilter, setRoleFilter] = useState('all');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [userAction, setUserAction] = useState<'disable' | 'restore' | 'permanent' | null>(null);
  const [pendingUserConfirm, setPendingUserConfirm] = useState<{
    user: AdminUserRecord;
    action: 'soft' | 'permanent' | 'restore';
  } | null>(null);

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

        if (appliedQuery) {
          params.set('query', appliedQuery);
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
    [appliedQuery, isOwner, roleFilter, router, verifyAdminAccess],
  );

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        const linkedQuery =
          new URLSearchParams(window.location.search).get('query')?.trim() ?? '';
        setQuery(linkedQuery);
        setAppliedQuery(linkedQuery);
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

    if (!adminAccessRole) {
      void verifyAdminAccess();
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
  }, [adminAccessRole, isLinkedQueryReady, refreshUsers, verifyAdminAccess]);

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
    async (user: AdminUserRecord, mode: 'soft' | 'permanent') => {
      const isPermanent = mode === 'permanent';
      setPendingUserConfirm(null);
      setDeletingUserId(user.id);
      setUserAction(isPermanent ? 'permanent' : 'disable');
      setNotice('');

      try {
        const response = await fetch(`/api/admin/users/${user.id}?mode=${mode}`, {
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
              (isPermanent
                ? 'تعذر حذف المستخدم نهائيًا.'
                : 'تعذر تعطيل الحساب الآن.'),
          );
          return;
        }

        setUsers((currentUsers) =>
          mode === 'soft' && isOwner
            ? currentUsers.map((currentUser) =>
                currentUser.id === user.id
                  ? { ...currentUser, deletedAt: new Date().toISOString() }
                  : currentUser,
              )
            : currentUsers.filter((currentUser) => currentUser.id !== user.id),
        );
        setDrafts((currentDrafts) => {
          const nextDrafts = { ...currentDrafts };
          delete nextDrafts[user.id];
          return nextDrafts;
        });
        setNotice(
          isPermanent
            ? 'تم حذف المستخدم وبياناته نهائيًا.'
            : 'تم تعطيل حساب المستخدم مع الاحتفاظ ببياناته.',
        );
      } finally {
        setDeletingUserId(null);
        setUserAction(null);
      }
    },
    [isOwner, router],
  );

  const restoreUser = useCallback(
    async (user: AdminUserRecord) => {
      setPendingUserConfirm(null);
      setDeletingUserId(user.id);
      setUserAction('restore');
      setNotice('');

      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountStatus: 'active' }),
        });
        const payload = (await response.json().catch(() => null)) as {
          user?: AdminUserRecord;
          message?: string;
          error?: string;
        } | null;

        if (!response.ok || !payload?.user) {
          setNotice(payload?.message ?? payload?.error ?? 'تعذر إعادة تفعيل الحساب.');
          return;
        }

        setUsers((currentUsers) =>
          currentUsers.map((currentUser) =>
            currentUser.id === user.id ? payload.user! : currentUser,
          ),
        );
        setNotice('تمت إعادة تفعيل حساب المستخدم.');
      } finally {
        setDeletingUserId(null);
        setUserAction(null);
      }
    },
    [],
  );

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        closeLabel="إغلاق نتيجة إجراء المستخدم"
        message={notice}
        onDismiss={() => setNotice('')}
        open={Boolean(notice)}
        tone={notice.startsWith('تم') ? 'success' : 'danger'}
      />
      <ActionConfirmDialog
        confirmLabel={
          pendingUserConfirm?.action === 'restore'
            ? 'إعادة التفعيل'
            : pendingUserConfirm?.action === 'permanent'
              ? 'حذف نهائي'
              : 'تعطيل الحساب'
        }
        description={
          pendingUserConfirm
            ? pendingUserConfirm.action === 'restore'
              ? `سيتم إعادة تفعيل حساب ${pendingUserConfirm.user.email}.`
              : pendingUserConfirm.action === 'permanent'
                ? `سيتم حذف حساب ${pendingUserConfirm.user.email} وبياناته نهائيًا ولا يمكن التراجع.`
                : `سيتم تعطيل حساب ${pendingUserConfirm.user.email} مع الاحتفاظ ببياناته للمراجعة.`
            : ''
        }
        loading={Boolean(
          pendingUserConfirm && deletingUserId === pendingUserConfirm.user.id,
        )}
        loadingText="جاري التنفيذ..."
        onCancel={() => setPendingUserConfirm(null)}
        onConfirm={() => {
          if (!pendingUserConfirm) {
            return;
          }

          if (pendingUserConfirm.action === 'restore') {
            void restoreUser(pendingUserConfirm.user);
          } else {
            void deleteUser(pendingUserConfirm.user, pendingUserConfirm.action);
          }
        }}
        open={Boolean(pendingUserConfirm)}
        title={
          pendingUserConfirm?.action === 'restore'
            ? 'تأكيد إعادة التفعيل'
            : pendingUserConfirm?.action === 'permanent'
              ? 'تأكيد الحذف النهائي'
              : 'تأكيد تعطيل الحساب'
        }
        tone={pendingUserConfirm?.action === 'restore' ? 'default' : 'danger'}
      />
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-3 py-5 sm:px-6">
        <header className="flex max-w-full flex-wrap items-center justify-between gap-3 overflow-hidden rounded-md border bg-white px-3 py-3 shadow-sm dark:bg-card sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href="/admin">
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
              <Users className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-bold">إدارة المستخدمين</h1>
              <p className="truncate text-xs text-muted-foreground">
                عرض بيانات العملاء والتحكم في الدور ورقم التواصل الرسمي
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" className="rounded-md" onClick={() => void refreshUsers(1)}>
              تحديث
            </Button>
          </div>
        </header>

        {(adminAccessNotice || notice) && (
          <div className="rounded-md border bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm dark:bg-card">
            {adminAccessNotice || notice}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-white px-3 py-2.5 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">إجمالي المستخدمين</div>
            <div className="mt-1 text-xl font-bold">{formatNumber(totalUsers)}</div>
          </div>
          <div className="rounded-md border bg-white px-3 py-2.5 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">أرقام تواصل محفوظة</div>
            <div className="mt-1 text-xl font-bold">{formatNumber(usersWithPhone)}</div>
          </div>
          <div className="rounded-md border bg-white px-3 py-2.5 shadow-sm dark:bg-card">
            <div className="text-xs text-muted-foreground">المعروض حاليًا</div>
            <div className="mt-1 text-xl font-bold">{formatNumber(users.length)}</div>
          </div>
        </section>

        <section className="max-w-full overflow-hidden rounded-md border bg-white p-3 shadow-sm dark:bg-card">
          <form
            className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuery = query.trim();
              if (nextQuery === appliedQuery) {
                void refreshUsers(1);
                return;
              }
              setAppliedQuery(nextQuery);
            }}
          >
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              بحث
              <input
                className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                name="userSearch"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="الاسم، البريد، رقم الجوال، أو معرف المستخدم"
                type="search"
                value={query}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-sm font-semibold">
              الدور
              <select
                className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
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

        <section className="grid max-w-full gap-2 overflow-hidden rounded-md border bg-white px-3 py-2 shadow-sm dark:bg-card">
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
              const canDisable =
                !isOwnerAccount &&
                !isSoftDeleted &&
                (isOwner || user.role !== 'admin');
              const isBusy = isSaving || isDeleting;

              return (
                <article key={user.id} className="grid min-w-0 gap-3 border-b border-slate-200/70 py-3 last:border-b-0 dark:border-white/10">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                    <Link
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                      href={`/sellers/${encodeURIComponent(user.id)}?source=admin-users`}
                    >
                      <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                        <SellerAvatar
                          alt={user.name ?? user.email}
                          className="size-11 object-cover"
                          picture={user.picture}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-sm font-bold">{user.name ?? 'مستخدم سوق حمد'}</h2>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        <p className="mt-1 break-all text-[11px] leading-4 text-muted-foreground" dir="ltr">
                          {user.id}
                        </p>
                      </div>
                    </Link>
                    <span className="shrink-0 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      {isSoftDeleted
                        ? 'حساب معطّل'
                        : roleLabels[user.role] ?? user.role}
                    </span>
                  </div>

                  <div className="grid min-w-0 gap-3 md:grid-cols-3">
                    <label className="grid min-w-0 gap-1 text-sm font-semibold">
                      الدور
                      <select
                        className="h-11 min-w-0 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
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
                    <label className="grid min-w-0 gap-1 text-sm font-semibold md:col-span-2">
                      رقم التواصل الرسمي
                      <div className="flex min-w-0 gap-2">
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

                  <div className="grid min-w-0 gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      <Megaphone className="size-4 text-blue-600" />
                      الإعلانات: {formatNumber(user.counts.listings)}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      <MessageCircle className="size-4 text-blue-600" />
                      المحادثات: {formatNumber(user.counts.conversations)}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      <Percent className="size-4 text-blue-600" />
                      رسوم المنصة: {formatNumber(user.counts.commissions)}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      <Phone className="size-4 text-blue-600" />
                      الرقم: {user.phoneNumber ? 'محفوظ' : 'غير محفوظ'}
                    </div>
                    <div className="flex min-w-0 items-center gap-2 rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      <BadgeCheck className="size-4 text-blue-600" />
                      اتفاقية رسوم المنصة: {user.commissionAgreementAccepted ? 'مقبولة' : 'غير مقبولة'}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      الرسائل: {formatNumber(user.counts.messages)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      بلاغات المستخدم: {formatNumber(user.counts.userReportsReceived ?? 0)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      آخر تحديث: {formatDate(user.updatedAt)}
                    </div>
                    <div className="rounded-md bg-[#f7f9fc] px-2.5 py-1.5 dark:bg-background">
                      التسجيل: {formatDate(user.createdAt)}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        <ShieldCheck className="size-4 text-blue-600" />
                        أي تعديل إداري يتم تسجيله في سجل الإدارة.
                      </div>
                      <Button asChild className="rounded-md" size="sm" variant="outline">
                        <Link href={`/sellers/${encodeURIComponent(user.id)}?source=admin-users`}>
                          <ExternalLink className="size-4" />
                          عرض صفحة المعلن
                        </Link>
                      </Button>
                    </div>
                    {canDisable && (
                      <Button
                        className="rounded-md border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-200"
                        disabled={isBusy}
                        onClick={() =>
                          setPendingUserConfirm({ user, action: 'soft' })
                        }
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                        {isDeleting && userAction === 'disable' ? 'جار التعطيل...' : 'تعطيل الحساب'}
                      </Button>
                    )}
                    {isOwner && isSoftDeleted && !isOwnerAccount ? (
                      <Button
                        className="rounded-md"
                        disabled={isBusy}
                        onClick={() =>
                          setPendingUserConfirm({ user, action: 'restore' })
                        }
                        type="button"
                        variant="outline"
                      >
                        {isDeleting && userAction === 'restore' ? 'جار التفعيل...' : 'إعادة تفعيل الحساب'}
                      </Button>
                    ) : null}
                    {isOwner && isSoftDeleted && !isOwnerAccount ? (
                      <Button
                        className="rounded-md border-red-600 bg-red-600 text-white hover:bg-red-700"
                        disabled={isBusy}
                        onClick={() =>
                          setPendingUserConfirm({ user, action: 'permanent' })
                        }
                        type="button"
                      >
                        <Trash2 className="size-4" />
                        {isDeleting && userAction === 'permanent' ? 'جار الحذف النهائي...' : 'حذف نهائي'}
                      </Button>
                    ) : null}
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

          {pagination?.hasMore && (
            <div>
              <div
                ref={usersLoadMoreRef}
                aria-hidden="true"
                className="h-24 w-full"
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
