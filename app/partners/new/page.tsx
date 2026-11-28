// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

/** Legacy create route — partner CRUD is modal-based on `/partners`. */
export default function NewPartnerRedirectPage() {
  redirect("/partners");
}
