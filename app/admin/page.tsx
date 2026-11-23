// SPDX-License-Identifier: AGPL-3.0-only
import { AdminHomeClient } from "./_components/admin-home-client";

/** Hub loads roles client-side — not an instant navigation target. */
export const instant = false;

export default function AdminHomePage() {
  return <AdminHomeClient />;
}
