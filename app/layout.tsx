import type { CSSProperties } from "react";
import type { Metadata } from "next";
import "./globals.css";
import { appConfig } from "./app-config";

export const metadata: Metadata = {
  title: appConfig.metadata.title,
  description: appConfig.metadata.description,
  icons: {
    icon: "/smartstore-mark.png",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode | React.ReactElement;
}>) {
  return (
    <html dir="rtl" lang="ar" style={themeStyle}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}

