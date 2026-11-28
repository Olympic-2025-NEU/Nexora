// SPDX-License-Identifier: AGPL-3.0-only
import { DashboardClient } from "./_components/dashboard-client";

/** Dashboard loads sales client-side — not an instant navigation target. */
export const instant = false;

export default function DashboardPage() {
  return <DashboardClient />;
}
