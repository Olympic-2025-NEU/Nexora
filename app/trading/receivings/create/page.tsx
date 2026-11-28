// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

export default function ReceivingsCreateRedirectPage() {
  redirect("/trading/inbound/new");
}
