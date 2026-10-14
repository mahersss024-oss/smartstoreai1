'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Bell,
  FileText,
  Heart,
  LogOut,
  Megaphone,
  MessageCircle,
  Pencil,
  Percent,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  User,
  UserPlus,
} from 'lucide-react';

import { ThemeToggle } from '@/components/theme-toggle';
import { ActionConfirmDialog } from '@/components/action-confirm-dialog';
import { AppleMark, GoogleMark } from '@/components/auth-provider-mark';
import { FloatingActionNotice } from '@/components/floating-action-notice';
import { SellerAvatar } from '@/components/seller-avatar';
import type { AuthUser } from '@/hooks/use-auth-session';
import { useAuthSession } from '@/hooks/use-auth-session';
import { useAuthProviderVisibility } from '@/hooks/use-auth-provider-visibility';
import { countContactPhoneCandidates } from '@/lib/auth/contact-profile';
import { Button } from '@ui/button';

type ProfileNotice = {
  tone: 'success' | 'danger' | 'info';
  message: string;
};

export default function AccountPage() {
  const router = useRouter();
  const {
    isSessionLoading,
    session,
    setSession,
  } = useAuthSession();
  const authProviders = useAuthProviderVisibility();
  const [profileName, setProfileName] = useState('');
  const [profilePicture, setProfilePicture] = useState('');
  const [profilePicturePreview, setProfilePicturePreview] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [savedProfileName, setSavedProfileName] = useState('');
  const [savedProfilePhone, setSavedProfilePhone] = useState('');
  const [isEditingProfilePhone, setIsEditingProfilePhone] = useState(false);
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [profileNotice, setProfileNotice] = useState<ProfileNotice | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUploadingProfilePicture, setIsUploadingProfilePicture] = useState(false);
  const [isRemovingProfilePicture, setIsRemovingProfilePicture] = useState(false);
  const [pendingAccountConfirm, setPendingAccountConfirm] = useState<
    'remove_picture' | null
  >(null);
  const clearingBrokenProfilePictureRef = useRef(false);

  const administrativeRoleLabel =
    session.user?.role === 'owner'
      ? 'مالك المنصة'
      : session.user?.role === 'admin'
        ? 'مدير'
        : session.user?.role === 'moderator'
          ? 'مشرف'
          : null;
  const isAdmin = Boolean(administrativeRoleLabel);
  const hasSavedProfilePhone = Boolean(savedProfilePhone);
  const isProfilePhoneInputLocked =
    hasSavedProfilePhone && !isEditingProfilePhone;
  const hasProfileNameChanges = profileName !== savedProfileName;
  const hasProfilePhoneChanges = profilePhone !== savedProfilePhone;
  const hasProfileChanges = hasProfileNameChanges || hasProfilePhoneChanges;
  const visibleProfilePicture = profilePicturePreview || profilePicture;

  const syncProfileFromSession = useCallback(
    (nextSession = session) => {
      setProfileName(nextSession.user?.name ?? '');
      setProfilePicture(nextSession.user?.picture ?? '');
      setProfilePhone(nextSession.user?.phoneNumber ?? '');
      setSavedProfileName(nextSession.user?.name ?? '');
      setSavedProfilePhone(nextSession.user?.phoneNumber ?? '');
      setIsEditingProfilePhone(false);
      setIsProfileEditorOpen(false);
    },
    [session],
  );

  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
  }, []);

  useEffect(() => {
    if (!isSessionLoading) {
      syncProfileFromSession(session);
    }
  }, [isSessionLoading, session, syncProfileFromSession]);

  useEffect(() => {
    return () => {
      if (profilePicturePreview) {
        URL.revokeObjectURL(profilePicturePreview);
      }
    };
  }, [profilePicturePreview]);

  const handleLogout = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST' }).then(() => {
      setSession({ authenticated: false, user: null });
      setProfileName('');
      setProfilePicture('');
      setProfilePicturePreview('');
      setProfilePhone('');
      setSavedProfileName('');
      setSavedProfilePhone('');
      setIsEditingProfilePhone(false);
      setIsProfileEditorOpen(false);
      setProfileNotice(null);
    });
  }, [setSession]);

  const saveProfile = useCallback(async (nextPhoneNumber = profilePhone) => {
    if (countContactPhoneCandidates(nextPhoneNumber) > 1) {
      setProfileNotice({
        tone: 'danger',
        message: 'يمكن حفظ رقم اتصال واحد فقط. احذف الرقم الإضافي ثم احفظ.',
      });
      return;
    }

    setIsSavingProfile(true);
    setProfileNotice(null);

    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: profileName,
          phoneNumber: nextPhoneNumber,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        user?: AuthUser;
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok || !payload?.user) {
        setProfileNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر حفظ بيانات الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      setSession((currentSession) => ({
        ...currentSession,
        user: payload.user ?? null,
      }));
      setProfileName(payload.user.name ?? '');
      setProfilePicture(payload.user.picture ?? '');
      setProfilePhone(payload.user.phoneNumber ?? '');
      setSavedProfileName(payload.user.name ?? '');
      setSavedProfilePhone(payload.user.phoneNumber ?? '');
      setIsEditingProfilePhone(false);
      setIsProfileEditorOpen(false);
      setProfileNotice({
        tone: 'success',
        message: 'تم حفظ التغييرات.',
      });
    } catch {
      setProfileNotice({
        tone: 'danger',
        message: 'تعذر حفظ بيانات الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsSavingProfile(false);
    }
  }, [profileName, profilePhone, router, setSession]);

  const editProfilePhone = useCallback(() => {
    setProfilePhone(savedProfilePhone);
    setIsEditingProfilePhone(true);
    setProfileNotice({
      tone: 'info',
      message: 'عدّل رقم الاتصال ثم اضغط حفظ البيانات.',
    });
  }, [savedProfilePhone]);

  const deleteProfilePhone = useCallback(() => {
    void saveProfile('');
  }, [saveProfile]);

  const uploadProfilePicture = useCallback(async (file: File | null) => {
    if (!file) {
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setProfilePicturePreview((currentPreview) => {
      if (currentPreview) {
        URL.revokeObjectURL(currentPreview);
      }

      return previewUrl;
    });
    setIsUploadingProfilePicture(true);
    setProfileNotice(null);

    try {
      const formData = new FormData();
      formData.set('image', file);

      const response = await fetch('/api/account/profile/picture', {
        method: 'POST',
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        user?: AuthUser;
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        setProfilePicturePreview((currentPreview) => {
          if (currentPreview) {
            URL.revokeObjectURL(currentPreview);
          }

          return '';
        });
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok || !payload?.user?.picture) {
        setProfilePicturePreview((currentPreview) => {
          if (currentPreview) {
            URL.revokeObjectURL(currentPreview);
          }

          return '';
        });
        setProfileNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر رفع صورة الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      const nextPicture = payload.user.picture;
      const image = new window.Image();
      const applyUploadedPicture = () => {
        setSession((currentSession) => ({
          ...currentSession,
          user: payload.user ?? null,
        }));
        setProfilePicture(nextPicture);
        setProfilePicturePreview((currentPreview) => {
          if (currentPreview) {
            URL.revokeObjectURL(currentPreview);
          }

          return '';
        });
        setProfileNotice({
          tone: 'success',
          message: 'تم تحديث صورة الحساب بنجاح.',
        });
      };

      image.onload = applyUploadedPicture;
      image.onerror = () => {
        setProfilePicturePreview((currentPreview) => {
          if (currentPreview) {
            URL.revokeObjectURL(currentPreview);
          }

          return '';
        });
        setProfileNotice({
          tone: 'danger',
          message:
            'تم رفع الصورة لكن تعذر عرضها من دومين الصور. تحقق من إعدادات التخزين ثم حاول مرة أخرى.',
        });
      };
      image.src = nextPicture;
    } catch {
      setProfilePicturePreview((currentPreview) => {
        if (currentPreview) {
          URL.revokeObjectURL(currentPreview);
        }

        return '';
      });
      setProfileNotice({
        tone: 'danger',
        message: 'تعذر رفع صورة الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsUploadingProfilePicture(false);
    }
  }, [router, setSession]);

  const removeProfilePicture = useCallback(async () => {
    setPendingAccountConfirm(null);
    setIsRemovingProfilePicture(true);
    setProfileNotice(null);

    try {
      const response = await fetch('/api/account/profile/picture', {
        method: 'DELETE',
      });
      const payload = (await response.json().catch(() => null)) as {
        user?: AuthUser;
        message?: string;
        error?: string;
      } | null;

      if (response.status === 401) {
        router.push('/api/auth/google/start');
        return;
      }

      if (!response.ok || !payload?.user) {
        setProfileNotice({
          tone: 'danger',
          message:
            payload?.message ??
            payload?.error ??
            'تعذر إزالة صورة الحساب الآن. حاول مرة أخرى.',
        });
        return;
      }

      setProfilePicturePreview((currentPreview) => {
        if (currentPreview) {
          URL.revokeObjectURL(currentPreview);
        }

        return '';
      });
      setProfilePicture('');
      setSession((currentSession) => ({
        ...currentSession,
        user: payload.user ?? null,
      }));
      setProfileNotice({
        tone: 'success',
        message: 'تمت إزالة صورة الحساب بنجاح.',
      });
    } catch {
      setProfileNotice({
        tone: 'danger',
        message: 'تعذر إزالة صورة الحساب الآن. تحقق من الاتصال ثم حاول مرة أخرى.',
      });
    } finally {
      setIsRemovingProfilePicture(false);
    }
  }, [router, setSession]);

  const clearBrokenProfilePicture = useCallback(async (brokenPicture: string) => {
    if (
      !profilePicture ||
      profilePicturePreview ||
      brokenPicture !== profilePicture ||
      clearingBrokenProfilePictureRef.current
    ) {
      return;
    }

    clearingBrokenProfilePictureRef.current = true;
    setProfilePicture('');
    setSession((currentSession) => ({
      ...currentSession,
      user: currentSession.user
        ? {
            id: currentSession.user.id,
            email: currentSession.user.email,
            name: currentSession.user.name,
            phoneNumber: currentSession.user.phoneNumber,
            role: currentSession.user.role,
          }
        : currentSession.user,
    }));

    try {
      await fetch('/api/account/profile/picture', {
        method: 'DELETE',
      });
    } finally {
      clearingBrokenProfilePictureRef.current = false;
    }
  }, [profilePicture, profilePicturePreview, setSession]);

  return (
    <main className="marketplace-shell h-dvh min-h-dvh overflow-hidden bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <FloatingActionNotice
        message={profileNotice?.message}
        onDismiss={() => setProfileNotice(null)}
        open={Boolean(profileNotice)}
        tone={profileNotice?.tone ?? 'info'}
      />
      <ActionConfirmDialog
        confirmLabel="إزالة الصورة"
        description="سيتم إزالة صورة العرض من حسابك."
        loading={isRemovingProfilePicture}
        loadingText="جاري التنفيذ..."
        onCancel={() => setPendingAccountConfirm(null)}
        onConfirm={() => {
          if (pendingAccountConfirm === 'remove_picture') {
            void removeProfilePicture();
          }
        }}
        open={Boolean(pendingAccountConfirm)}
        title="تأكيد إزالة الصورة"
        tone="default"
      />
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[28rem] flex-col gap-4 px-3 py-4 sm:max-w-[30rem] sm:px-5 sm:py-5 lg:max-w-4xl lg:px-6">
        <header className="smartstore-page-header flex shrink-0 items-center justify-between gap-2 px-1 sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Link className="grid size-9 place-items-center rounded-md bg-white dark:bg-card" href="/">
              <ArrowRight className="size-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold sm:text-base">حسابي</h1>
            </div>
          </div>
        </header>

        {isSessionLoading ? (
          <section className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">جاري التحقق من الحساب</h2>
              </div>
            </div>
          </section>
        ) : !session.authenticated ? (
          <section className="grid min-h-0 flex-1 place-items-center p-6 text-center">
            <div className="grid max-w-md gap-4">
              <div className="mx-auto grid size-14 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                <ShieldCheck className="size-7" />
              </div>
              <div>
                <h2 className="text-xl font-bold">سجل الدخول لعرض حسابك</h2>
              </div>
              {authProviders.google ? (
                <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md border border-slate-200 bg-white text-[#1f1f1f] shadow-sm hover:bg-slate-50 dark:border-white/10">
                  <a href="/api/auth/google/start">
                    <GoogleMark className="size-5" />
                    دخول Google
                  </a>
                </Button>
              ) : null}
              {authProviders.apple ? (
                <Button asChild className="w-full max-w-sm justify-center gap-2 rounded-md bg-[#050914] text-white shadow-sm ring-1 ring-white/10 hover:bg-[#111827]">
                  <a href="/api/auth/apple/start">
                    <AppleMark className="size-5" />
                    دخول Apple
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : (
          <>
            {session.user?.id ? (
              <Link
                className="mx-auto grid w-full max-w-[28rem] shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72 sm:max-w-[30rem] lg:max-w-none"
                href="/account/seller-profile"
                prefetch={false}
              >
                <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-50 text-blue-700 sm:size-14 dark:bg-blue-400/10 dark:text-blue-200">
                  <SellerAvatar
                    alt={session.user?.name ?? 'حساب سوق حمد'}
                    onPictureError={clearBrokenProfilePicture}
                    picture={visibleProfilePicture}
                  />
                </span>
                <span className="grid min-w-0 gap-1">
                  {isAdmin && (
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                      <ShieldCheck className="size-3" />
                      {administrativeRoleLabel}
                    </span>
                  )}
                  <span className="truncate text-base font-bold text-slate-950 sm:text-lg dark:text-card-foreground">
                    {session.user?.name ?? 'عميل سوق حمد'}
                  </span>
                </span>
              </Link>
            ) : (
              <section className="mx-auto w-full max-w-[28rem] shrink-0 rounded-md border border-slate-200/70 bg-white/82 p-2.5 shadow-sm dark:border-white/10 dark:bg-card/72 sm:max-w-[30rem] lg:max-w-none">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-50 text-blue-700 sm:size-14 dark:bg-blue-400/10 dark:text-blue-200">
                    <SellerAvatar
                      alt={session.user?.name ?? 'حساب سوق حمد'}
                      onPictureError={clearBrokenProfilePicture}
                      picture={visibleProfilePicture}
                    />
                  </div>
                  <div className="grid min-w-0 flex-1 gap-1">
                    {isAdmin && (
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                        <ShieldCheck className="size-3" />
                        {administrativeRoleLabel}
                      </span>
                    )}
                    <h2 className="truncate text-base font-bold text-slate-950 sm:text-lg dark:text-card-foreground">
                      {session.user?.name ?? 'عميل سوق حمد'}
                    </h2>
                  </div>
                </div>
              </section>
            )}

            <div className="marketplace-listings-scroll mx-auto grid min-h-0 w-full max-w-[28rem] flex-1 gap-3 overflow-y-auto overscroll-contain px-1 pb-[calc(6.75rem+env(safe-area-inset-bottom))] sm:max-w-[30rem] sm:px-2 lg:max-w-none lg:pb-6">
            <section className="grid gap-1.5">
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/account/listings" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <Megaphone className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">إعلاناتي</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/conversations" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <MessageCircle className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">محادثاتي</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/favorites" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-rose-50 text-rose-600 dark:bg-rose-400/10 dark:text-rose-200">
                  <Heart className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">المفضلة</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/notifications" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-red-50 text-red-600 dark:bg-red-400/10 dark:text-red-200">
                  <Bell className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">الإشعارات</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/account/follows" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                  <UserPlus className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">قائمة المتابعة</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72" href="/commissions" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-100">
                  <Percent className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">رسوم المنصة</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
            </section>

            <section className="grid gap-2">
              <button
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72"
                onClick={() => {
                  const nextOpen = !isProfileEditorOpen;
                  if (nextOpen) {
                    setProfileName(savedProfileName);
                    setProfilePhone(savedProfilePhone);
                    setIsEditingProfilePhone(!savedProfilePhone);
                    setProfileNotice(null);
                  }
                  setIsProfileEditorOpen(nextOpen);
                }}
                type="button"
              >
                <span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <User className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">الملف الشخصي</span>
                </span>
                <ArrowRight className={`size-4 text-muted-foreground transition ${isProfileEditorOpen ? '-rotate-90' : 'rotate-180'}`} />
              </button>

              {isProfileEditorOpen && (
                <div className="grid gap-4 rounded-md border border-blue-200/70 bg-white/90 p-3 shadow-sm dark:border-blue-400/20 dark:bg-card/80">
                  <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <div className="grid place-items-start">
                      <div className="grid size-24 place-items-center overflow-hidden rounded-full bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                        <SellerAvatar
                          alt="صورة الحساب"
                          onPictureError={clearBrokenProfilePicture}
                          picture={visibleProfilePicture}
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 content-start">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-semibold transition hover:bg-accent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                          <Upload className="size-4" />
                          {isUploadingProfilePicture
                            ? 'جار رفع الصورة...'
                            : profilePicture
                              ? 'تغيير صورة العرض'
                              : 'رفع صورة العرض'}
                          <input
                            accept="image/jpeg,image/png,image/webp"
                            className="sr-only"
                            disabled={isUploadingProfilePicture || isRemovingProfilePicture}
                            name="profilePictureFile"
                            type="file"
                            onChange={(event) => {
                              const file = event.target.files?.[0] ?? null;
                              event.target.value = '';
                              void uploadProfilePicture(file);
                            }}
                          />
                        </label>
                        {profilePicture ? (
                          <Button
                            className="rounded-md"
                            disabled={isUploadingProfilePicture || isRemovingProfilePicture}
                            onClick={() => setPendingAccountConfirm('remove_picture')}
                            type="button"
                            variant="outline"
                          >
                            <Trash2 className="size-4 text-red-600" />
                            {isRemovingProfilePicture ? 'جار إزالة الصورة...' : 'إزالة صورة العرض'}
                          </Button>
                        ) : null}
                      </div>
                      <div className="rounded-md border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-slate-950/20">
                        البريد: <span className="font-semibold" dir="ltr">{session.user?.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm font-semibold">
                      الاسم
                      <input
                        className="h-11 rounded-md border bg-background px-3 text-sm font-medium outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        disabled={isSavingProfile || isUploadingProfilePicture || isRemovingProfilePicture}
                        maxLength={80}
                        name="profileDisplayName"
                        placeholder="اسمك في سوق حمد"
                        type="text"
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-semibold">
                      رقم الجوال
                      <input
                        className="h-11 rounded-md border bg-background px-3 text-left text-sm font-medium outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        disabled={isProfilePhoneInputLocked || isSavingProfile}
                        dir="ltr"
                        inputMode="tel"
                        name="profilePhoneNumber"
                        placeholder="05xxxxxxxx"
                        type="tel"
                        value={profilePhone}
                        onChange={(event) => setProfilePhone(event.target.value)}
                      />
                    </label>
                  </div>

                  {savedProfilePhone ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-200">
                          رقم الاتصال الحالي
                        </div>
                        <div className="mt-1 truncate font-semibold" dir="ltr">
                          {savedProfilePhone}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          className="rounded-md"
                          disabled={isSavingProfile}
                          onClick={editProfilePhone}
                          type="button"
                          variant="outline"
                        >
                          <Pencil className="size-4" />
                          تعديل
                        </Button>
                        <Button
                          className="rounded-md border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-200"
                          disabled={isSavingProfile}
                          onClick={deleteProfilePhone}
                          type="button"
                          variant="outline"
                        >
                          <Trash2 className="size-4" />
                          حذف
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      className="rounded-md bg-blue-600 hover:bg-blue-700"
                      disabled={
                        isSavingProfile ||
                        isUploadingProfilePicture ||
                        isRemovingProfilePicture ||
                        !hasProfileChanges
                      }
                      loading={isSavingProfile}
                      loadingText="جاري الحفظ..."
                      onClick={() => void saveProfile()}
                      type="button"
                    >
                      <Save className="size-4" />
                      حفظ التغييرات
                    </Button>
                    <Button
                      className="rounded-md"
                      disabled={
                        isSavingProfile ||
                        isUploadingProfilePicture ||
                        isRemovingProfilePicture ||
                        !hasProfileChanges
                      }
                      onClick={() => {
                        setProfileName(savedProfileName);
                        setProfilePhone(savedProfilePhone);
                        setIsEditingProfilePhone(!savedProfilePhone);
                      }}
                      type="button"
                      variant="outline"
                    >
                      إلغاء التعديل
                    </Button>
                  </div>
                </div>
              )}
            </section>

            <section className="grid gap-1.5">
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 shadow-sm dark:border-white/10 dark:bg-card/72">
                <span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <Settings className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">المظهر</span>
                </span>
                <ThemeToggle language="ar" variant="switch" />
              </div>

              <Link
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-slate-200/70 bg-white/82 p-2.5 text-right shadow-sm transition hover:border-blue-300 dark:border-white/10 dark:bg-card/72"
                href="/terms"
                prefetch={false}
              >
                <span className="grid size-9 place-items-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                  <FileText className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">الشروط والسياسات</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-muted-foreground" />
              </Link>
            </section>

            {isAdmin && (
              <Link className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-emerald-300/70 bg-emerald-50/70 p-2.5 text-emerald-800 shadow-sm transition hover:border-emerald-400 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100" href="/admin" prefetch={false}>
                <span className="grid size-9 place-items-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-300/15 dark:text-emerald-100">
                  <Settings className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">لوحة الإدارة</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-emerald-700/70 dark:text-emerald-100/70" />
              </Link>
            )}

            <section className="grid gap-2 rounded-md border border-slate-200/70 bg-white/82 p-3 shadow-sm dark:border-white/10 dark:bg-card/72">
              <Link
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-red-200/80 bg-red-50/70 p-2.5 text-red-800 transition hover:border-red-300 dark:border-red-400/25 dark:bg-red-400/10 dark:text-red-100"
                href="/delete-account"
                prefetch={false}
              >
                <span className="grid size-9 place-items-center rounded-md bg-red-100 text-red-700 dark:bg-red-300/15 dark:text-red-100">
                  <Trash2 className="size-4" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-sm font-bold">حذف الحساب</span>
                </span>
                <ArrowRight className="size-4 rotate-180 text-red-700/70 dark:text-red-100/70" />
              </Link>
              <Button
                className="h-11 justify-center gap-2 rounded-md"
                onClick={handleLogout}
                type="button"
                variant="outline"
              >
                <LogOut className="size-4" />
                خروج
              </Button>
            </section>
          </div>
          </>
        )}
      </div>
    </main>
  );
}
