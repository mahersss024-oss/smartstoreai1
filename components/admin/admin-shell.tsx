'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Percent,
  ShieldCheck,
  Users,
  Wrench,
  X,
  Megaphone,
  Search,
  LogOut,
} from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@ui/command';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@ui/button';
import { useAdminAccess } from '@/app/admin/use-admin-access';
import { AdminReportNotifications } from './report-notifications';
import { useAuthSession } from '@/hooks/use-auth-session';
import { announceAuthSessionChange } from '@/lib/auth/session-sync';

// Adapted from TailAdmin's sidebar/header layout; see docs/licenses/tailadmin.txt.
const sections = [
  { href: '/admin', label: 'نظرة عامة', icon: LayoutDashboard, staff: true },
  { href: '/admin/listings', label: 'الإعلانات', icon: Megaphone, staff: true },
  {
    href: '/admin/moderation',
    label: 'البلاغات والأدلة',
    icon: ShieldCheck,
    staff: true,
  },
  { href: '/admin/users', label: 'العملاء', icon: Users },
  { href: '/admin/commissions', label: 'العمولات', icon: Percent },
  { href: '/admin/audit-log', label: 'سجل الإدارة', icon: ClipboardList },
  { href: '/admin/maintenance', label: 'الصيانة', icon: Wrench, ownerOnly: true },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [previousPath, setPreviousPath] = useState(pathname);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutNotice, setSignOutNotice] = useState('');
  const { session, setSession } = useAuthSession();
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const { adminAccessRole, isAdminAccessAllowed, isAdminAccessChecking, verifyAdminAccess } =
    useAdminAccess('moderator');
  useEffect(() => {
    void verifyAdminAccess();
  }, [verifyAdminAccess]);
  if (previousPath !== pathname) {
    setPreviousPath(pathname);
    setMobileOpen(false);
  }
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileOpen(false);
        menuButton.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(drawer.current?.querySelectorAll<HTMLElement>('a, button') ?? []),
      ];
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth >= 1280) setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [mobileOpen]);
  const title =
    sections.find((section) => section.href === pathname)?.label ?? 'الإدارة';
  const canManage = adminAccessRole === 'admin' || adminAccessRole === 'owner';
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutNotice('');
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
      if (!response.ok) throw new Error('logout_failed');
      setSession({ authenticated: false, user: null, commissionAgreementAccepted: false });
      announceAuthSessionChange();
      window.location.replace('/admin');
    } catch {
      setSignOutNotice('تعذر تسجيل الخروج. حاول مرة أخرى.');
      setSigningOut(false);
    }
  };
  if (!isAdminAccessAllowed || signingOut) {
    const returnTo = pathname === '/admin' || pathname.startsWith('/admin/') ? pathname : '/admin';
    return <main dir="rtl" className="grid min-h-dvh place-items-center bg-background p-6 text-foreground" data-admin-entry>
      <section className="grid w-full max-w-sm justify-items-center gap-5 rounded-2xl border bg-card p-7 text-center shadow-sm">
        <Image src="/hamad-market-logo.webp" alt="سوق حمد" width={64} height={64} className="rounded-2xl" priority />
        <h1 className="text-xl font-bold">لوحة إدارة سوق حمد</h1>
        {isAdminAccessChecking || signingOut ? <p role="status" className="text-sm text-muted-foreground">{signingOut ? 'جارٍ تسجيل الخروج…' : 'جارٍ التحقق من الدخول…'}</p> : <>
          <p role="status" className="text-sm text-muted-foreground">{session.authenticated ? 'هذا الحساب لا يملك صلاحية الإدارة.' : 'سجّل الدخول بحساب الإدارة.'}</p>
          <a className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground" href={`/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`}>{session.authenticated ? 'الدخول بحساب آخر' : 'تسجيل الدخول باستخدام Google'}</a>
          {session.authenticated && <Button variant="outline" className="w-full" onClick={() => void signOut()}><LogOut className="size-4" />تسجيل الخروج</Button>}
          <Button variant="ghost" onClick={() => void verifyAdminAccess()}>إعادة التحقق</Button>
        </>}
        {signOutNotice && <p role="alert" className="text-sm text-destructive">{signOutNotice}</p>}
      </section>
    </main>;
  }
  return (
    <div
      className="admin-workspace"
      dir="rtl"
      data-expanded={expanded}
      data-mobile-open={mobileOpen}
    >
      {isAdminAccessAllowed && (
        <>
          {mobileOpen && (
            <button
              className="admin-drawer-backdrop"
              aria-label="إغلاق قائمة الإدارة"
              onClick={() => {
                setMobileOpen(false);
                menuButton.current?.focus();
              }}
            />
          )}
          <aside
            ref={drawer}
            id="admin-navigation"
            className="admin-sidebar"
            aria-label="قائمة الإدارة"
            role={mobileOpen ? 'dialog' : undefined}
            aria-modal={mobileOpen || undefined}
          >
            <div className="admin-brand">
              <Image
                src="/hamad-market-logo.webp"
                alt="سوق حمد"
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-md object-cover"
                priority
              />
              <div className="admin-sidebar-label min-w-0">
                <strong className="block text-base">سوق حمد</strong>
                <span className="text-xs text-muted-foreground">
                  لوحة الإدارة
                </span>
              </div>
              <Button
                className="ms-auto xl:hidden"
                variant="ghost"
                size="icon"
                aria-label="إغلاق القائمة"
                onClick={() => {
                  setMobileOpen(false);
                  menuButton.current?.focus();
                }}
              >
                <X className="size-5" />
              </Button>
            </div>
            <nav className="grid gap-1 p-3" aria-label="أقسام الإدارة">
              {sections
                .filter((section) => ('ownerOnly' in section && section.ownerOnly)
                  ? adminAccessRole === 'owner'
                  : section.staff || canManage)
                .map(({ href, label, icon: Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    prefetch={false}
                    onClick={() => setMobileOpen(false)}
                    aria-current={pathname === href ? 'page' : undefined}
                    className="admin-nav-item"
                    title={label}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="admin-sidebar-label">{label}</span>
                  </Link>
                ))}
              {canManage && (
                <Link
                  href="/admin?view=calendar"
                  prefetch={false}
                  onClick={() => setMobileOpen(false)}
                  className="admin-nav-item"
                  title="التقويم الإداري"
                >
                  <CalendarDays className="size-5 shrink-0" />
                  <span className="admin-sidebar-label">التقويم الإداري</span>
                </Link>
              )}
            </nav>
            <Link
              href="/admin"
              className="admin-nav-item m-3 mt-auto"
              title="العودة إلى لوحة الإدارة"
            >
              <ArrowRight className="size-5 shrink-0" />
              <span className="admin-sidebar-label">لوحة الإدارة</span>
            </Link>
          </aside>
          <header className="admin-topbar">
            <Button
              ref={menuButton}
              variant="outline"
              size="icon"
              className="xl:hidden"
              aria-label="فتح قائمة الإدارة"
              aria-expanded={mobileOpen}
              aria-controls="admin-navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden xl:inline-flex"
              aria-label={
                expanded ? 'طي القائمة الجانبية' : 'توسيع القائمة الجانبية'
              }
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <PanelRightClose className="size-5" />
              ) : (
                <PanelRightOpen className="size-5" />
              )}
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {title}
            </span>
            <Button
              variant="outline"
              size="icon"
              title="البحث في أقسام الإدارة"
              aria-label="البحث في أقسام الإدارة"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="size-4" />
            </Button>
            <span className="hidden text-xs text-muted-foreground sm:block">
              {canManage ? 'إدارة المنصة' : 'الإشراف'}
            </span>
            <ThemeToggle language="ar" />
            <AdminReportNotifications canManage={canManage} />
            <Button variant="outline" size="icon" aria-label="تسجيل الخروج" title="تسجيل الخروج" onClick={() => void signOut()}><LogOut className="size-4" /></Button>
          </header>
          <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
            <DialogContent
              dir="rtl"
              className="p-3"
              aria-describedby={undefined}
            >
              <DialogTitle className="sr-only">
                الوصول السريع لأقسام الإدارة
              </DialogTitle>
              <Command>
                <CommandInput
                  placeholder="بحث في أقسام الإدارة"
                  aria-label="بحث في أقسام الإدارة"
                />
                <CommandList>
                  <CommandEmpty>لا توجد أقسام مطابقة.</CommandEmpty>
                  {sections
                    .filter((section) => ('ownerOnly' in section && section.ownerOnly)
                      ? adminAccessRole === 'owner'
                      : section.staff || canManage)
                    .map(({ href, label, icon: Icon }) => (
                      <CommandItem
                        key={href}
                        value={label}
                        onSelect={() => {
                          setSearchOpen(false);
                          router.push(href);
                        }}
                      >
                        <Icon className="size-4" />
                        {label}
                      </CommandItem>
                    ))}
                  {canManage && (
                    <CommandItem
                      value="التقويم الإداري"
                      onSelect={() => {
                        setSearchOpen(false);
                        router.push('/admin?view=calendar');
                      }}
                    >
                      <CalendarDays className="size-4" />
                      التقويم الإداري
                    </CommandItem>
                  )}
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>
        </>
      )}
      <div
        className="admin-content"
        inert={mobileOpen || undefined}
      >
        {signOutNotice && <p role="alert" className="admin-notice">{signOutNotice}</p>}
        {children}
      </div>
    </div>
  );
}
