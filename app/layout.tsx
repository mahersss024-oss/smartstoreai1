import { Suspense, type CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appConfig } from "./app-config";
import { AppWelcomeSplash } from "@/components/app-welcome-splash";
import { buildWelcomeInitScript } from "@/lib/welcome/config";
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteVisitTracker } from "@/components/site-visit-tracker";
import { NativeAppBridge } from "@/components/native-app-bridge";

const themeStorageKey = "theme";
const themeCookieName = "theme";

export const metadata: Metadata = {
  title: appConfig.metadata.title,
  description: appConfig.metadata.description,
  applicationName: "سوق حمد",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "سوق حمد",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
      { url: "/hamad-market-logo.jpeg", type: "image/jpeg" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8edf3" },
    { media: "(prefers-color-scheme: dark)", color: "#0a111c" },
  ],
};

const themeStyle: CSSProperties = {
  ...Object.entries(appConfig.theme.light).reduce<Record<string, string>>(
    (vars, [token, value]) => {
      vars[`--theme-light-${token}`] = value;
      return vars;
    },
    {},
  ),
  ...Object.entries(appConfig.theme.dark).reduce<Record<string, string>>(
    (vars, [token, value]) => {
      vars[`--theme-dark-${token}`] = value;
      return vars;
    },
    {},
  ),
};

// Critical first-paint welcome styles. The overlay is hidden by default and is
// shown only when the head script explicitly marks this load as a welcome launch.
// This avoids any independent dark cover appearing during normal navigation.
const welcomeCriticalStyle = `
html { background-color: #e8edf3; }
html.dark { background-color: #0a111c; }
body { background-color: var(--theme-light-background, #e8edf3); }
html.dark body { background-color: var(--theme-dark-background, #0a111c); }
html[data-welcome='skip'] #smartstore-welcome { display: none !important; }
#smartstore-welcome {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(150deg, #08111d 0%, #0d2b28 44%, #117c8b 100%);
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  animation: app-welcome-lifecycle 2920ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
html[data-welcome='show'] #smartstore-welcome { display: flex; }
html[data-app-display='standalone'] #smartstore-welcome {
  animation-duration: 1700ms;
  animation-name: app-welcome-standalone-lifecycle;
}
#smartstore-welcome .app-welcome__content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.15rem;
  padding: 0 1.5rem;
  text-align: center;
}
#smartstore-welcome .app-welcome__logo {
  width: clamp(108px, 27vmin, 172px);
  height: clamp(108px, 27vmin, 172px);
  border-radius: 24%;
  overflow: hidden;
}
#smartstore-welcome .app-welcome__logo img {
  width: 100%;
  height: 100%;
  border-radius: 24%;
  display: block;
}
@keyframes app-welcome-lifecycle {
  0%, 82% { opacity: 1; }
  100% { opacity: 0; visibility: hidden; }
}
@keyframes app-welcome-standalone-lifecycle {
  0%, 74% { opacity: 1; }
  100% { opacity: 0; visibility: hidden; }
}
`;

const themeInitScript = `
(function() {
  try {
    var storageTheme = window.localStorage.getItem('${themeStorageKey}');
    var cookieMatch = document.cookie.match(/(?:^|; )${themeCookieName}=(dark|light)(?:;|$)/);
    var cookieTheme = cookieMatch ? cookieMatch[1] : null;
    var theme = storageTheme === 'dark' || storageTheme === 'light'
      ? storageTheme
      : (cookieTheme === 'dark' || cookieTheme === 'light'
        ? cookieTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('${themeStorageKey}', theme);
    document.cookie = '${themeCookieName}=' + theme + '; Path=/; Max-Age=31536000; SameSite=Lax';
  } catch (error) {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode | React.ReactElement;
}>) {
  return (
    <html
      dir="rtl"
      lang="ar"
      style={{
        ...themeStyle,
        colorScheme: "light",
      }}
      suppressHydrationWarning
    >
      <head>
        <script
          id="smartstore-welcome-init"
          dangerouslySetInnerHTML={{ __html: buildWelcomeInitScript() }}
        />
        <style
          id="smartstore-welcome-critical-style"
          dangerouslySetInnerHTML={{ __html: welcomeCriticalStyle }}
        />
        <script
          id="smartstore-theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=1170x2532"
          media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=1179x2556"
          media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=1284x2778"
          media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=1290x2796"
          media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=1536x2048"
          media="(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)"
        />
        <link
          rel="apple-touch-startup-image"
          href="/splash?size=2048x2732"
          media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)"
        />
      </head>
      <body className="overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] antialiased lg:pb-0">
        <AppWelcomeSplash />
        <Suspense fallback={null}>
          <SiteVisitTracker />
        </Suspense>
        <ServiceWorkerRegistrar />
        <NativeAppBridge />
        {children}
        <PwaInstallPrompt />
        <MobileBottomNavigation />
      </body>
    </html>
  );
}
