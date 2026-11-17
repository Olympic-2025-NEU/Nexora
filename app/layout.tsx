// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nexora",
  description: "Nền tảng nguồn mở cho chuỗi cung ứng và truy xuất nguồn gốc.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
