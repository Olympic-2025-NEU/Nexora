// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import { AppShell } from "@/app/components/shell/AppShell";

/** AppShell uses usePathname — block static prerender for trading surfaces. */
export const instant = false;

export default function TradingLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
