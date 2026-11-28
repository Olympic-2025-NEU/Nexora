// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

/** Legacy path — orders live at `/orders`. */
export default function SalesRedirectPage() {
  redirect("/orders");
}
