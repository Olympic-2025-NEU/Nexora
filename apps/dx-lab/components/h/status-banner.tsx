// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";

export function StatusBanner({
  tone,
  children,
}: {
  tone: "error" | "warning" | "info" | "success";
  children: ReactNode;
}) {
  return <p role={tone === "error" ? "alert" : "status"} className={`banner banner-${tone}`}>{children}</p>;
}
