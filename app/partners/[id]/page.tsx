// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

/** Legacy detail/wizard route — link setup is modal-based on `/partners`. */
export default function PartnerDetailRedirectPage() {
  redirect("/partners");
}
