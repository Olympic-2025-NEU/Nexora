// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { AppShell } from "@/app/components/shell/AppShell";

/** AppShell auth gate is client-side — skip Instant Navigation validation here. */
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
