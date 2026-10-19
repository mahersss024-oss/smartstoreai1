import { Suspense, type CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { appConfig } from "./app-config";
import { AppWelcomeSplash } from "@/components/app-welcome-splash";
import {
  buildWelcomeInitScript,
  WELCOME_FADE_MS,
  WELCOME_STANDALONE_FADE_MS,
  WELCOME_STANDALONE_VISIBLE_MS,
  WELCOME_VISIBLE_MS,
} from "@/lib/welcome/config";
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation";
import { SiteMessageBanner } from "@/components/site-message-banner";
import { SiteMessageHomeOnly } from "@/components/site-message-home-only";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { SiteVisitTracker } from "@/components/site-visit-tracker";
import { NativeAppBridge } from "@/components/native-app-bridge";
import { OpenInAppBanner } from "@/components/open-in-app-banner";
import { AuthSessionProvider } from "@/hooks/use-auth-session";
import { PageTransition } from "@/components/page-transition";

const themeStorageKey = "theme";
const themeCookieName = "theme";
const welcomeLifecycleMs = WELCOME_VISIBLE_MS + WELCOME_FADE_MS;
const welcomeStandaloneLifecycleMs =
  WELCOME_STANDALONE_VISIBLE_MS + WELCOME_STANDALONE_FADE_MS;
const welcomeVisiblePercent = Math.round(
  (WELCOME_VISIBLE_MS / welcomeLifecycleMs) * 100,
);
const welcomeStandaloneVisiblePercent = Math.round(
  (WELCOME_STANDALONE_VISIBLE_MS / welcomeStandaloneLifecycleMs) * 100,
);
const appBaseUrl = "https://souqhamad.com";

export const metadata: Metadata = {
  metadataBase: new URL(appBaseUrl),
  title: appConfig.metadata.title,
  description: appConfig.metadata.description,
  keywords: [...appConfig.metadata.keywords],
  applicationName: "سوق حمد",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: appConfig.metadata.title,
    description: appConfig.metadata.description,
    url: "/",
    siteName: "سوق حمد",
    locale: "ar_SA",
    type: "website",
    images: [
      {
        url: "/hamad-market-logo.jpeg",
        width: 512,
        height: 512,
        alt: "سوق حمد",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: appConfig.metadata.title,
    description: appConfig.metadata.description,
    images: ["/hamad-market-logo.jpeg"],
  },
  manifest: "/manifest.webmanifest?v=souq-hamad-20261001",
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=souq-hamad-20261001", sizes: "any" },
      { url: "/icon.png?v=souq-hamad-20261001", type: "image/png" },
      { url: "/hamad-market-logo.jpeg?v=souq-hamad-20261001", type: "image/jpeg" },
    ],
    apple: "/apple-icon.png?v=souq-hamad-20261001",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
  box-sizing: border-box;
  width: 100vw;
  min-width: 100vw;
  height: 100dvh;
  min-height: 100svh;
  overflow: hidden;
  background: linear-gradient(150deg, #08111d 0%, #0d2b28 44%, #117c8b 100%);
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  animation: app-welcome-lifecycle ${welcomeLifecycleMs}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
html[data-welcome='show'] #smartstore-welcome { display: flex; }
html[data-app-display='standalone'] #smartstore-welcome {
  animation-duration: ${welcomeStandaloneLifecycleMs}ms;
  animation-name: app-welcome-standalone-lifecycle;
}
#smartstore-welcome::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(circle at 50% 28%, rgb(28 194 111 / 30%), transparent 34%),
    radial-gradient(circle at 72% 48%, rgb(17 124 139 / 34%), transparent 42%),
    linear-gradient(160deg, rgb(8 17 29 / 76%), rgb(13 43 40 / 42%) 48%, rgb(17 124 139 / 34%));
  opacity: 1;
}
#smartstore-welcome .app-welcome__brand {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 42%;
  width: min(78vw, 26rem);
  max-width: calc(100vw - 2rem);
  height: auto;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  display: block;
  transform: translate(-50%, -50%);
}
#smartstore-welcome .app-welcome__content {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.8rem;
  width: 100%;
  min-height: 100%;
  padding: 0 1.5rem calc(env(safe-area-inset-bottom) + 4.5rem);
  text-align: center;
}
@media (min-width: 640px) {
  #smartstore-welcome .app-welcome__brand {
    top: 41%;
    width: min(56vw, 30rem);
  }
}
@media (orientation: landscape) {
  #smartstore-welcome .app-welcome__brand {
    top: 40%;
    width: min(42vw, 30rem);
  }
}
@media (min-width: 1024px) and (orientation: landscape) {
  #smartstore-welcome .app-welcome__brand {
    top: 40%;
    width: min(36vw, 34rem);
  }
}
@keyframes app-welcome-lifecycle {
  0%, ${welcomeVisiblePercent}% { opacity: 1; }
  100% { opacity: 0; visibility: hidden; }
}
@keyframes app-welcome-standalone-lifecycle {
  0%, ${welcomeStandaloneVisiblePercent}% { opacity: 1; }
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

const nativeViewportInitScript = `
(function() {
  try {
    var root = document.documentElement;
    var userAgent = navigator.userAgent || '';
    var platform = /android/i.test(userAgent)
      ? 'android'
      : (/iphone|ipad|ipod/i.test(userAgent) ? 'ios' : 'web');
    var isNativeApp = !!(
      userAgent.indexOf('SouqHamadCapacitor') !== -1 ||
      window.Capacitor ||
      window.ReactNativeWebView ||
      window.SmartStoreNative ||
      (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.smartstore)
    );
    root.setAttribute('data-platform', platform);
    root.setAttribute('data-native-app', isNativeApp ? 'true' : 'false');
  } catch (error) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode | React.ReactElement;
}>) {
  let listingImageOrigin: string | undefined;
  try {
    const url = new URL(
      process.env.SMARTSTORE_OBJECT_STORAGE_PUBLIC_URL?.trim() || "https://images.souqhamad.com",
    );
    if (url.protocol === "https:") listingImageOrigin = url.origin;
  } catch {
    // An invalid optional image origin must not prevent page rendering.
  }

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
        {listingImageOrigin && <link rel="preconnect" href={listingImageOrigin} />}
        <script
          id="smartstore-native-viewport-init"
          dangerouslySetInnerHTML={{ __html: nativeViewportInitScript }}
        />
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
      <body className="overflow-x-hidden pb-[calc(5rem+env(safe-area-inset-bottom))] antialiased lg:pb-0">
        <AppWelcomeSplash />
        <SiteMessageHomeOnly>
          <SiteMessageBanner />
        </SiteMessageHomeOnly>
        <Suspense fallback={null}>
          <SiteVisitTracker />
        </Suspense>
        <ServiceWorkerRegistrar />
        <NativeAppBridge />
        <AuthSessionProvider>
          <OpenInAppBanner />
          <PageTransition>{children}</PageTransition>
          <PullToRefresh />
          <MobileBottomNavigation />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
