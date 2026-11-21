// SPDX-License-Identifier: AGPL-3.0-only
import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-4xl font-semibold">Nexora</h1>
      <p className="max-w-xl text-lg">
        Nền tảng nguồn mở cho chuỗi cung ứng và truy xuất nguồn gốc.
      </p>
      <Link href="/admin" className="text-sm underline">
        System admin (M01)
      </Link>
    </main>
  );
}
