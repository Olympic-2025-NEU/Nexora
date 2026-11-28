// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

export const instant = false;

/** Commercial order create is POS checkout (ADR 0019). */
export default function NewOrderPage() {
  redirect("/pos");
}
