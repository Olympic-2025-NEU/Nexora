// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import Link from "next/link";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Link href="/admin" className="text-lg font-semibold tracking-tight">
            Nexora Admin
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/organization">Organization</Link>
            <Link href="/admin/members">Members</Link>
            <Link href="/admin/partners">Partners</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
