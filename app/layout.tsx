import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { appConfig } from "./app-config";

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
    var savedTheme = window.localStorage.getItem('theme');
    var theme = savedTheme === 'dark' || savedTheme === 'light'
      ? savedTheme
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
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
    <html dir="rtl" lang="ar" style={themeStyle} suppressHydrationWarning>
      <body className="antialiased">
        <Script
          id="smartstore-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        {children}
      </body>
    </html>
  );
}

