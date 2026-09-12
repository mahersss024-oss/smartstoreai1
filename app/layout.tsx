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
  applicationName: "SmartStore AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "SmartStore AI",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
      { url: "/smartstore-mark.png", type: "image/png" },
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

// Paints a solid brand background before ANY stylesheet loads. On iOS PWAs the
// first frame can arrive before the CSS chunks do, which used to expose the raw
// chat input as an unstyled "text bar" flash. This inline block covers the
// screen instantly with the brand gradient so that flash can never be seen.
// The welcome overlay (also server-rendered) then draws on top of it.
const bootCoverStyle = `
html, body { background-color: #08111d; }
html[data-welcome='show']:not([data-app-ready='1']) body > :not(#smartstore-boot-cover):not(#smartstore-welcome) {
  visibility: hidden;
  animation: smartstore-app-shell-fallback-reveal 0s linear 8s forwards;
}
#smartstore-boot-cover {
  position: fixed;
  inset: 0;
  display: none;
  /* Sits just below the welcome overlay (z-index 9999) so the animated welcome
     plays on top of it, but above the app content so nothing flashes through. */
  z-index: 9998;
  pointer-events: none;
  /* Safety net: fade the cover away on its own even if JS never runs, so it can
     never trap the user on a blank brand screen. */
  background:
    linear-gradient(150deg, #08111d 0%, #0d2b28 44%, #117c8b 100%);
  animation: smartstore-boot-cover-hide 0s linear 8s forwards;
}
html[data-welcome='show'] #smartstore-boot-cover { display: block; }
html[data-app-ready='1'] #smartstore-boot-cover { display: none !important; }
html[data-welcome='skip'] #smartstore-boot-cover { display: none !important; }
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
@keyframes smartstore-app-shell-fallback-reveal { to { visibility: visible; } }
@keyframes smartstore-boot-cover-hide { to { opacity: 0; visibility: hidden; } }
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
          id="smartstore-boot-cover-style"
          dangerouslySetInnerHTML={{ __html: bootCoverStyle }}
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
        <div id="smartstore-boot-cover" aria-hidden="true" />
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
