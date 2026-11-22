// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { LocaleProvider } from "@/app/i18n/LocaleProvider";
import { ThemeProvider } from "@/app/theme/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexora",
  description: "Nền tảng nguồn mở cho chuỗi cung ứng và truy xuất nguồn gốc.",
  icons: {
    icon: [{ url: "/assets/Nexora.png", type: "image/png" }],
    apple: [{ url: "/assets/Nexora.png", type: "image/png" }],
  },
};

/** Avoid flash of wrong theme before ThemeProvider hydrates. */
const themeBootScript = `(function(){try{var t=localStorage.getItem('nexora.theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
