import '../../app/globals.css';
import Script from 'next/script';
import type { CSSProperties } from 'react';
import { appConfig } from '../../app/app-config';
import { AppWelcomeSplash } from '../../components/app-welcome-splash';
import {
  buildWelcomeCriticalStyle,
  buildWelcomeInitScript,
} from '../../lib/welcome/config';
import { AuthSessionProvider } from '../../hooks/use-auth-session';
import { MobileBottomNavigation } from '../../components/mobile-bottom-navigation';
import { PageTransition } from '../../components/page-transition';
import { MobileRouterProvider } from '../runtime/router';

export const metadata = {
  title: appConfig.metadata.title,
  description: appConfig.metadata.description,
  keywords: appConfig.metadata.keywords,
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e8edf3' },
    { media: '(prefers-color-scheme: dark)', color: '#0a111c' },
  ],
};

const themeStyle = {
  ...Object.entries(appConfig.theme.light).reduce<Record<string, string>>((vars, [token, value]) => {
    vars[`--theme-light-${token}`] = value;
    return vars;
  }, {}),
  ...Object.entries(appConfig.theme.dark).reduce<Record<string, string>>((vars, [token, value]) => {
    vars[`--theme-dark-${token}`] = value;
    return vars;
  }, {}),
} as CSSProperties;

const themeInitScript = `
(function() {
  try {
    var storageTheme = window.localStorage.getItem('theme');
    var cookieMatch = document.cookie.match(/(?:^|; )theme=(dark|light)(?:;|$)/);
    var cookieTheme = cookieMatch ? cookieMatch[1] : null;
    var theme = storageTheme === 'dark' || storageTheme === 'light'
      ? storageTheme
      : (cookieTheme === 'dark' || cookieTheme === 'light'
        ? cookieTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('theme', theme);
    document.cookie = 'theme=' + theme + '; Path=/; Max-Age=31536000; SameSite=Lax';
  } catch (error) {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
})();
`;

export default function MobileLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" style={{ ...themeStyle, colorScheme: 'light' }} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://images.souqhamad.com" />
        <script id="smartstore-welcome-init" dangerouslySetInnerHTML={{ __html: buildWelcomeInitScript() }} />
        <style id="smartstore-welcome-critical-style" dangerouslySetInnerHTML={{ __html: buildWelcomeCriticalStyle() }} />
        <script id="smartstore-theme-init" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] antialiased">
        <AppWelcomeSplash />
        <Script src="https://localhost/mobile-api-origin.js" strategy="beforeInteractive" />
        <MobileRouterProvider>
          <AuthSessionProvider>
            <PageTransition>{children}</PageTransition>
            <MobileBottomNavigation />
          </AuthSessionProvider>
        </MobileRouterProvider>
      </body>
    </html>
  );
}
