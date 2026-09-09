import { Suspense, type CSSProperties } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { appConfig } from "./app-config";
import { MobileBottomNavigation } from "@/components/mobile-bottom-navigation";
import { SiteVisitTracker } from "@/components/site-visit-tracker";

const themeStorageKey = "theme";
const themeCookieName = "theme";

export const metadata: Metadata = {
  title: appConfig.metadata.title,
  description: appConfig.metadata.description,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png" },
      { url: "/smartstore-mark.png", type: "image/png" },
    ],
    apple: "/apple-icon.png",
  },
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
          id="smartstore-theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="overflow-x-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))] antialiased lg:pb-0">
        <Suspense fallback={null}>
          <SiteVisitTracker />
        </Suspense>
        {children}
        <MobileBottomNavigation />
      </body>
    </html>
  );
}

