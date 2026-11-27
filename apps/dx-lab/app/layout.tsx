// SPDX-License-Identifier: AGPL-3.0-only
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles.css";

export const metadata: Metadata = {
  title: "DX-Lab Operations Workspace",
  description: "Không gian làm việc Nexora H-P-D-I",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi"><body>{children}</body></html>;
}
