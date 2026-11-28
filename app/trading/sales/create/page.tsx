// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

/** Legacy path — create order at `/orders/new`. */
export default function CreateSaleRedirectPage() {
  redirect("/orders/new");
}
