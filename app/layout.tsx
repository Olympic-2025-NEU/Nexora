// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { LocaleProvider } from "@/app/i18n/LocaleProvider";
import { ThemeProvider } from "@/app/theme/ThemeProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

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
    <html
      lang="vi"
      className={`h-full antialiased ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider>
          <LocaleProvider>{children}</LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
